"""
Upload Routes Blueprint
=======================
POST /api/upload/file  — upload a graph file and load it into session state
GET  /api/upload/status — return current loaded file info
"""

import os
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename

from modules.graph_loader import GraphLoader, EXTENSION_MAP
from modules.graph_stats import GraphStats
from session_state import set_graph_state

upload_bp = Blueprint("upload", __name__)
loader = GraphLoader()
stats_eng = GraphStats()

ALLOWED_EXTENSIONS = set(EXTENSION_MAP.keys())

_current_file = {"name": None, "format": None, "export_format": None}


def _allowed(filename: str) -> bool:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in ALLOWED_EXTENSIONS


@upload_bp.route("/file", methods=["POST"])
def upload_file():
    try:
        return _upload_file_inner()
    except Exception as e:
        import traceback
        return jsonify({"ok": False, "error": str(e),
                        "detail": traceback.format_exc()}), 200


def _upload_file_inner():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file field in request"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"ok": False, "error": "Empty filename"}), 400

    if not _allowed(file.filename):
        return jsonify({
            "ok":    False,
            "error": f"Unsupported file type. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        }), 400

    filename = secure_filename(file.filename)
    folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, filename)
    file.save(path)

    try:
        result = loader.load(path)
    except Exception as e:
        import traceback
        return jsonify({"ok": False, "error": str(e),
                        "detail": traceback.format_exc()}), 200  # 200 so fetch() doesn't throw

    G = result["graph"]
    log = result["log"]
    set_graph_state(G, log, result["export_data"],
                    result["export_format"], filepath=path)

    from session_state import state

    print(f"[UPLOAD] log in state: {state['log']}, type: {type(state['log'])}")

    _current_file["name"] = filename
    _current_file["format"] = result["source_format"]
    _current_file["export_format"] = result["export_format"]

    return jsonify({
        "ok":            True,
        "filename":      filename,
        "source_format": result["source_format"],
        "export_format": result["export_format"],
        "has_log":       log is not None,
        "stats":         stats_eng.compute(G),
    })


@upload_bp.route("/status", methods=["GET"])
def status():
    return jsonify({"ok": True, "current_file": _current_file})
