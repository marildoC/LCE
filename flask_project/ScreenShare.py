# ScreenShare.py
import logging
from TSserver import socketio, rooms_data
from flask_socketio import emit

# Optional: for logging details
logger = logging.getLogger(__name__)

@socketio.on("screen_share_offer")
def handle_screen_share_offer(data):
    """
    Student has created a WebRTC offer for screen sharing.
    data = {
      'offer': <RTC offer SDP>,
      'roomCode': 'XYZ123',
      'studentId': 'someUniqueId'
    }
    We forward it to the teacher's socket in that room.
    """
    room_code = data.get('roomCode')
    student_id = data.get('studentId')
    offer = data.get('offer')

    if not room_code or room_code not in rooms_data:
        emit("session_error", {"error": f"Room {room_code} not found."}, broadcast=False)
        return

    # Identify the teacher's socket
    teacher_sid = rooms_data[room_code].get("teacherSocketId")
    if not teacher_sid:
        emit("session_error", {"error": f"No teacher socket found for room {room_code}."}, broadcast=False)
        return

    # Forward the offer to the teacher
    socketio.emit("screen_share_offer", {
        "offer": offer,
        "studentId": student_id
    }, room=teacher_sid)


@socketio.on("screen_share_answer")
def handle_screen_share_answer(data):
    """
    Teacher responds with an answer to the student's offer.
    data = {
      'answer': <RTC answer SDP>,
      'roomCode': 'XYZ123',
      'studentId': 'someUniqueId'
    }
    We forward it to the correct student's socket.
    """
    room_code = data.get('roomCode')
    student_id = data.get('studentId')
    answer = data.get('answer')

    if not room_code or room_code not in rooms_data:
        emit("session_error", {"error": f"Room {room_code} not found."}, broadcast=False)
        return

    # We need a way to map this studentId to their socket
    # If you store a mapping in rooms_data, e.g.:
    # rooms_data[roomCode]["studentSockets"] = { studentId -> sid }
    # Then we can look it up:
    student_sockets = rooms_data[room_code].get("studentSockets", {})
    student_sid = student_sockets.get(student_id)
    if not student_sid:
        emit("session_error", {"error": f"Student {student_id} socket not found."}, broadcast=False)
        return

    # Forward the answer to that student
    socketio.emit("screen_share_answer", {
        "answer": answer
    }, room=student_sid)


@socketio.on("ice_candidate")
def handle_ice_candidate(data):
    """
    ICE candidate from either student or teacher.
    data = {
      'candidate': <ICE candidate object>,
      'to': 'teacher' or 'student',
      'studentId': 'someUniqueId',
      'roomCode': 'XYZ123'
    }
    We'll forward to the appropriate socket.
    """
    room_code = data.get('roomCode')
    to_whom = data.get('to')  # 'teacher' or 'student'
    student_id = data.get('studentId')
    candidate = data.get('candidate')

    if not room_code or room_code not in rooms_data:
        emit("session_error", {"error": f"Room {room_code} not found."}, broadcast=False)
        return

    if to_whom == 'teacher':
        teacher_sid = rooms_data[room_code].get("teacherSocketId")
        if teacher_sid:
            socketio.emit("ice_candidate", {
                "candidate": candidate,
                "from": "student",
                "studentId": student_id
            }, room=teacher_sid)
    else:
        # to_whom == 'student'
        student_sockets = rooms_data[room_code].get("studentSockets", {})
        student_sid = student_sockets.get(student_id)
        if student_sid:
            socketio.emit("ice_candidate", {
                "candidate": candidate,
                "from": "teacher"
            }, room=student_sid)
