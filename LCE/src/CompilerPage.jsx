import React, { useState, useRef, useEffect } from "react";
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

  
 
  const startSession = () => {
    setConsoleOutput("Starting session...\n");
    setPlotImages([]); 
    setUserInput(""); 

    if (!socketRef.current) {
      socketRef.current = io(BACKEND_URL);  
      setupSocketHandlers(socketRef.current);
    }

  
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

export default App;
