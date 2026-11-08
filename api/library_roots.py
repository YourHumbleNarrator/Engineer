"""
/api/libraries/*  –  Library benchmark panel back-end routes.

Endpoints
---------
GET  /api/libraries
    Return the full library registry (metadata only, no results).

POST /api/library/execute
    Execute a pm4py function server-side.
    Body: { "function_id": str, "params": {str: any}, "session": str }
    Returns: { "ok": bool, "result": any, "image_b64": str|null, "error": str|null }

GET  /api/library/state
    Return what artefacts are currently held in the session store so the
    client knows which function buttons to enable.
    Query: ?session=<sid>
    Returns: { "has_log": bool, "has_petri": bool, "has_bpmn": bool,
               "has_process_tree": bool, "log_summary": {...} }
"""

from __future__ import annotations

import base64
import io
import traceback
from typing import Any

from flask import Blueprint, jsonify, request, session

# Registry -------------------------------------------------------------------
from core.library_registry import LIBRARIES  # type: ignore

# In-memory session store: {session_id: {"log": ..., "petri": ..., ...}}
# For production replace with server-side cache (Redis, etc.)
_SESSION_STORE: dict[str, dict[str, Any]] = {}

library_bp = Blueprint("library", __name__, url_prefix="/api")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_store(sid: str) -> dict[str, Any]:
    return _SESSION_STORE.setdefault(sid, {})


def _session_id() -> str:
    """Return (or create) a stable session identifier."""
    if "lib_sid" not in session:
        import uuid
        session["lib_sid"] = str(uuid.uuid4())
    return session["lib_sid"]


def _render_to_png_b64(render_func, *args) -> str | None:
    """Call a pm4py visualisation function and capture its PNG as base-64."""
    try:
        import pm4py  # type: ignore
        from pm4py.visualization.common import save  # type: ignore
        gviz = render_func(*args)
        buf = io.BytesIO()
        # pm4py uses graphviz.Source; render to bytes
        png_bytes = gviz.pipe(format="png")
        return base64.b64encode(png_bytes).decode()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@library_bp.get("/libraries")
def get_libraries():
    """Return the full registry – function metadata without any results."""
    return jsonify(LIBRARIES)


@library_bp.get("/library/state")
def get_state():
    sid = request.args.get("session") or _session_id()
    store = _get_store(sid)

    summary: dict[str, Any] = {}
    if "log" in store:
        log = store["log"]
        try:
            import pm4py  # type: ignore
            summary = {
                "num_cases": len(log),
                "num_events": sum(len(trace) for trace in log),
                "num_activities": len(pm4py.get_event_attribute_values(log, "concept:name")),
            }
        except Exception:
            summary = {}

    return jsonify({
        "session": sid,
        "has_log": "log" in store,
        "has_petri": "petri_net" in store,
        "has_bpmn": "bpmn_xml" in store,
        "has_process_tree": "process_tree" in store,
        "log_summary": summary,
    })


@library_bp.post("/library/execute")
def execute_function():
    body = request.get_json(force=True) or {}
    function_id: str = body.get("function_id", "")
    params: dict = body.get("params", {})
    sid: str = body.get("session") or _session_id()

    store = _get_store(sid)

    try:
        result, image_b64 = _dispatch(function_id, params, store)
        return jsonify({"ok": True, "result": result, "image_b64": image_b64})
    except Exception as exc:
        tb = traceback.format_exc()
        return jsonify({"ok": False, "result": None, "image_b64": None, "error": str(exc), "traceback": tb}), 500


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

