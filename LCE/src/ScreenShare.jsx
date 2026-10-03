
import { useEffect, useRef, useState } from "react";


export function useScreenShareStudent({ socket, roomCode, studentId }) {
  const [isSharing, setIsSharing]   = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const pcRef          = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    

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
  }, [socket]);          

 
    try {
      /* 1. getDisplayMedia */
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

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

     
      await pc.setLocalDescription(await pc.createOffer());

     
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


export function useScreenShareTeacher({ socket, roomCode }) {
  const [screens, setScreens] = useState([]);
  const pcMapRef = useRef({});        // studentId → RTCPeerConnection

  useEffect(() => {
    if (!socket) return;

   
  
    const handleOffer = async ({ offer, studentId } = {}) => {
      if (!offer || !studentId) return;

      if (!roomCode) {
        console.warn("Offer arrived before roomCode was set – continuing anyway");
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcMapRef.current[studentId] = pc;

     

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

 
  return { screens, removeScreen };
}
