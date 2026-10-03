/* ------------------------------------------------
   src/StudentPage.jsx
   (Updated to include full screen sharing feature)
   ------------------------------------------------*/

   import React, { useState, useRef, useEffect } from "react";
   import { io } from "socket.io-client";
   import { useNavigate } from "react-router-dom"; 
   import Editor from "@monaco-editor/react";
   import { BACKEND_URL } from "./backendTest";
   
   // 1) Import our student screen-share hook
   import { useScreenShareStudent } from "./ScreenShare";
   
   function mapMonacoLanguage(lang) {
     switch (lang) {
       case "python": return "python";
       case "js":     return "javascript";
       case "java":   return "java";
       case "c":
       case "cpp":    return "cpp";
       case "php":    return "php";
       case "sql":    return "sql";
       default:       return "plaintext";
     }
   }
   
   // Optional helper to generate a random student ID
   function generateRandomId() {
     return "stud-" + Math.floor(Math.random() * 100000);
   }
   
   export default function StudentPage() {
     const navigate = useNavigate();  // For redirecting to landing 
     
     /* ------------------------------------------------------
      *  1) Exam / Room-Joining State
      * ------------------------------------------------------ */
     const [roomCode, setRoomCode]       = useState("");
     const [studentName, setStudentName] = useState("");
     const [joined, setJoined]           = useState(false);
   
     // The assignment text from teacher
     const [taskText, setTaskText]       = useState("");
   
     // If teacher sets a time limit, we keep track of a local countdown (in seconds)
     const [timeLeft, setTimeLeft]       = useState(null);
   
     // We'll have one socket for exam/room logic
     
   
     // If we already submitted
     const [hasSubmitted, setHasSubmitted] = useState(false);
   
     // If the teacher ended the exam => 10s countdown => auto-navigate to landing
     const [examEnded, setExamEnded]       = useState(false);
     const [disconnectTimer, setDisconnectTimer] = useState(null); 
     
      
   
     // We'll create a simple "studentId" to identify ourselves to the teacher
     // in screen sharing. In a real app, you might map this to your existing user data.
     const [studentId] = useState(() => generateRandomId());
     const examSocketRef = useRef(null);        // ← ① new line
   
     /* ------------------------------------------------------
      *  2) On mount, connect the exam logic socket
      * ------------------------------------------------------ */
     useEffect(() => {
       // Build a URL the browser can really reach
       const sock = io(BACKEND_URL);


       examSocketRef.current = sock;        
   
       sock.on("connect", () => {
         console.log("Student exam socket connected, id:", sock.id);
       });
   
       // If teacher sends a new task
       sock.on("new_task", (data) => {
         setTaskText(data.taskText || "");
         // reset local states
         setHasSubmitted(false);
   
         if (data.timeLimit && data.timeLimit > 0) {
           // convert minutes to total seconds
           setTimeLeft(data.timeLimit * 60);
         } else {
           setTimeLeft(null);
         }
         // if exam was ended before, this might re-open
         setExamEnded(false);
       });
   
       // If teacher ends exam => 10s countdown => forcibly disconnect => navigate("/")
       sock.on("exam_ended", () => {
         alert("Exam ended. You’ll be disconnected in 10 seconds.");
         setExamEnded(true);
         let secs = 10;
         setDisconnectTimer(secs);
         const t = setInterval(() => {
           secs -= 1;
           setDisconnectTimer(secs);
           if (secs <= 0) {
             clearInterval(t);
             // forcibly disconnect from the exam socket
             sock.disconnect();
             // now navigate back to the main landing page
             navigate("/");
           }
         }, 1000);
       });
   
       // If the teacher or server forcibly closes the room
       sock.on("room_closed", () => {
         alert("Room fully closed. Disconnecting now...");
         sock.disconnect();
         navigate("/");
       });
   
       // If there's a session error from the backend
       sock.on("session_error", (data) => {
         if (data.error === "You already submitted.") {
           console.log("Skipping 'already submitted' alert. " + data.error);
         } else {
           alert("Session error: " + data.error);
         }
       });
   
       return () => {
         sock.disconnect();
       };
     }, [navigate]);
   
     // The "join room" button
     function handleJoinRoom() {
       if (!examSocketRef.current) return;
       if (!roomCode || !studentName) {
         alert("Please enter a Room Code and Your Name.");
         return;
       }
       // Let the server know we're joining
       examSocketRef.current.emit("join_room", {
         roomCode,
         name: studentName,
         // If you want to store studentId on the server, you can pass it here
         studentId
       });
       setJoined(true); 
     }
   
     /* ------------------------------------------------------
      *  3) Local Time-Limit Logic
      * ------------------------------------------------------
      * We ensure no double submission if time hits 0 
      */
     useEffect(() => {
       if (timeLeft === null) return;
       if (timeLeft <= 0) return;
   
       const timer = setInterval(() => {
         setTimeLeft((prev) => {
           if (prev === null) return null;
           if (prev <= 1) {
             clearInterval(timer);
             // auto submit if not submitted
             if (!hasSubmitted && !examEnded) {
               handleCompleteSolution(true);
             }
             return 0;
           }
           return prev - 1;
         });
       }, 1000);
   
       return () => clearInterval(timer);
     }, [timeLeft, hasSubmitted, examEnded]);
   
     function formatTimeLeft() {
       if (timeLeft === null) return "";
       const m = Math.floor(timeLeft / 60);
       const s = timeLeft % 60;
       return `${m}:${s < 10 ? "0" : ""}${s}`;
     }
   
     /* ------------------------------------------------------
      *  4) Ephemeral Compiler Logic
      * ------------------------------------------------------ */
     const [language, setLanguage]          = useState("python");
     const [code, setCode]                  = useState("# Example code here...\n");
     const [consoleOutput, setConsoleOutput]= useState("");
     const [userInput, setUserInput]        = useState("");
     const [sessionActive, setSessionActive]= useState(false);
     const [plotImages, setPlotImages]      = useState([]);
   
     const compilerSocketRef = useRef(null);
   
     function appendConsole(str) {
       setConsoleOutput((prev) => prev + str);
     }
   
     // On unmount, kill ephemeral session
     useEffect(() => {
       return () => {
         if (compilerSocketRef.current) {
           compilerSocketRef.current.emit("disconnect_session");
           compilerSocketRef.current.disconnect();
         }
       };
     }, []);
   
     function handleLanguageChange(e) {
       const newLang = e.target.value;
       setLanguage(newLang);
   
       if (newLang === "sql") {
         setCode(
   `-- Welcome to SQL Online
   -- You can create tables, insert data, or do any SQL operation
   -- We have 4 pre-existing tables: employees, orders, shipping, customers
   
   -- Example:
   -- SELECT * FROM customers;
   `
         );
       } else {
         setCode("# Example code here...\n");
       }
     }
   
     function startEphemeralSession() {
       setConsoleOutput("Starting session...\n");
       setPlotImages([]);
       setUserInput("");
   
       if (!compilerSocketRef.current) {
         
         const compSock = io(BACKEND_URL);

         compilerSocketRef.current = compSock;
         setupCompilerHandlers(compSock);
       }
   
       compilerSocketRef.current.emit("start_session", {
         code: code.trim(),
         language,
       });
     }
   
     function setupCompilerHandlers(sock) {
       sock.on("connect", () => {
         appendConsole("Compiler socket connected.\n");
       });
   
       sock.on("session_error", (data) => {
         appendConsole("Session error: " + data.error + "\n");
         endEphemeralSession();
       });
   
       sock.on("session_started", () => {
         appendConsole("...Session started.\n");
         setSessionActive(true);
       });
   
       sock.on("python_output", (chunk) => {
         appendConsole(chunk.data);
       });
   
       sock.on("process_ended", () => {
         appendConsole("\n[Process ended]\n");
         endEphemeralSession();
       });
   
       sock.on("disconnect", () => {
         appendConsole("Compiler socket disconnected.\n");
         endEphemeralSession();
       });
   
       sock.on("plot_image", (data) => {
         const base64 = "data:image/png;base64," + data.image_base64;
         setPlotImages((prev) => [...prev, base64]);
       });
     }
   
     function sendLine() {
       if (!sessionActive || !compilerSocketRef.current) {
         appendConsole("[No active session]\n");
         return;
       }
       compilerSocketRef.current.emit("send_input", { line: userInput });
       setUserInput("");
     }
   
     function endEphemeralSession() {
       setSessionActive(false);
     }
   
     /* ------------------------------------------------------
      *  5) Final Submission to Teacher
      * ------------------------------------------------------
      * We ensure no double submission 
      * & trim trailing spaces from code 
      */
     function handleCompleteSolution(autoFromTime = false) {
       if (!examSocketRef.current) return;
       if (!joined || !roomCode) {
         alert("You haven't joined a room yet!");
         return;
       }
   
       if (hasSubmitted) {
         if (!autoFromTime) {
           console.log("Skipping second manual submission. Already submitted.");
           alert("You already submitted your final code.");
         }
         return;
       }
   
       // if exam ended => skip
       if (examEnded && !autoFromTime) {
         alert("Exam ended. No more submissions allowed.");
         return;
       }
   
       // Trim trailing spaces
       const finalCode = code.replace(/\s+$/, "");
   
       examSocketRef.current.emit("submit_solution", {
         roomCode,
         name: studentName,
         code: finalCode,
         language
       });
   
       setHasSubmitted(true);
   
       if (!autoFromTime) {
         alert("Solution submitted to teacher!");
       }
     }
   
     /* ------------------------------------------------------
      *  6) FULL SCREEN SHARING (STUDENT) INTEGRATION
      * ------------------------------------------------------
      */
     // Use the custom hook from ScreenShare.jsx,
     // passing in our examSocketRef, roomCode, and the studentId
     const {
       startShare,
       stopShare,
       isSharing,
       errorMessage
     } = useScreenShareStudent({
       
       socket: examSocketRef.current,           // ← ③ changed line
       roomCode, 
       studentId 
     }); 
   
     /* ------------------------------------------------------
      *  7) Render Student UI
      * ------------------------------------------------------ */
     if (!joined) {
       // Step 1: Show a form to join
       return (
         <div style={{ padding: "20px" }}>
           <h2>Join as Student</h2>
           <div style={{ marginBottom: "10px" }}>
             <label>Room Code:</label>{" "}
             <input
               type="text"
               value={roomCode}
               onChange={(e) => setRoomCode(e.target.value)}
             />
           </div>
           <div style={{ marginBottom: "10px" }}>
             <label>Your Name:</label>{" "}
             <input
               type="text"
               value={studentName}
               onChange={(e) => setStudentName(e.target.value)}
             />
           </div>
           <button onClick={handleJoinRoom}>Join Room</button>
         </div>
       );
     }
   
     // If we've joined, show the main exam interface
     return (
       <div style={{ padding: "20px" }}>
         <h2>Test Taker Page</h2>
   
         <p>
           <strong>Room Code:</strong> {roomCode} <br />
           <strong>Your Name:</strong> {studentName}
         </p>
   
         {/* Time Countdown */}
         {timeLeft !== null && timeLeft > 0 && (
           <p style={{ color: "red", fontWeight: "bold" }}>
             Time Left: {formatTimeLeft()}
           </p>
         )}
   
         {/* If exam ended => maybe show the 10s left to disconnect */}
         {examEnded && disconnectTimer !== null && (
           <p style={{ color: "orange", fontWeight: "bold" }}>
             Exam ended. Disconnecting in {disconnectTimer} seconds...
           </p>
         )}
   
         {/* Assignment from Teacher */}
         <div style={{ marginTop: "10px", marginBottom: "20px" }}>
           <label><strong>Assignment from Teacher:</strong></label>
           <div style={{ border: "1px solid #ccc", padding: "6px" }}>
             {taskText ? taskText : "No task yet..."}
           </div>
         </div>
   
         <hr/>
   
         {/* Ephemeral Compiler */}
         <h3>Write & Test Your Code</h3>
         <div style={{ marginBottom: "10px" }}>
           <label>Language: </label>
           <select
             value={language}
             onChange={handleLanguageChange}
             style={{ fontSize: "1rem", marginLeft: "8px" }}
           >
             <option value="python">Python</option>
             <option value="c">C</option>
             <option value="cpp">C++</option>
             <option value="java">Java</option>
             <option value="js">JavaScript</option>
             <option value="php">PHP</option>
             <option value="sql">SQL</option>
           </select>
         </div>
   
         <Editor
           height="300px"
           width="600px"
           language={mapMonacoLanguage(language)}
           theme="vs-dark"
           value={code}
           onChange={(val) => {
             if (val != null) {
               setCode(val);
             }
           }}
           options={{ lineNumbers: "on", folding: true }}
         />
   
         <br />
         <button onClick={startEphemeralSession}>Start Session (Run)</button>
   
         <div
           style={{
             width: "600px",
             height: "300px",
             border: "1px solid #333",
             background: "#f8f8f8",
             fontFamily: "monospace",
             whiteSpace: "pre-wrap",
             overflowY: "auto",
             padding: "5px",
             margin: "10px 0",
           }}
         >
           {consoleOutput}
         </div>
   
         {/* Images (Python plots, etc.) */}
         {plotImages.length > 0 && (
           <div
             style={{
               marginTop: "10px",
               border: "1px solid #ccc",
               width: "600px",
               minHeight: "1px",
               padding: "5px",
               background: "#fafafa",
               marginBottom: "10px",
             }}
           >
             {plotImages.map((imgSrc, idx) => (
               <img
                 key={idx}
                 src={imgSrc}
                 alt="Plot"
                 style={{ display: "block", marginBottom: "5px" }}
               />
             ))}
           </div>
         )}
   
         <div>
           <input
             type="text"
             placeholder="Type input..."
             disabled={!sessionActive}
             value={userInput}
             onChange={(e) => setUserInput(e.target.value)}
             onKeyDown={(e) => {
               if (e.key === "Enter") {
                 e.preventDefault();
                 sendLine();
               }
             }}
             style={{ width: "400px", marginRight: "10px" }}
           />
           <button onClick={sendLine} disabled={!sessionActive}>
             Send
           </button>
         </div>
   
         <hr />
   
         {/* Full Screen Sharing Section */}
         <h3>Share Entire Screen</h3>
         {!isSharing && (
           <button onClick={startShare} style={{ marginRight: "10px" }}>
             Start Screen Share
           </button>
         )}
         {isSharing && (
           <button onClick={stopShare} style={{ marginRight: "10px" }}>
             Stop Screen Share
           </button>
         )}
         {errorMessage && (
           <p style={{ color: "red", fontWeight: "bold" }}>
             {errorMessage}
           </p>
         )}
   
         <hr />
   
         {/* Final Submit */}
         <button
           onClick={() => handleCompleteSolution(false)}
           disabled={examEnded}
           style={{
             marginTop: "20px", 
             fontWeight: "bold",
             background: "lightgreen",
           }} 
         >
           Complete / Submit Final Code
         </button>
       </div>
     );
   }