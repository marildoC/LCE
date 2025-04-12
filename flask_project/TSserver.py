"""
TSserver.py – Now integrates with ScreenShare + studentId mapping
"""

import os
import base64
import glob
import pexpect
import tempfile
import threading
import shlex
import shutil
import re
import random
import string

from flask import Flask, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room

try:
    from PIL import Image
    PIL_ENABLED = True
except ImportError:
    PIL_ENABLED = False

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'some_secret_key'

socketio = SocketIO(app, cors_allowed_origins="*")

# <<< ADDED: Import the screen share events >>>
import ScreenShare  # This file contains @socketio.on("screen_share_offer"), etc.

# ------------------
# 1) Data Structures
# ------------------
rooms_data = {}
# example:
# rooms_data = {
#   "ABC123": {
#       "teacherSocketId": "...",
#       "participants": set([...]),
#       "taskText": "",
#       "timeLimit": 0,
#       "examEnded": False,
#       "submittedUsers": set(),
#       # <<< ADDED: store a dict for student IDs
#       "studentSockets": { "someStudentId": "theStudentSocketId" }
#   }
# }

ephemeral_sessions = {}
# ephemeral_sessions[sid] = { ... }  # unchanged

LANG_EXTENSIONS = {
    "python": "py",
    "c": "c",
    "cpp": "cpp",
    "java": "java",
    "js": "js",
    "php": "php",
    "sql": "sql"
}

LANG_COMMANDS = {
    "python": "python3 -u user_code.py",
    "c": "gcc -fdiagnostics-color=never user_code.c -o main && ./main",
    "cpp": "g++ -fdiagnostics-color=never user_code.cpp -o main && ./main",
    "java": "",
    "js": "node user_code.js",
    "php": "php user_code.php",
    "sql": ""
}

def generate_room_code():
    return ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))

def find_public_class_name(java_code):
    match = re.search(r"public\s+class\s+([A-Za-z_]\w*)", java_code)
    return match.group(1) if match else None

@app.route("/")
def index():
    return "Multi-language runner + Enhanced exam logic"

# ----------------------------
# 2) EXAM ROOM EVENTS
# ----------------------------
@socketio.on("create_room")
def handle_create_room():
    code = generate_room_code()
    rooms_data[code] = {
        "teacherSocketId": request.sid,
        "participants": set(),
        "taskText": "",
        "timeLimit": 0,
        "examEnded": False,
        "submittedUsers": set(),
        # <<< ADDED >>>
        "studentSockets": {}  # map studentId -> sid
    }
    join_room(code)
    socketio.emit("room_created", {"roomCode": code}, room=request.sid)

@socketio.on("send_task")
def handle_send_task(data):
    roomCode = data.get("roomCode")
    taskText = data.get("taskText", "")
    timeLimit = data.get("timeLimit", 0)

    if roomCode not in rooms_data:
        socketio.emit("session_error",
                      {"error": f"Room {roomCode} not found"},
                      room=request.sid)
        return

    rooms_data[roomCode]["taskText"] = taskText
    rooms_data[roomCode]["timeLimit"] = timeLimit
    rooms_data[roomCode]["examEnded"] = False
    rooms_data[roomCode]["submittedUsers"].clear()

    socketio.emit("new_task", {
        "taskText": taskText,
        "timeLimit": timeLimit
    }, room=roomCode)

@socketio.on("end_exam")
def handle_end_exam(data):
    roomCode = data.get("roomCode")
    if not roomCode or (roomCode not in rooms_data):
        return

    rooms_data[roomCode]["examEnded"] = True
    socketio.emit("exam_ended", {}, room=roomCode)

@socketio.on("close_room")
def handle_close_room(data):
    roomCode = data.get("roomCode")
    if not roomCode or (roomCode not in rooms_data):
        return

    socketio.emit("room_closed", {}, room=roomCode)
    del rooms_data[roomCode]

@socketio.on("join_room")
def handle_join_room(data):
    roomCode = data.get("roomCode")
    studentName = data.get("name", "Unknown")
    # <<< ADDED: check if there's a studentId
    studentId = data.get("studentId")

    if roomCode not in rooms_data:
        socketio.emit("session_error",
                      {"error": f"Room {roomCode} not found"},
                      room=request.sid)
        return

    join_room(roomCode)
    rooms_data[roomCode]["participants"].add(request.sid)

    # <<< ADDED: If this user has a studentId, store it
    if studentId:
        if "studentSockets" not in rooms_data[roomCode]:
            rooms_data[roomCode]["studentSockets"] = {}
        rooms_data[roomCode]["studentSockets"][studentId] = request.sid

    socketio.emit("student_joined", {
        "studentName": studentName
    }, room=roomCode)

