"""
Graph Routes Blueprint
======================
POST /api/graph/discover   — run discovery on loaded log
GET  /api/graph/stats      — return graph statistics
GET  /api/graph/table      — return node/edge tables
POST /api/graph/filter     — apply frequency or attribute filter
POST /api/graph/reduce     — apply a reduction algorithm
GET  /api/graph/layout     — compute layout positions
GET  /api/graph/export     — download converted graph (JSON or CSV)
GET  /api/graph/svg        — download last SVG
"""

import json
import base64
import os
from flask import Blueprint, request, jsonify, current_app, send_file
import networkx as nx

from modules.discovery       import DiscoveryEngine
from modules.graph_stats     import GraphStats
from modules.graph_filter    import GraphFilter
from modules.layout_selector import LayoutSelector
from session_state           import state as _state   # shared with upload_routes

graph_bp = Blueprint("graph", __name__)

discovery  = DiscoveryEngine()
stats_eng  = GraphStats()
filter_eng = GraphFilter()
layout_sel = LayoutSelector()


@graph_bp.route("/discover", methods=["POST"])
def discover():
    try:
        return _discover_inner()
    except Exception as e:
        import traceback
        return jsonify({"ok": False, "stub": True,
                        "stub_reason": f"{type(e).__name__}: {e}",
                        "detail": traceback.format_exc(),
                        "svg": "", "model": {}, "type": "", "layout": {}}), 200

def _discover_inner():
    data       = request.get_json(silent=True) or {}
    graph_type = data.get("graph_type", "dfg")
    miner      = data.get("miner", "alpha")

    result = discovery.discover(_state["log"], graph_type, miner)
    if result.get("svg"):
        _state["last_svg"] = result["svg"]

    # Build positions for the network view
    G = _state["graph"]
    layout_info = {}
    if G is not None:
        layout_info = layout_sel.pick(G, override=data.get("layout"))

    return jsonify({
        "ok":          True,
        "svg":         result.get("svg", ""),
        "model":       result.get("model", {}),
        "type":        result.get("type"),
        "stub":        result.get("stub", False),
        "stub_reason": result.get("reason", ""),
        "layout":      layout_info,
    })


@graph_bp.route("/stats", methods=["GET"])
def stats():
    G = _state["graph"]
    if G is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400
    return jsonify({"ok": True, "stats": stats_eng.compute(G)})


@graph_bp.route("/table", methods=["GET"])
def table():
    G = _state["graph"]
    if G is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400
    target = request.args.get("target", "edge")
    if target == "node":
        data = stats_eng.to_node_table(G)
    else:
        data = stats_eng.to_edge_table(G)
    return jsonify({"ok": True, "table": data, "target": target})


@graph_bp.route("/filter", methods=["POST"])
def filter_graph():
    G = _state["graph"]
    if G is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400

    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "frequency")

    if mode == "frequency":
        H = filter_eng.filter_by_frequency(
            G,
            min_frequency=float(data.get("min_frequency", 1)),
            frequency_attr=data.get("frequency_attr", "frequency"),
        )
    elif mode == "attribute":
        H = filter_eng.filter_by_attribute(
            G,
            target=data.get("target", "edge"),
            attribute=data.get("attribute", ""),
            operator=data.get("operator", "eq"),
            value=data.get("value"),
            keep_matching=data.get("keep_matching", True),
        )
    else:
        return jsonify({"ok": False, "error": f"Unknown filter mode: {mode}"}), 400

    _state["graph"] = H
    return jsonify({"ok": True, "stats": stats_eng.compute(H),
                    "message": f"Filtered: {H.number_of_nodes()} nodes, "
                               f"{H.number_of_edges()} edges remain."})


@graph_bp.route("/reduce", methods=["POST"])
def reduce_graph():
    G = _state["graph"]
    if G is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400

    data         = request.get_json(silent=True) or {}
    algorithm_id = data.get("algorithm_id", "")
    params       = data.get("params", {})

    try:
        H = filter_eng.reduce(G, algorithm_id, params)
        _state["graph"] = H
        return jsonify({"ok": True, "stats": stats_eng.compute(H)})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@graph_bp.route("/algorithms", methods=["GET"])
def list_algorithms():
    return jsonify({"ok": True, "algorithms": filter_eng.get_algorithms()})


@graph_bp.route("/layout", methods=["GET"])
def layout():
    G = _state["graph"]
    if G is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400
    override = request.args.get("layout")
    info     = layout_sel.pick(G, override=override)
    return jsonify({"ok": True, "layout": info})


@graph_bp.route("/export", methods=["GET"])
def export_graph():
    if _state["export_data"] is None:
        return jsonify({"ok": False, "error": "No graph loaded"}), 400
    fmt  = _state["export_format"]
    mime = "application/json" if fmt == "json" else "text/csv"
    ext  = fmt

    path = os.path.join(current_app.config["EXPORT_FOLDER"], f"graph_export.{ext}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(_state["export_data"])
    return send_file(path, mimetype=mime, as_attachment=True,
                     download_name=f"graph_export.{ext}")


@graph_bp.route("/svg", methods=["GET"])
def download_svg():
    if _state["last_svg"] is None:
        return jsonify({"ok": False, "error": "No SVG available. Run discovery first."}), 400
    svg_bytes = base64.b64decode(_state["last_svg"])
    path      = os.path.join(current_app.config["EXPORT_FOLDER"], "graph.svg")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(svg_bytes)
    return send_file(path, mimetype="image/svg+xml", as_attachment=True,
                     download_name="graph.svg")



