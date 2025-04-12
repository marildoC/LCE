import os
import base64
import glob
import pexpect
import tempfile
import threading
import shlex
import shutil
import re

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

try:
    from PIL import Image
    PIL_ENABLED = True
except ImportError:
    PIL_ENABLED = False

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'some_secret'

socketio = SocketIO(app, cors_allowed_origins="*")

session_data = {
    "child": None,
    "temp_dir": None,
    "sql_temp_dir": None,
    "temp_file": None,
    "thread": None,
    "closing": False,
    "sent_images": set()
}

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

def find_public_class_name(java_code):
    match = re.search(r"public\s+class\s+([A-Za-z_]\w*)", java_code)
    return match.group(1) if match else None

@app.route("/")
def index():
    return "WebSocket-based multi-language runner."

@socketio.on("start_session")
def start_session(data):
    code = data.get("code", "").strip()
    language = data.get("language", "python").strip().lower()

    if not code:
        emit("session_error", {"error": "No code provided"})
        return
    if language not in LANG_EXTENSIONS:
        emit("session_error", {"error": f"Unsupported language '{language}'"})
        return


    if language != "sql":
        _cleanup_session()

        tmp_dir = tempfile.mkdtemp(prefix="user_session_")
        extension = LANG_EXTENSIONS[language]
        code_file_name = f"user_code.{extension}"
        code_path = os.path.join(tmp_dir, code_file_name)


        if language == "java":
            cname = find_public_class_name(code)
            if cname:
                code_file_name = f"{cname}.java"
                code_path = os.path.join(tmp_dir, code_file_name)
                run_cmd = f"javac {shlex.quote(code_file_name)} && java {shlex.quote(cname)}"
            else:
                run_cmd = "javac user_code.java && java user_code"
        else:
            run_cmd = LANG_COMMANDS[language]

        with open(code_path, "w", encoding="utf-8") as f:
            f.write(code)

        shell_cmd = f"cd {shlex.quote(tmp_dir)} && env TERM=dumb {run_cmd}"

        try:
            child = pexpect.spawn("/bin/bash", ["-c", shell_cmd],
                                  encoding="utf-8", timeout=None)
        except Exception as e:
            emit("session_error", {"error": str(e)})
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return


        session_data["child"] = child
        session_data["temp_dir"] = tmp_dir
        session_data["temp_file"] = code_path
        session_data["thread"] = None
        session_data["closing"] = False
        session_data["sent_images"] = set()

        def read_output():
            try:
                while not session_data["closing"] and child.isalive():
                    try:
                        chunk = child.read_nonblocking(size=1, timeout=0.1)
                        if chunk:
                            socketio.emit("python_output", {"data": chunk})
                    except pexpect.exceptions.TIMEOUT:
                        pass
                    except pexpect.exceptions.EOF:
                        break

                if not session_data["closing"]:
                    leftover = ""
                    try:
                        leftover = child.read()
                    except:
                        pass
                    if leftover:
                        socketio.emit("python_output", {"data": leftover})

            except Exception as e:
                socketio.emit("session_error", {"error": str(e)})


            if not session_data["closing"]:
                _scan_for_new_images()
                socketio.emit("process_ended", {})

            _cleanup_session()

        t = threading.Thread(target=read_output, daemon=True)
        session_data["thread"] = t
        t.start()

        emit("session_started", {})
        return





    if not session_data["sql_temp_dir"]:

        tmp_dir = tempfile.mkdtemp(prefix="sql_session_")
        session_data["sql_temp_dir"] = tmp_dir

        prepop_path = os.path.join(os.path.dirname(__file__), "prepopulate.sql")
        if os.path.exists(prepop_path):
            shell_cmd = f"cd {shlex.quote(tmp_dir)} && sqlite3 ephemeral.db < {shlex.quote(prepop_path)}"
            os.system(shell_cmd)
        else:
            print("Warning: prepopulate.sql not found, skipping prepopulation")

    else:

        tmp_dir = session_data["sql_temp_dir"]


    code_path = os.path.join(tmp_dir, "user_code.sql")
    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)


    run_cmd = "sqlite3 ephemeral.db < user_code.sql"
    shell_cmd = f"cd {shlex.quote(tmp_dir)} && env TERM=dumb {run_cmd}"


    try:
        child = pexpect.spawn("/bin/bash", ["-c", shell_cmd],
                              encoding="utf-8", timeout=None)
    except Exception as e:
        emit("session_error", {"error": str(e)})

        return

    session_data["child"] = child
    session_data["temp_dir"] = None
    session_data["temp_file"] = code_path
    session_data["thread"] = None
    session_data["closing"] = False
    session_data["sent_images"] = set()

    def read_sql_output():
        try:
            while not session_data["closing"] and child.isalive():
                try:
                    chunk = child.read_nonblocking(size=1, timeout=0.1)
                    if chunk:
                        socketio.emit("python_output", {"data": chunk})
                except pexpect.exceptions.TIMEOUT:
                    pass
                except pexpect.exceptions.EOF:
                    break

            if not session_data["closing"]:
                leftover = ""
                try:
                    leftover = child.read()
                except:
                    pass
                if leftover:
                    socketio.emit("python_output", {"data": leftover})

        except Exception as e:
            socketio.emit("session_error", {"error": str(e)})



        if not session_data["closing"]:
            _scan_for_new_images()
            socketio.emit("process_ended", {})

    t = threading.Thread(target=read_sql_output, daemon=True)
    session_data["thread"] = t
    t.start()

    emit("session_started", {})

