import os
import uuid
import pexpect
import tempfile
import threading

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'some_secret'

socketio = SocketIO(app, cors_allowed_origins="*")


session_data = {
    "child": None,
    "temp_file": None,
    "thread": None,
    "closing": False,
}

@app.route('/')
def index():
    return "WebSocket-based Python runner. Use Socket.IO events."

@socketio.on('start_session')
def handle_start_session(data):
    code = data.get('code', '').strip()
    if not code:
        emit('session_error', {'error': 'No code provided'})
        return

    _cleanup_session()

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".py")
    code_path = tmp_file.name
    tmp_file.write(code.encode("utf-8"))
    tmp_file.close()

    child = pexpect.spawn("python3", ["-u", code_path], encoding="utf-8", timeout=None)

    session_data["child"] = child
    session_data["temp_file"] = code_path
    session_data["thread"] = None
    session_data["closing"] = False

    def read_output():
        try:
            while not session_data["closing"] and child.isalive():
                try:

                    chunk = child.read_nonblocking(size=1, timeout=0.1)
                    if chunk:
                        socketio.emit('python_output', {'data': chunk})
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
                    socketio.emit('python_output', {'data': leftover})
        except Exception as e:
            socketio.emit('session_error', {'error': str(e)})

        if not session_data["closing"]:
            socketio.emit('process_ended', {})
        _cleanup_session()

    t = threading.Thread(target=read_output, daemon=True)
    session_data["thread"] = t
    t.start()

    emit('session_started', {})

@socketio.on('send_input')
def handle_send_input(data):
    child = session_data.get("child")
    closing = session_data.get("closing", False)
    if not child or closing or not child.isalive():
        emit('python_output', {'data': '[No active session or session closed]\n'})
        socketio.emit('process_ended', {})
        _cleanup_session()
        return

    line = data.get('line', '')
    child.sendline(line)

@socketio.on('disconnect_session')
def handle_disconnect_session():
    if session_data["child"] and not session_data["closing"]:
        socketio.emit('python_output', {'data': '[Session killed by user]\n'})
    _cleanup_session()
    socketio.emit('process_ended', {})

def _cleanup_session():
    if session_data["closing"]:
        return
    session_data["closing"] = True

    child = session_data.get("child")
    if child:
        if child.isalive():
            child.terminate(force=True)
        session_data["child"] = None

    tmp_file = session_data.get("temp_file")
    if tmp_file:
        try:
            os.remove(tmp_file)
        except FileNotFoundError:
            pass
    session_data["temp_file"] = None
    session_data["thread"] = None

if __name__ == '__main__':
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
