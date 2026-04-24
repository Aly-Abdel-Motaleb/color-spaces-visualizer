import os
import socket
from flask import Flask, send_from_directory

SERVE_DIR = os.path.abspath(".")
app = Flask(__name__)

@app.route("/")
def index():
    return send_from_directory(SERVE_DIR, "exercise1_vr.html")

@app.route("/<path:filename>")
def files(filename):
    return send_from_directory(SERVE_DIR, filename)

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    return ip

ip = get_ip()
print(f"\n  Open on phone: http://{ip}:5000\n")
app.run(host="0.0.0.0", port=5000, debug=False)