@socketio.on("send_input")
def handle_send_input(data):
    if session_data["closing"]:
        emit("python_output", {"data": "[Session closed]\n"})
        socketio.emit("process_ended", {})
        _cleanup_session()
        return

    child = session_data.get("child")
    if not child or not child.isalive():
        emit("python_output", {"data": "[No active session]\n"})
        socketio.emit("process_ended", {})
        _cleanup_session()
        return

    line = data.get("line", "")
    child.sendline(line)

@socketio.on("disconnect_session")
def handle_disconnect_session():

    if session_data["child"] and not session_data["closing"]:
        socketio.emit("python_output", {"data": "[Session killed by user]\n"})
    _cleanup_session()
    socketio.emit("process_ended", {})

def _scan_for_new_images():
    tmp_dir = session_data.get("temp_dir")
    if not tmp_dir or not os.path.isdir(tmp_dir):
        return
    patterns = ["*.png", "*.jpg", "*.jpeg"]
    for pat in patterns:
        for path in glob.glob(os.path.join(tmp_dir, pat)):
            if path not in session_data["sent_images"]:
                _handle_plot_file(path)

def _handle_plot_file(filepath):
    if filepath in session_data["sent_images"]:
        return
    if not os.path.exists(filepath):
        socketio.emit("session_error", {"error": f"Plot file not found: {filepath}"})
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
        })
        session_data["sent_images"].add(filepath)
    except Exception as e:
        socketio.emit("session_error", {"error": f"Could not handle plot file {filepath}: {str(e)}"})

def _cleanup_session():
    if session_data["closing"]:
        return
    session_data["closing"] = True

    child = session_data.get("child")
    if child and child.isalive():
        child.terminate(force=True)
    session_data["child"] = None


    tmp_dir = session_data.get("temp_dir")
    if tmp_dir and os.path.isdir(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)
    session_data["temp_dir"] = None


    sql_dir = session_data.get("sql_temp_dir")
    if sql_dir and os.path.isdir(sql_dir):
        shutil.rmtree(sql_dir, ignore_errors=True)
    session_data["sql_temp_dir"] = None

    session_data["temp_file"] = None
    session_data["thread"] = None
    session_data["sent_images"] = set()


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
