// ------------------------------------------------------------------
//  src/ScreenShare.jsx      (debug version – 11 May 2025)
// ------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  useScreenShareStudent                                              */
/* ------------------------------------------------------------------ */
export function useScreenShareStudent({ socket, roomCode, studentId }) {
  const [isSharing, setIsSharing]   = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const pcRef          = useRef(null);
  const localStreamRef = useRef(null);

  /* ---------- listen for ANSWER + ICE from the teacher ------------ */
  useEffect(() => {
    if (!socket) return;

    const handleScreenShareAnswer = async ({ answer } = {}) => {
      if (!answer || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (err) {
        console.error("setRemoteDescription error:", err);
        setErrorMessage("Failed to establish connection with teacher.");
      }
    };

    const handleIceCandidate = async ({ candidate, from }) => {
      if (from !== "teacher" || !candidate || !pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("addIceCandidate error (teacher→student):", err);
      }
    };

    socket.on("screen_share_answer", handleScreenShareAnswer);
    socket.on("ice_candidate",       handleIceCandidate);

    return () => {
      socket.off("screen_share_answer", handleScreenShareAnswer);
      socket.off("ice_candidate",       handleIceCandidate);
    };
  }, [socket]);           // ← hook runs again when `socket` becomes ready

  /* -------------------- user clicks “Start Screen Share” ----------- */
  async function startShare() {
    const sock = socket;                 // local alias for clarity
    setErrorMessage("");

    if (!sock) {
      setErrorMessage("Socket not ready – join the room first.");
      return;
    }
    if (!roomCode || !studentId) {
      setErrorMessage("Missing roomCode or studentId.");
      return;
    }

    try {
      /* 1. getDisplayMedia */
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      /* 2. Optional sanity-check */
      const trackLabel = stream.getVideoTracks()[0]?.label.toLowerCase() || "";
      if (!trackLabel.includes("screen")) {
        setErrorMessage("Please share your **entire screen**.");
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      /* 3. Build RTCPeerConnection */
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current          = pc;
      localStreamRef.current = stream;

      /* 4. Add tracks */
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      /* 5. ICE from student → send to teacher */
      pc.onicecandidate = e => {
        if (e.candidate) {
          sock.emit("ice_candidate", {
            candidate: e.candidate.toJSON?.() || e.candidate,
            to: "teacher",
            roomCode,
            studentId
          });
        }
      };

      /* 6. SDP offer */
      await pc.setLocalDescription(await pc.createOffer());

      /* 7.  TEMP DEBUG: emit with console + ACK  ------------------- */
      console.log("[Student] EMIT screen_share_offer", {
        offerType: pc.localDescription?.type,
        roomCode,
        studentId,
        socketConnected: sock.connected
      });

      sock.emit(
        "screen_share_offer",
        {
          offer: pc.localDescription.toJSON
            ? pc.localDescription.toJSON()
            : { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
          roomCode,
          studentId
        },
        (ack) => console.log("[Student] server ACK:", ack)   // <— debug
      );

      setIsSharing(true);
    } catch (err) {
      console.error("startShare error:", err);
      setErrorMessage(err.message || "Unknown error");
    }
  }

  /* ------------------------- Stop share --------------------------- */
  function stopShare() {
    setIsSharing(false);
    setErrorMessage("");

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;
  }

  return { startShare, stopShare, isSharing, errorMessage };
}

/* ------------------------------------------------------------------ */
/*  useScreenShareTeacher                                              */
/* ------------------------------------------------------------------ */
export function useScreenShareTeacher({ socket, roomCode }) {
  const [screens, setScreens] = useState([]);
  const pcMapRef = useRef({});        // studentId → RTCPeerConnection

  useEffect(() => {
    if (!socket) return;

    /* global debug – remove later */
    const logAny = (ev, ...args) =>
      console.log("[Teacher socket onAny]", ev, args);
    socket.onAny(logAny);

    /* ---------- student sends OFFER -------------------------------- */
    const handleOffer = async ({ offer, studentId } = {}) => {
      if (!offer || !studentId) return;

      if (!roomCode) {
        console.warn("Offer arrived before roomCode was set – continuing anyway");
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcMapRef.current[studentId] = pc;

      pc.ontrack = e => {
        const [remoteStream] = e.streams;
        setScreens(prev => [
          ...prev.filter(s => s.studentId !== studentId),
          { studentId, stream: remoteStream }
        ]);
      };

      pc.onicecandidate = e => {
        if (e.candidate && roomCode) {
          socket.emit("ice_candidate", {
            candidate: e.candidate.toJSON?.() || e.candidate,
            to: "student",
            roomCode,
            studentId
          });
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await pc.setLocalDescription(await pc.createAnswer());
      } catch (err) {
        console.error("Teacher PC setup error:", err);
        return;
      }

      if (roomCode) {
        socket.emit("screen_share_answer", {
          answer: pc.localDescription.toJSON
            ? pc.localDescription.toJSON()
            : { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
          roomCode,
          studentId
        });
      }
    };

    /* ---------- ICE from student ----------------------------------- */
    const handleIceCandidate = async ({ candidate, studentId, from }) => {
      if (from !== "student" || !candidate) return;
      const pc = pcMapRef.current[studentId];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("Teacher addIceCandidate error:", err);
        }
      }
    };

    socket.on("screen_share_offer", handleOffer);
    socket.on("ice_candidate",      handleIceCandidate);

    return () => {
      socket.offAny(logAny);
      socket.off("screen_share_offer", handleOffer);
      socket.off("ice_candidate",      handleIceCandidate);

      Object.values(pcMapRef.current).forEach(pc => pc.close());
      pcMapRef.current = {};
    };
  }, [socket]);    // listeners attach as soon as socket exists

  /* manual removal helper for UI */
  function removeScreen(studentId) {
    setScreens(prev => prev.filter(s => s.studentId !== studentId));
    pcMapRef.current[studentId]?.close();
    delete pcMapRef.current[studentId];
  }

  return { screens, removeScreen };
}