@socketio.on("submit_solution")
def handle_submit_solution(data):
    roomCode    = data.get("roomCode")
    studentName = data.get("name", "Unknown")
    code        = data.get("code", "")
    language    = data.get("language", "")
    taskId      = data.get("taskId", None)

    if roomCode not in rooms_data:
        socketio.emit("session_error",
                      {"error": f"Room {roomCode} not found"},
                      room=request.sid)
        return

    if rooms_data[roomCode]["examEnded"]:
        socketio.emit("session_error",
                      {"error": "Exam ended. No more submissions."},
                      room=request.sid)
        return

    if request.sid in rooms_data[roomCode]["submittedUsers"]:
        # quietly ignore second submission
        return

    rooms_data[roomCode]["submittedUsers"].add(request.sid)

    code = code.rstrip()

    socketio.emit("solution_submitted", {
        "studentName": studentName,
        "code": code,
        "language": language,
        "taskId": taskId
    }, room=roomCode)

# ------------------------------------------------
# 3) EPHEMERAL CODE EXECUTION (PER USER)
# ------------------------------------------------

@socketio.on("start_session")
def start_session(data):
    sid = request.sid
    code = data.get("code", "").strip()
    language = data.get("language", "python").strip().lower()

    if not code:
        socketio.emit("session_error", {"error": "No code provided"}, room=sid)
        return
    if language not in LANG_EXTENSIONS:
        socketio.emit("session_error", {"error": f"Unsupported language '{language}'"}, room=sid)
        return

    cleanup_ephemeral_session(sid)

    ephemeral_sessions[sid] = {
        "child": None,
        "temp_dir": None,
        "sql_temp_dir": None,
        "temp_file": None,
        "thread": None,
        "closing": False,
        "sent_images": set()
    }
    session_obj = ephemeral_sessions[sid]

    if language != "sql":
        tmp_dir = tempfile.mkdtemp(prefix="user_session_")
        session_obj["temp_dir"] = tmp_dir

        extension = LANG_EXTENSIONS[language]
        code_file_name = f"user_code.{extension}"
        code_path = os.path.join(tmp_dir, code_file_name)

        run_cmd = LANG_COMMANDS[language]
        if language == "java":
            cname = find_public_class_name(code)
            if cname:
                code_file_name = f"{cname}.java"
                code_path = os.path.join(tmp_dir, code_file_name)
                run_cmd = f"javac {shlex.quote(code_file_name)} && java {shlex.quote(cname)}"
            else:
                run_cmd = "javac user_code.java && java user_code"

        with open(code_path, "w", encoding="utf-8") as f:
            f.write(code)

        shell_cmd = f"cd {shlex.quote(tmp_dir)} && env TERM=dumb {run_cmd}"
        try:
            child = pexpect.spawn("/bin/bash", ["-c", shell_cmd], encoding="utf-8", timeout=None)
        except Exception as e:
            socketio.emit("session_error", {"error": str(e)}, room=sid)
            shutil.rmtree(tmp_dir, ignore_errors=True)
            ephemeral_sessions.pop(sid, None)
            return

        session_obj["child"] = child
        session_obj["temp_file"] = code_path

        def read_output():
            try:
                while not session_obj["closing"] and child.isalive():
                    try:
                        chunk = child.read_nonblocking(size=1, timeout=0.1)
                        if chunk:
                            socketio.emit("python_output", {"data": chunk}, room=sid)
                    except pexpect.exceptions.TIMEOUT:
                        pass
                    except pexpect.exceptions.EOF:
                        break

                if not session_obj["closing"]:
                    leftover = ""
                    try:
                        leftover = child.read()
                    except:
                        pass
                    if leftover:
                        socketio.emit("python_output", {"data": leftover}, room=sid)
            except Exception as e:
                socketio.emit("session_error", {"error": str(e)}, room=sid)

            if not session_obj["closing"]:
                scan_for_new_images(sid)
                socketio.emit("process_ended", {}, room=sid)

            cleanup_ephemeral_session(sid)

        t = threading.Thread(target=read_output, daemon=True)
        session_obj["thread"] = t
        t.start()

        socketio.emit("session_started", {}, room=sid)
        return

    # If language == "sql"
    tmp_dir = tempfile.mkdtemp(prefix="sql_session_")
    session_obj["sql_temp_dir"] = tmp_dir

    prepop_path = os.path.join(os.path.dirname(__file__), "prepopulate.sql")
    if os.path.exists(prepop_path):
        shell_cmd = f"cd {shlex.quote(tmp_dir)} && sqlite3 ephemeral.db < {shlex.quote(prepop_path)}"
        os.system(shell_cmd)

    code_path = os.path.join(tmp_dir, "user_code.sql")
    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)

    shell_cmd = f"cd {shlex.quote(tmp_dir)} && env TERM=dumb sqlite3 ephemeral.db < user_code.sql"
    try:
        child = pexpect.spawn("/bin/bash", ["-c", shell_cmd], encoding="utf-8", timeout=None)
    except Exception as e:
        socketio.emit("session_error", {"error": str(e)}, room=sid)
        ephemeral_sessions.pop(sid, None)
        return

    session_obj["child"] = child
    session_obj["temp_file"] = code_path

    def read_sql_output():
        try:
            while not session_obj["closing"] and child.isalive():
                try:
                    chunk = child.read_nonblocking(size=1, timeout=0.1)
                    if chunk:
                        socketio.emit("python_output", {"data": chunk}, room=sid)
                except pexpect.exceptions.TIMEOUT:
                    pass
                except pexpect.exceptions.EOF:
                    break

            if not session_obj["closing"]:
                leftover = ""
                try:
                    leftover = child.read()
                except:
                    pass
                if leftover:
                    socketio.emit("python_output", {"data": leftover}, room=sid)
        except Exception as e:
            socketio.emit("session_error", {"error": str(e)}, room=sid)

        if not session_obj["closing"]:
            scan_for_new_images(sid)
            socketio.emit("process_ended", {}, room=sid)

        cleanup_ephemeral_session(sid)

    t = threading.Thread(target=read_sql_output, daemon=True)
    session_obj["thread"] = t
    t.start()

    socketio.emit("session_started", {}, room=sid)

