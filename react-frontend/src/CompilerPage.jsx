import React, { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";
import { BACKEND_URL } from "./backendTest"; 

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

function App() {
  const [language, setLanguage] = useState("python"); 
  const [code, setCode] = useState(`# Example code here...\n`);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [userInput, setUserInput] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [plotImages, setPlotImages] = useState([]);

  const socketRef = useRef(null);

  const appendConsole = (text) => {
    setConsoleOutput((prev) => prev + text);
  };

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.emit("disconnect_session");
        socketRef.current.disconnect();
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
      setCode(`# Example code here...\n`);
    }
  }

  const startSession = () => {
    setConsoleOutput("Starting session...\n");
    setPlotImages([]); 
    setUserInput(""); 

    if (!socketRef.current) {
      socketRef.current = io(BACKEND_URL);  
      setupSocketHandlers(socketRef.current);
    }

    socketRef.current.emit("start_session", { 
      code: code.trim(),
      language: language,
    });
  };

  // Socket event handlers
  const setupSocketHandlers = (socket) => {
    socket.on("connect", () => {
      appendConsole("Socket connected.\n");
    });

    socket.on("session_error", (data) => {
      appendConsole("Session error: " + data.error + "\n");
      endCurrentSession();
    });

    socket.on("session_started", () => {
      appendConsole("...Session started.\n");
      setSessionActive(true);
    });

    socket.on("python_output", (data) => {
      appendConsole(data.data);
    });

    socket.on("process_ended", () => {
      appendConsole("\n[Process ended]\n");
      endCurrentSession();
    });

    socket.on("disconnect", () => {
      appendConsole("Socket disconnected.\n");
      endCurrentSession();
    });

    socket.on("plot_image", (data) => {
      const base64 = `data:image/png;base64,${data.image_base64}`; 
      setPlotImages((prev) => [...prev, base64]);
    });
  };

  const sendLine = () => {
    if (!sessionActive || !socketRef.current) {
      appendConsole("[No active session]\n");
      return;
    }
    socketRef.current.emit("send_input", { line: userInput });
    setUserInput("");
  };

  const endCurrentSession = () => {
    setSessionActive(false);
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>Multi-Language Compiler</h1>

      {/* Language dropdown */}
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

      <h3>Code Editor</h3>
      <Editor
        height="300px"
        width="600px"
        language={mapMonacoLanguage(language)}
        theme="vs-dark"
        value={code}
        onChange={(newValue) => {
          if (newValue != null) {
            setCode(newValue);
          }
        }}
        options={{
          lineNumbers: "on",
          folding: true,
        }}
      />

      <br />
      <button onClick={startSession}>Start Session</button>

      { }
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

      {  }
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
    </div>   
  );
}

export default App;