def _dispatch(function_id: str, params: dict, store: dict) -> tuple[Any, str | None]:
    """Route a function_id to the actual pm4py call and return (result, image_b64)."""
    import pm4py  # type: ignore

    image_b64: str | None = None

    # ---- Statistics --------------------------------------------------------
    if function_id == "pm4py.get_start_activities":
        r = pm4py.get_start_activities(store["log"])
        return _jsonable(r), None

    if function_id == "pm4py.get_end_activities":
        r = pm4py.get_end_activities(store["log"])
        return _jsonable(r), None

    if function_id == "pm4py.get_variants":
        r = pm4py.get_variants(store["log"])
        # keys are tuples, convert to strings
        return {" → ".join(k): v for k, v in r.items()}, None

    if function_id == "pm4py.get_event_attributes":
        r = pm4py.get_event_attributes(store["log"])
        return sorted(r), None

    # ---- Discovery ---------------------------------------------------------
    if function_id == "pm4py.discover_dfg":
        dfg, start, end = pm4py.discover_dfg(store["log"])
        store["dfg"] = (dfg, start, end)
        readable = {f"{a} → {b}": cnt for (a, b), cnt in dfg.items()}
        return {
            "edges": readable,
            "start_activities": start,
            "end_activities": end,
        }, None

    if function_id == "pm4py.discover_petri_net_alpha":
        net, im, fm = pm4py.discover_petri_net_alpha(store["log"])
        store["petri_net"] = (net, im, fm)
        return _describe_petri(net, im, fm), None

    if function_id == "pm4py.discover_petri_net_inductive":
        net, im, fm = pm4py.discover_petri_net_inductive(store["log"])
        store["petri_net"] = (net, im, fm)
        return _describe_petri(net, im, fm), None

    if function_id == "pm4py.discover_petri_net_heuristics":
        net, im, fm = pm4py.discover_petri_net_heuristics(store["log"])
        store["petri_net"] = (net, im, fm)
        return _describe_petri(net, im, fm), None

    if function_id == "pm4py.discover_process_tree_inductive":
        tree = pm4py.discover_process_tree_inductive(store["log"])
        store["process_tree"] = tree
        return {"tree": str(tree)}, None

    if function_id == "pm4py.discover_bpmn_inductive":
        bpmn_model = pm4py.discover_bpmn_inductive(store["log"])
        from pm4py.objects.conversion.bpmn import exporter as bpmn_exporter  # type: ignore
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(suffix=".bpmn", delete=False) as f:
            tmp_path = f.name
        pm4py.write_bpmn(bpmn_model, tmp_path)
        with open(tmp_path) as f:
            xml = f.read()
        os.unlink(tmp_path)
        store["bpmn_xml"] = xml
        store["bpmn_model"] = bpmn_model
        return {"bpmn_xml": xml, "length": len(xml)}, None

    # ---- Conformance -------------------------------------------------------
    if function_id == "pm4py.fitness_token_based_replay":
        net, im, fm = store["petri_net"]
        r = pm4py.fitness_token_based_replay(store["log"], net, im, fm)
        return r, None

    if function_id == "pm4py.precision_token_based_replay":
        net, im, fm = store["petri_net"]
        r = pm4py.precision_token_based_replay(store["log"], net, im, fm)
        return {"precision": r}, None

    if function_id == "pm4py.conformance_diagnostics_token_based_replay":
        net, im, fm = store["petri_net"]
        r = pm4py.conformance_diagnostics_token_based_replay(
            store["log"], net, im, fm)
        return _jsonable(r[:50]), None   # cap at 50 traces for readability

    if function_id == "pm4py.conformance_diagnostics_alignments":
        net, im, fm = store["petri_net"]
        r = pm4py.conformance_diagnostics_alignments(store["log"], net, im, fm)
        return _jsonable(r[:50]), None

    # ---- Filtering ---------------------------------------------------------
    if function_id == "pm4py.filter_variants_top_k":
        k = int(params.get("k", 5))
        filtered = pm4py.filter_variants_top_k(store["log"], k)
        store["log"] = filtered
        return {"filtered_cases": len(filtered), "k": k}, None

    if function_id == "pm4py.filter_case_performance":
        mn = float(params.get("min_perf", 0))
        mx = float(params.get("max_perf", 86400))
        filtered = pm4py.filter_case_performance(store["log"], mn, mx)
        store["log"] = filtered
        return {"filtered_cases": len(filtered), "min_perf": mn, "max_perf": mx}, None

    if function_id == "pm4py.filter_activities_rework":
        from pm4py.algo.filtering.log.rework import rework_filter  # type: ignore
        filtered = pm4py.filter_activities_rework(store["log"])
        store["log"] = filtered
        return {"filtered_cases": len(filtered)}, None

    # ---- Native Visualisation (server-side PNG) ----------------------------
    if function_id == "pm4py.view_dfg":
        if "dfg" not in store:
            dfg, start, end = pm4py.discover_dfg(store["log"])
            store["dfg"] = (dfg, start, end)
        dfg, start, end = store["dfg"]
        image_b64 = _pm4py_dfg_png(dfg, start, end)
        return {"message": "DFG rendered"}, image_b64

    if function_id == "pm4py.view_petri_net":
        net, im, fm = store["petri_net"]
        image_b64 = _pm4py_petri_png(net, im, fm)
        return {"message": "Petri net rendered"}, image_b64

    if function_id == "pm4py.view_process_tree":
        tree = store["process_tree"]
        image_b64 = _pm4py_tree_png(tree)
        return {"message": "Process tree rendered"}, image_b64

    if function_id == "pm4py.view_bpmn":
        model = store.get("bpmn_model")
        if model is None:
            model = pm4py.discover_bpmn_inductive(store["log"])
            store["bpmn_model"] = model
        image_b64 = _pm4py_bpmn_png(model)
        return {"message": "BPMN rendered"}, image_b64

    raise ValueError(f"Unknown or non-executable function_id: {function_id!r}")


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _pm4py_dfg_png(dfg, start, end) -> str | None:
    try:
        from pm4py.visualization.dfg import visualizer as dfg_vis  # type: ignore
        gviz = dfg_vis.apply(dfg, log=None, parameters={
            dfg_vis.Variants.FREQUENCY.value.Parameters.START_ACTIVITIES: start,
            dfg_vis.Variants.FREQUENCY.value.Parameters.END_ACTIVITIES: end,
        })
        return base64.b64encode(dfg_vis.serialize(gviz)).decode()
    except Exception:
        return None


def _pm4py_petri_png(net, im, fm) -> str | None:
    try:
        from pm4py.visualization.petri_net import visualizer as pn_vis  # type: ignore
        gviz = pn_vis.apply(net, im, fm)
        return base64.b64encode(pn_vis.serialize(gviz)).decode()
    except Exception:
        return None


def _pm4py_tree_png(tree) -> str | None:
    try:
        from pm4py.visualization.process_tree import visualizer as pt_vis  # type: ignore
        gviz = pt_vis.apply(tree)
        return base64.b64encode(pt_vis.serialize(gviz)).decode()
    except Exception:
        return None


def _pm4py_bpmn_png(model) -> str | None:
    try:
        from pm4py.visualization.bpmn import visualizer as bpmn_vis  # type: ignore
        gviz = bpmn_vis.apply(model)
        return base64.b64encode(bpmn_vis.serialize(gviz)).decode()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _describe_petri(net, im, fm) -> dict:
    return {
        "places": len(net.places),
        "transitions": len(net.transitions),
        "arcs": len(net.arcs),
        "initial_marking": {str(p): v for p, v in im.items()},
        "final_marking": {str(p): v for p, v in fm.items()},
    }


def _jsonable(obj: Any) -> Any:
    """Recursively convert objects to JSON-safe primitives."""
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, set):
        return sorted(_jsonable(v) for v in obj)
    if isinstance(obj, (int, float, bool, str)) or obj is None:
        return obj
    return str(obj)
