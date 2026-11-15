"""
Process Mining Web App — Entry Point
=====================================
Run:  python app.py
Deps: pip install flask pm4py networkx graphviz pandas pyyaml lxml
"""

import sys, os
# Ensure the project root is always on sys.path regardless of CWD,
# so that `modules.*`, `routes.*` and `session_state` resolve correctly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask
from routes.graph_routes import graph_bp
from routes.benchmark_routes import benchmark_bp
from routes.upload_routes import upload_bp

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["EXPORT_FOLDER"] = "exports"
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1 GB

app.register_blueprint(graph_bp,     url_prefix="/api/graph")
app.register_blueprint(benchmark_bp, url_prefix="/api/benchmark")
app.register_blueprint(upload_bp,    url_prefix="/api/upload")

# Serve the single-page frontend
from flask import send_from_directory

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")

@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
