"""
Benchmark Routes Blueprint
==========================
GET  /api/benchmark/catalogue         — return all library function descriptions
POST /api/benchmark/call              — call a catalogued function
GET  /api/benchmark/native-view/<lib> — open native visualisation for a library
"""

from flask import Blueprint, request, jsonify, current_app
from modules.benchmarking import BenchmarkRunner
from session_state        import state as _session
import os

benchmark_bp = Blueprint("benchmark", __name__)
runner       = BenchmarkRunner()


@benchmark_bp.route("/catalogue", methods=["GET"])
def catalogue():
    lib = request.args.get("library")   # optional filter
    cat = runner.get_catalogue()
    if lib:
        cat = {lib: cat.get(lib, [])}
    return jsonify({"ok": True, "catalogue": cat})


@benchmark_bp.route("/call", methods=["POST"])
def call_function():
    data     = request.get_json()
    library  = data.get("library", "")
    func_id  = data.get("func_id", "")
    params   = data.get("params", {})

    log_path = _session.get("filepath")

    result = runner.call_function(library, func_id, params, log_path=log_path)
    return jsonify({"ok": result["error"] is None, **result})


@benchmark_bp.route("/native-view/<library>", methods=["GET"])
def native_view(library: str):
    """
    Returns instructions / embed URL for the library's own visualisation.

    pm4py   → SVG already embedded via /api/graph/discover
    bupaR   → returns inline HTML if R is available
    bpmn-js → returns a URL to a hosted bpmn-js sandbox (or local iframe embed)
    mp4js   → returns a URL to the mp4js sandbox
    """
    views = {
        "pm4py": {
            "type":    "svg",
            "message": "Use /api/graph/discover to get the pm4py SVG natively.",
        },
        "bupar": {
            "type":    "r_widget",
            "message": "Call a bupaR function above to receive an HTML widget.",
        },
        "bpmn-js": {
            "type":    "iframe",
            "url":     "https://demo.bpmn.io/",
            "message": "bpmn-js runs in the browser. The embedded iframe below shows the demo.",
        },
        "mp4js": {
            "type":    "iframe",
            "url":     "https://mp4js.demo.example.com/",   # replace with real URL
            "message": "mp4js runs in the browser. No server-side call is possible.",
        },
    }
    info = views.get(library)
    if info is None:
        return jsonify({"ok": False, "error": f"Unknown library: {library}"}), 404
    return jsonify({"ok": True, "view": info})
