/* TeacherPage.jsx */

import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react"; 
import { BACKEND_URL } from "./backendTest";

// 1) Import our teacher screen-share hook
import { useScreenShareTeacher } from "./ScreenShare";

// For syntax highlighting in Monaco:
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

export default function TeacherPage() {
  const navigate = useNavigate(); // We'll use this to redirect teacher to landing

  // ------------------------------------------------------------
  // 1) TEACHER EXAM-ROOM LOGIC
  // ------------------------------------------------------------
  const [roomCode, setRoomCode]         = useState("");
  const [roomCreated, setRoomCreated]   = useState(false);
  const [taskText, setTaskText]         = useState("");
  const [timeLimit, setTimeLimit]       = useState("");
  const [participants, setParticipants] = useState([]);

  // We store tasks with: { id, text, timeLimit, submissions: [...] }
  const [tasks, setTasks]               = useState([]);

  // Track if the exam ended or room closed
  const [examEnded, setExamEnded]       = useState(false);
  const [roomClosed, setRoomClosed]     = useState(false);


  



  // Our "exam logic" socket for teacher
  const teacherSocketRef = useRef(null);

  useEffect(() => { 
    // Connect the "exam logic" socket
    const sock = io(BACKEND_URL);
    teacherSocketRef.current = sock;
    if (roomCode) sock.emit("reconnect_teacher", { roomCode });
            

    sock.on("connect", () => {
      console.log("Teacher exam socket connected, id =", sock.id);
    });

    // If "room_created":
    sock.on("room_created", (data) => {
      setRoomCode(data.roomCode);
      setRoomCreated(true);
      console.log("Room created with code:", data.roomCode);
    });

    // Student joined:
    sock.on("student_joined", (data) => {
      // data = { studentName }
      setParticipants((prev) => [...prev, { name: data.studentName }]);
    });

    // If teacher ended exam => just set examEnded in local state
    sock.on("exam_ended", () => {
      alert("Exam ended. Students will disconnect in 10s, but you remain here.");
      setExamEnded(true);
    });

    // If "room_closed" => forcibly remove teacher as well => navigate to landing
    sock.on("room_closed", () => {
      alert("Room fully closed. Returning you to the landing page now...");
      setRoomClosed(true);
      sock.disconnect();
      navigate("/");
    });

    // A new final solution from a student
    sock.on("solution_submitted", (data) => {
      // data = { studentName, code, language, taskId? }
      const { studentName, code, language, taskId } = data;

      setTasks((prev) => {
        if (!taskId) {
          // No taskId => fallback to last task
          if (prev.length === 0) return prev;
          const lastIndex = prev.length - 1;
          const updatedTask = { ...prev[lastIndex] };
          updatedTask.submissions = [
            ...updatedTask.submissions,
            { studentName, code, language }
          ];
          const newArr = [...prev];
          newArr[lastIndex] = updatedTask;
          return newArr;
        }

        // If we do have a matching task by ID
        const idx = prev.findIndex((t) => t.id === taskId);
        if (idx < 0) {
          // not found => skip
          return prev;
        }
        const updated = { ...prev[idx] };
        updated.submissions = [
          ...updated.submissions,
          { studentName, code, language }
        ];
        const newArr = [...prev];
        newArr[idx] = updated;
        return newArr;
      });
    }); 

    sock.on("disconnect", () => {
      console.log("Teacher exam socket disconnected.");
    });

    return () => {
      sock.disconnect();
    };
  }, [navigate]);

  function handleCreateRoom() {
    if (!teacherSocketRef.current) return;
    teacherSocketRef.current.emit("create_room");
  }

  // Helper to generate a random taskId if needed
  function generateTaskId() {
    return "task_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  }

  function handleSendTask() {
    if (!teacherSocketRef.current || !roomCode) return;

    let parsedTime = parseInt(timeLimit, 10);
    if (isNaN(parsedTime)) parsedTime = 0; // means no time

    // create a new local task object
    const newTaskId = generateTaskId();
    const newTask = {
      id: newTaskId,
      text: taskText,
      timeLimit: parsedTime,
      submissions: []
    };

    setTasks((prev) => [...prev, newTask]);

    // Send to server
    teacherSocketRef.current.emit("send_task", {
      roomCode,
      taskText,
      timeLimit: parsedTime
      // optionally pass "taskId": newTaskId if you want grouping
    });

    alert(`Task sent. TimeLimit = ${
      parsedTime > 0 ? parsedTime + " min" : "No time"
    }`);
  }

  function handleEndExam() {
    if (!teacherSocketRef.current || !roomCode) return;
    if (!window.confirm(
      "Are you sure you want to end the exam? Students will have 10s to disconnect."
    )) {
      return;
    }
    teacherSocketRef.current.emit("end_exam", { roomCode });
  }

  function handleCloseRoom() {
    if (!teacherSocketRef.current || !roomCode) return;
    if (!window.confirm(
      "Really close the room? This forcibly disconnects everyone, including you."
    )) {
      return;
    }
    teacherSocketRef.current.emit("close_room", { roomCode });
  }

  // ------------------------------------------------------------
  // 2) EMBEDDED COMPILER LOGIC (EPHEMERAL PARTIAL-RUN FOR TEACHER)
  // ------------------------------------------------------------
  const [language, setLanguage]        = useState("python");
  const [code, setCode]               = useState("# Example code here...\n");
  const [consoleOutput, setConsoleOutput] = useState("");
  const [userInput, setUserInput]     = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [plotImages, setPlotImages]   = useState([]);

  const compilerSocketRef = useRef(null);

  function appendConsole(str) {
    setConsoleOutput((prev) => prev + str);
  }

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

-- Uncomment to test:
-- SELECT * FROM customers;
`
      );
    } else {
      setCode("# Example code here...\n");
    }
  } 

  function startSession() {
    setConsoleOutput("Starting session...\n");
    setPlotImages([]);
    setUserInput("");

    if (!compilerSocketRef.current) {
      const compilerSock = io(BACKEND_URL); 
      compilerSocketRef.current = compilerSock; 
      setupCompilerSocketHandlers(compilerSock);
    }

    compilerSocketRef.current.emit("start_session", {
      code: code.trim(),
      language
    });
  }

  function setupCompilerSocketHandlers(sock) {
    sock.on("connect", () => {
      appendConsole("Compiler socket connected.\n");
    });

    sock.on("session_error", (data) => {
      appendConsole("Session error: " + data.error + "\n");
      endCompilerSession();
    });

    sock.on("session_started", () => {
      appendConsole("...Session started.\n");
      setSessionActive(true);
    });

    sock.on("python_output", (data) => {
      appendConsole(data.data);
    });

    sock.on("process_ended", () => {
      appendConsole("\n[Process ended]\n");
      endCompilerSession();
    });

    sock.on("disconnect", () => {
      appendConsole("Compiler socket disconnected.\n");
      endCompilerSession();
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

  function endCompilerSession() { 
    setSessionActive(false);
  }

  /////////////////// 
  function VideoTile({ studentId, stream, onClose }) {
  const videoRef = useRef(null);

  // attach the MediaStream once we have both <video> & stream
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div style={{
      position: "relative",
      width: 260,
      border: "1px solid #ccc",
      borderRadius: 6,
      overflow: "hidden"
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: 150, objectFit: "cover" }}
      />
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        background: "rgba(0,0,0,.55)",
        color: "#fff",
        fontSize: 13,
        padding: "2px 6px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <span>{studentId}</span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "#fff",
            cursor: "pointer",
            fontSize: 15
          }}
          title="Remove this screen"
        >✕</button>
      </div>
    </div>
  );
}




  //////////////////////// 

  // ------------------------------------------------------------
  // 3) TEACHER'S SCREEN-SHARE VIEW
  // ------------------------------------------------------------
  // We'll import our teacher hook from "ScreenShare.jsx" above:
  const { screens, removeScreen } = useScreenShareTeacher({
    
    socket: teacherSocketRef.current,        // ← ③ changed line
            // ← ③ changed line
    roomCode
  });

  // The teacher can see each student's entire screen as a <video>.
  // `screens` is an array of { studentId, stream } from the hook.

  return (
    <div style={{ padding: "20px" }}>
      <h2>Teacher Page</h2>

      {/* CREATE ROOM or DISPLAY ROOM CODE */}
      {!roomCreated ? (
        <button onClick={handleCreateRoom} disabled={roomClosed}>
          Create Room
        </button>
      ) : (
        <div>
          <p>
            Room Code: <strong>{roomCode}</strong>
          </p>
        </div>
      )}

      <div style={{ marginTop: "10px" }}>
        <label>
          <strong>Assignment/Task:</strong>
        </label>
        <br />
        <textarea
          rows={4}
          cols={50}
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
        />
      </div>

      <div style={{ marginTop: "10px" }}>
        <label>
          <strong>Time Limit (minutes):</strong>
        </label>{" "}
        <input
          type="number"
          value={timeLimit}
          onChange={(e) => setTimeLimit(e.target.value)}
          style={{ width: "60px" }}
          placeholder="(empty => no time)"
        />
      </div>

      <div style={{ marginTop: "10px" }}>
        <button 
          onClick={handleSendTask}
          disabled={!roomCreated || examEnded || roomClosed}
        >
          Send Task
        </button>
      </div>

      <div style={{ marginTop: "20px" }}>
        <h4>Participants:</h4>
        <ul>
          {participants.map((p, idx) => (
            <li key={idx}>{p.name}</li>
          ))}
        </ul>
      </div>

      {/* "End Exam" vs "Close Room" */}
      <div style={{ marginTop: "20px" }}>
        <button 
          onClick={handleEndExam}
          disabled={!roomCreated || examEnded || roomClosed}
        >
          End Exam
        </button>{" "}
        <button 
          onClick={handleCloseRoom}
          disabled={!roomCreated || roomClosed}
        >
          Close Room
        </button>
      </div>

      <hr style={{ margin: "30px 0" }} />

      {/* Display tasks + submissions grouped by task */}
      <div style={{ marginTop: "20px" }}>
        <h3>Student Submissions (Grouped by Task)</h3>
        {tasks.length === 0 ? (
          <p>No tasks sent yet.</p>
        ) : (
          <div style={{ border: "1px solid #ccc", padding: "10px" }}>
            {tasks.map((task, tIndex) => (
              <div key={task.id} style={{ marginBottom: "20px" }}>
                <h4 style={{ margin: "5px 0" }}>
                  Task #{tIndex + 1}
                </h4>
                <div style={{ marginBottom: "5px" }}>
                  <strong>Task Text:</strong> {task.text}
                </div>
                <div style={{ marginBottom: "5px" }}>
                  <strong>Time Limit:</strong>{" "}
                  {task.timeLimit > 0 ? `${task.timeLimit} min` : "No time"}
                </div>

                {task.submissions.length === 0 ? (
                  <p style={{ fontStyle: "italic" }}>
                    No submissions yet for this task.
                  </p>
                ) : (
                  task.submissions.map((sub, sIndex) => (
                    <div 
                      key={sIndex} 
                      style={{ border: "1px solid #ddd", padding: "6px", marginTop: "8px" }}
                    >
                      <strong>Name:</strong> {sub.studentName} <br />
                      <strong>Language:</strong> {sub.language} <br />
                      <strong>Code:</strong>
                      <pre
                        style={{
                          background: "#f8f8f8",
                          border: "1px solid #ddd",
                          padding: "6px",
                          whiteSpace: "pre-wrap"
                        }}
                      >
                        {sub.code}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <hr style={{ margin: "30px 0" }} />

      {/* EMBEDDED COMPILER FOR TEACHER */}
      <h2>Ephemeral Compiler (for Teacher)</h2>

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
        onChange={(v) => {
          if (v != null) {
            setCode(v);
          }
        }}
        options={{ lineNumbers: "on", folding: true }}
      />
      <br />
      <button onClick={startSession}>Start Session</button>

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

      <hr style={{ margin: "30px 0" }} />

      {/* 4) TEACHER-SIDE SCREEN SHARE DISPLAY */}
      <h2>Student Screens (Live)</h2>
      <p style={{ fontStyle: "italic" }}>
        Below is a list of students currently sharing their screen.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {screens.map((s) => (
          <div key={s.studentId} style={{ border: "1px solid #ccc", padding: "4px" }}>
            <p><strong>Student:</strong> {s.studentId}</p>
            <video
              style={{ width: "300px", background: "#000" }}
              ref={(videoEl) => {
                if (videoEl) {
                  videoEl.srcObject = s.stream;
                  videoEl.play();
                }
              }}
              autoPlay
              playsInline
              muted
            />
            <div style={{ marginTop: "4px" }}>
              <button onClick={() => removeScreen(s.studentId)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}  