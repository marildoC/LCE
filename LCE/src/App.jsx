// App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "./landingPage";
import TeacherPage from "./TeacherPage";
import StudentPage from "./StudentPage";
import CompilerPage from "./CompilerPage"; // optional if you still use it

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default landing route */}
        <Route path="/" element={<LandingPage />} />

        {/* Teacher route */}
        <Route path="/teacher" element={<TeacherPage />} />

        {/* Student route */}
        <Route path="/student" element={<StudentPage />} />

        {/* Optional single-user compiler route */}
        <Route path="/compiler" element={<CompilerPage />} />

        {/* Fallback: if no matching route, go back to Landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
