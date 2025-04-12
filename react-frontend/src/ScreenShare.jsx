// ScreenShare.jsx

import { useEffect, useRef, useState } from "react";

/**
 * Hook for the STUDENT side to share entire screen.
 * 
 * @param {Object} options 
 *  - socket: the connected Socket.IO instance 
 *  - roomCode: the code for the exam room
 *  - studentId: unique ID for this student
 * 
 * Returns {
 *   startShare: Function, // call to begin sharing
 *   stopShare: Function,  // call to stop sharing
 *   isSharing: boolean,
 *   errorMessage: string
 * }
 */
export function useScreenShareStudent({ socket, roomCode, studentId }) {
  const [isSharing, setIsSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  
  // We'll store the peer connection and local stream in refs to preserve them across renders
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    // Listen for the teacher's answer
    const handleScreenShareAnswer = async (data) => {
      // e.g. data = { answer, roomCode, studentId }
      if (!pcRef.current) return; // means we never set up a PC yet
      const { answer } = data || {};
      if (!answer) return; // skip if missing

      try {
        await pcRef.current.setRemoteDescription(answer);
        // If successful, connection should now be established
      } catch (err) {
        console.error("Error setting teacher answer as remote desc:", err);
        setErrorMessage("Failed to set teacher answer.");
      }
    };

    // Listen for ICE candidates from teacher
    const handleIceCandidate = async (data) => {
      // e.g. data = { candidate, from: "teacher", roomCode, studentId }
      if (!pcRef.current) return;
      if (data && data.from === "teacher" && data.candidate) {
        try {
          await pcRef.current.addIceCandidate(data.candidate);
        } catch (err) {
          console.error("Error adding ICE candidate (teacher->student):", err);
        }
      }
    };

    socket.on("screen_share_answer", handleScreenShareAnswer);
    socket.on("ice_candidate", handleIceCandidate);

    return () => {
      socket.off("screen_share_answer", handleScreenShareAnswer);
      socket.off("ice_candidate", handleIceCandidate);
    };
  }, [socket]);

  // Called to start screen sharing
  async function startShare() {
    setErrorMessage("");

    if (!socket) {
      setErrorMessage("Socket is not available. Cannot start share.");
      return;
    }
    if (!roomCode || !studentId) {
      setErrorMessage("Missing roomCode or studentId. Cannot start share.");
      return;
    }

    try {
      // 1) Ask for screen
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      // Optional check if they truly picked entire screen
      const label = stream.getVideoTracks()[0]?.label || "";
      if (!label.toLowerCase().includes("screen")) {
        // Possibly the user selected a single window or tab
        setErrorMessage("Please select 'Entire Screen' to proceed.");
        // Stop that track
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      // 2) Create PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" }
          // If you have a TURN server, add it here
        ]
      });
      pcRef.current = pc;
      localStreamRef.current = stream;

      // 3) Add all tracks from the screen stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // 4) Handle local ICE
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice_candidate", {
            candidate: event.candidate,
            to: "teacher",
            roomCode,
            studentId
          });
        }
      };

      // 5) Create offer, set local desc
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 6) Emit "screen_share_offer" to the server
      socket.emit("screen_share_offer", {
        offer,
        roomCode,
        studentId
      });

      setIsSharing(true);
      setErrorMessage("");

    } catch (err) {
      console.error("startShare error:", err);
      setErrorMessage("Could not start screen share. " + err.message);
    }
  }

  // Called to stop screen share
  function stopShare() {
    setIsSharing(false);
    setErrorMessage("");

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    localStreamRef.current = null;

    if (pcRef.current) {
      pcRef.current.close();
    }
    pcRef.current = null;
  }

  return {
    startShare,
    stopShare,
    isSharing,
    errorMessage
  };
}

/**
 * Hook for the TEACHER side to receive multiple student screens.
 *
 * @param {Object} options
 *  - socket: connected Socket.IO instance
 *  - roomCode: teacher's room code
 * 
 * Returns {
 *   screens: Array< { studentId, stream } >,
 *   removeScreen: (studentId) => void,
 * }
 */
export function useScreenShareTeacher({ socket, roomCode }) {
  const [screens, setScreens] = useState([]);
  // We'll store a map of studentId -> RTCPeerConnection
  const pcMapRef = useRef({});

  useEffect(() => {
    if (!socket) return;

    // Handler for "screen_share_offer"
    const handleOffer = async (data) => {
      // e.g. data = { offer, studentId }
      if (!data) return;
      const { offer, studentId } = data;
      if (!offer || !studentId) {
        console.warn("Received screen_share_offer but missing offer or studentId:", data);
        return;
      }
      console.log("Received screen_share_offer from student:", studentId);

      // 1) Create new PC for that student
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" }
        ]
      });
      pcMapRef.current[studentId] = pc;

      // 2) When teacher's PC receives a track, store it in state
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        setScreens((prev) => {
          // remove any existing entry for that student
          const filtered = prev.filter(s => s.studentId !== studentId);
          return [...filtered, { studentId, stream: remoteStream }];
        });
      };

      // 3) Teacher ICE => emit to student
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice_candidate", {
            candidate: event.candidate,
            to: "student",
            roomCode,
            studentId
          });
        }
      };

      // 4) Set remote desc to student's offer
      try {
        await pc.setRemoteDescription(offer);
      } catch (err) {
        console.error("Error setting remote desc to student's offer:", err);
        return;
      }

      // 5) Create answer
      let answer;
      try {
        answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
      } catch (err) {
        console.error("Error creating/setting teacher answer:", err);
        return;
      }

      // 6) Send answer back
      socket.emit("screen_share_answer", {
        answer: pc.localDescription,
        roomCode,
        studentId
      });
    };

    // Handler for "ice_candidate"
    const handleIceCandidate = async (data) => {
      // e.g. data = { candidate, studentId, from, roomCode }
      if (!data) return;
      const { candidate, studentId, from } = data;
      if (!studentId || from !== "student" || !candidate) return;

      const pc = pcMapRef.current[studentId];
      if (!pc) {
        console.warn("No pc found for studentId:", studentId, "cannot add ICE");
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("Error adding ICE candidate from student:", err);
      }
    };

    socket.on("screen_share_offer", handleOffer);
    socket.on("ice_candidate", handleIceCandidate);

    return () => {
      socket.off("screen_share_offer", handleOffer);
      socket.off("ice_candidate", handleIceCandidate);
      // Optionally close all PCs
      Object.values(pcMapRef.current).forEach((pc) => pc.close());
      pcMapRef.current = {};
    };
  }, [socket, roomCode]);

  // If you want to remove a screen manually (e.g. student disconnected)
  function removeScreen(studentId) {
    setScreens(prev => prev.filter(s => s.studentId !== studentId));
    const pc = pcMapRef.current[studentId];
    if (pc) {
      pc.close();
    }
    delete pcMapRef.current[studentId];
  }

  return {
    screens, 
    removeScreen
  };
}