@socketio.on("send_input")
def handle_send_input(data):
    sid = request.sid
    session_obj = ephemeral_sessions.get(sid)
    if not session_obj:
        socketio.emit("python_output", {"data": "[No active session]\n"}, room=sid)
        socketio.emit("process_ended", {}, room=sid)
        return

    if session_obj["closing"]:
        socketio.emit("python_output", {"data": "[Session closed]\n"}, room=sid)
        socketio.emit("process_ended", {}, room=sid)
        cleanup_ephemeral_session(sid)
        return

    child = session_obj.get("child")
    if not child or not child.isalive():
        socketio.emit("python_output", {"data": "[No active session]\n"}, room=sid)
        socketio.emit("process_ended", {}, room=sid)
        cleanup_ephemeral_session(sid)
        return

    line = data.get("line", "")
    child.sendline(line)

@socketio.on("disconnect_session")
def handle_disconnect_session():
    sid = request.sid
    session_obj = ephemeral_sessions.get(sid)
    if session_obj and not session_obj["closing"]:
        socketio.emit("python_output", {"data": "[Session killed by user]\n"}, room=sid)
    cleanup_ephemeral_session(sid)
    socketio.emit("process_ended", {}, room=sid)

# ---------------------------
# 4) File/Plot & Session Cleanup
# ---------------------------

def scan_for_new_images(sid):
    session_obj = ephemeral_sessions.get(sid)
    if not session_obj:
        return

    tmp_dir = session_obj.get("temp_dir")
    if not tmp_dir or not os.path.isdir(tmp_dir):
        return

    patterns = ["*.png", "*.jpg", "*.jpeg"]
    for pat in patterns:
        for path in glob.glob(os.path.join(tmp_dir, pat)):
            if path not in session_obj["sent_images"]:
                handle_plot_file(sid, path)

def handle_plot_file(sid, filepath):
    session_obj = ephemeral_sessions.get(sid)
    if not session_obj:
        return

    if not os.path.exists(filepath):
        socketio.emit("session_error",
                      {"error": f"Plot file not found: {filepath}"},
                      room=sid)
        return

    try:
        if PIL_ENABLED:
            from PIL import Image
            im = Image.open(filepath)
            max_dim = 800
            if im.width > max_dim or im.height > max_dim:
                im.thumbnail((max_dim, max_dim))
            import io
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            buf.seek(0)
            image_data = buf.read()
        else:
            with open(filepath, "rb") as f:
                image_data = f.read()

        b64 = base64.b64encode(image_data).decode("utf-8")
        socketio.emit("plot_image", {
            "filename": os.path.basename(filepath),
            "image_base64": b64
        }, room=sid)

        session_obj["sent_images"].add(filepath)
    except Exception as e:
        socketio.emit("session_error",
                      {"error": f"Could not handle plot file {filepath}: {str(e)}"},
                      room=sid)

def cleanup_ephemeral_session(sid):
    session_obj = ephemeral_sessions.get(sid)
    if not session_obj:
        return
    if session_obj["closing"]:
        return

    session_obj["closing"] = True

    child = session_obj.get("child")
    if child and child.isalive():
        child.terminate(force=True)

    tmp_dir = session_obj.get("temp_dir")
    if tmp_dir and os.path.isdir(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)
    session_obj["temp_dir"] = None

    sql_dir = session_obj.get("sql_temp_dir")
    if sql_dir and os.path.isdir(sql_dir):
        shutil.rmtree(sql_dir, ignore_errors=True)
    session_obj["sql_temp_dir"] = None

    session_obj["child"] = None
    session_obj["temp_file"] = None
    session_obj["thread"] = None
    session_obj["sent_images"] = set()

    ephemeral_sessions.pop(sid, None)

# -----------
# 5) Run
# -----------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
