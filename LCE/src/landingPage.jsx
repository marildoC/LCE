// LandingPage.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();

  const handleCreateAsTeacher = () => {
    navigate("/teacher");
  };

  const handleJoinAsStudent = () => {
    navigate("/student");
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Online Exam & Coding Environment</h1>
      <p>Welcome! Choose one of the following options:</p>

      <button 
        onClick={handleCreateAsTeacher} 
        style={{ marginRight: "10px", padding: "8px", cursor: "pointer" }}
      >
        Create Exam (Teacher)
      </button>

      <button 
        onClick={handleJoinAsStudent} 
        style={{ padding: "8px", cursor: "pointer" }}
      >
        Join Exam (Student)
      </button>

      <div style={{ marginTop: "20px" }}>
        <p>
          If you'd like to test a single-user compiler,
          you can also click below: 
        </p>
        <button 
          onClick={() => navigate("/compiler")}
          style={{ padding: "8px", cursor: "pointer" }}
        >
          Go to Compiler
        </button>
      </div>
    </div>
  );
}
