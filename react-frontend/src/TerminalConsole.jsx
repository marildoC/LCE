import React, { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

function TerminalConsole({ output, onData, terminalRef }) {
  /*
    output => string from server we append
    onData(line) => called when user hits Enter
    terminalRef => so parent can do terminalRef.current.clear() if needed
  */

  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const containerRef = useRef(null);

  const bufferRef = useRef("");

  useEffect(() => {
    xtermRef.current = new Terminal({
      cols: 80,
      rows: 20,
      disableStdin: false,
      cursorBlink: true
    });
    fitRef.current = new FitAddon();
    xtermRef.current.loadAddon(fitRef.current);
    xtermRef.current.open(containerRef.current);
    fitRef.current.fit();

    // handle user keystrokes
    xtermRef.current.onData(data => {
      if (data === "\r") {
        const line = bufferRef.current;
        onData(line); // pass to parent
        xtermRef.current.write("\r\n");
        bufferRef.current = "";
      }
      else if (data === "\u007F") {
        // backspace
        if (bufferRef.current.length>0) {
          bufferRef.current = bufferRef.current.slice(0, -1);
          xtermRef.current.write("\b \b");
        }
      }
      else {
        bufferRef.current += data;
        xtermRef.current.write(data);
      }
    });

    // Expose .clear() to parent
    if (terminalRef) {
      terminalRef.current = {
        clear: () => {
          xtermRef.current.clear();
          bufferRef.current="";
        }
      };
    }

    return () => {
      xtermRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    // whenever server output changes, append it
    if (output) {
      xtermRef.current.write(output.replace(/\n/g,"\r\n"));
    }
  }, [output]);

  return (
    <div
      ref={containerRef}
      style={{ width:600, height:300, border:"1px solid #333", marginTop:10 }}
    />
  );
}

export default TerminalConsole;
