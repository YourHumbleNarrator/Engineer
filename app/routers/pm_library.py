"""
PM Library router — browse and invoke pm4py functions.
"""
import base64
import io
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.models.requests import PMFunctionViewRequest
from app.utils.pm_registry import CATEGORIES, FUNCTION_MAP, FUNCTION_REGISTRY

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/functions", summary="List all pm4py functions grouped by category")
async def list_functions(category: str = None):
    """Return all registered pm4py functions, optionally filtered by category."""
    funcs = FUNCTION_REGISTRY
    if category:
        funcs = [f for f in funcs if f["category"] == category]
    grouped: dict = {}
    for f in funcs:
        grouped.setdefault(f["category"], []).append(f)
    return {
        "categories": CATEGORIES,
        "total": len(funcs),
        "functions": grouped,
    }


@router.get("/functions/{function_name}", summary="Get details for a specific pm4py function")
async def get_function(function_name: str):
    """Return detailed metadata for a single pm4py function."""
    fn = FUNCTION_MAP.get(function_name)
    if fn is None:
        raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found in registry.")

    # Attempt to fetch live docstring from pm4py
    try:
        import importlib
        module_path, fn_attr = fn["pm4py_function"].rsplit(".", 1)
        mod = importlib.import_module(module_path)
        live_fn = getattr(mod, fn_attr, None)
        if live_fn and live_fn.__doc__:
            fn = {**fn, "docstring": live_fn.__doc__.strip()}
    except Exception:
        pass  # fall back to registry description

    return fn


@router.post("/functions/{function_name}/view", summary="Run a pm4py or bupaR function and return visualization")
async def view_function(function_name: str, body: PMFunctionViewRequest):
    """
    Load an event log by file_id, run the specified function, and return a
    base64-encoded PNG of the visualization, or the raw JSON result for
    non-visual functions.

    bupaR functions (e.g. ``process_map``) are rendered via an R subprocess
    using processmapR → DiagrammeRsvg → rsvg; all other functions use pm4py.
    """
    from app.config import settings
    from app.utils.file_utils import get_upload_path

    fn_meta = FUNCTION_MAP.get(function_name)
    if fn_meta is None:
        raise HTTPException(status_code=404, detail=f"Function '{function_name}' not in registry.")

    file_path = get_upload_path(body.file_id, settings.upload_dir)
    suffix = file_path.suffix.lower()

    # ── bupaR functions — route to R bridge directly (CSV only) ──────────────
    _BUPAR_FUNCTIONS = {"process_map"}

    if function_name in _BUPAR_FUNCTIONS:
        try:
            return _dispatch_bupar(function_name, file_path, suffix, fn_meta, body.extra_params)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("bupaR function view failed")
            raise HTTPException(status_code=500, detail=f"bupaR error: {exc}")

    # ── pm4py functions — load log then dispatch ──────────────────────────────
    try:
        if suffix == ".xes":
            from app.services.parsers.xes_parser import parse_xes
            log = parse_xes(file_path)
        elif suffix == ".csv":
            from app.services.parsers.csv_parser import parse_csv
            log = parse_csv(file_path)
        else:
            raise HTTPException(status_code=422, detail=f"Unsupported file format for pm4py view: {suffix}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse event log: {exc}")

    # Dispatch based on function name / category
    try:
        return _dispatch_and_visualize(function_name, log, fn_meta, body.extra_params)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("pm4py function view failed")
        raise HTTPException(status_code=500, detail=f"pm4py error: {exc}")


# ── bupaR dispatch ────────────────────────────────────────────────────────────

def _dispatch_bupar(
    function_name: str,
    file_path: Path,
    suffix: str,
    fn_meta: dict,
    extra_params: dict,
):
    """
    Route a bupaR function call to the R bridge.

    For ``process_map`` the uploaded file is converted to CSV if needed
    (bupaR's R script only speaks CSV), then passed to
    ``render_process_map_png`` which runs:
        processmapR::process_map() → DiagrammeRsvg::export_svg() → rsvg::rsvg_png()

    Returns a JSONResponse with ``image_format`` and ``image_base64`` keys,
    matching the same envelope as the pm4py visual functions.
    """
    from app.services.r_bridge.r_discovery import render_process_map_png, r_is_available

    if not r_is_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "R is not available on this server. "
                "Install R and the packages bupaR, processmapR, DiagrammeRsvg, rsvg."
            ),
        )

    # bupaR script expects a CSV; convert XES → CSV on the fly
    if suffix == ".xes":
        import tempfile
        import pandas as pd
        from app.services.parsers.xes_parser import parse_xes_to_dataframe
        df = parse_xes_to_dataframe(file_path)
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w") as tmp:
            df.to_csv(tmp, index=False)
            csv_path = Path(tmp.name)
    elif suffix == ".csv":
        csv_path = file_path
    else:
        raise HTTPException(
            status_code=422,
            detail=f"bupaR process_map requires a .xes or .csv file, got '{suffix}'.",
        )

    case_id   = extra_params.get("case_id",   "case:concept:name")
    activity  = extra_params.get("activity",  "concept:name")
    timestamp = extra_params.get("timestamp", "time:timestamp")
    map_type  = extra_params.get("type",      "frequency")

    if map_type not in ("frequency", "performance"):
        raise HTTPException(
            status_code=422,
            detail=f"'type' must be 'frequency' or 'performance', got '{map_type}'.",
        )

    image_b64 = render_process_map_png(
        csv_path  = csv_path,
        case_id   = case_id,
        activity  = activity,
        timestamp = timestamp,
        map_type  = map_type,
    )

    return JSONResponse({
        "function":     function_name,
        "image_format": "png",
        "image_base64": image_b64,
    })


# ── pm4py dispatch ────────────────────────────────────────────────────────────

def _dispatch_and_visualize(function_name: str, log, fn_meta: dict, extra_params: dict):
    import pm4py
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    visual_fns = {
        "discover_dfg",
        "discover_performance_dfg",
        "discover_petri_net_alpha",
        "discover_petri_net_inductive",
        "discover_petri_net_heuristics",
        "discover_process_tree_inductive",
        "discover_bpmn_inductive",
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        out_png = str(Path(tmpdir) / "output.png")

        if function_name == "discover_dfg":
            dfg, start, end = pm4py.discover_dfg(log)
            pm4py.save_vis_dfg(dfg, start, end, out_png)
            return _png_response(out_png, function_name)

        elif function_name == "discover_performance_dfg":
            dfg, start, end = pm4py.discover_performance_dfg(log)
            pm4py.save_vis_performance_dfg(dfg, start, end, out_png)
            return _png_response(out_png, function_name)

        elif function_name in ("discover_petri_net_alpha", "discover_petri_net_inductive", "discover_petri_net_heuristics"):
            if function_name == "discover_petri_net_alpha":
                net, im, fm = pm4py.discover_petri_net_alpha(log)
            elif function_name == "discover_petri_net_heuristics":
                net, im, fm = pm4py.discover_petri_net_heuristics(log)
            else:
                net, im, fm = pm4py.discover_petri_net_inductive(log)
            pm4py.save_vis_petri_net(net, im, fm, out_png)
            return _png_response(out_png, function_name)

        elif function_name == "discover_process_tree_inductive":
            tree = pm4py.discover_process_tree_inductive(log)
            pm4py.save_vis_process_tree(tree, out_png)
            return _png_response(out_png, function_name)

        elif function_name == "discover_bpmn_inductive":
            bpmn = pm4py.discover_bpmn_inductive(log)
            pm4py.save_vis_bpmn(bpmn, out_png)
            return _png_response(out_png, function_name)

        elif function_name == "get_variants":
            variants = pm4py.get_variants(log)
            return JSONResponse({"function": function_name, "result": {str(k): len(v) for k, v in variants.items()}})

        elif function_name == "get_start_activities":
            return JSONResponse({"function": function_name, "result": pm4py.get_start_activities(log)})

        elif function_name == "get_end_activities":
            return JSONResponse({"function": function_name, "result": pm4py.get_end_activities(log)})

        elif function_name == "get_event_attribute_values":
            attr = extra_params.get("attribute", "concept:name")
            vals = pm4py.get_event_attribute_values(log, attr)
            return JSONResponse({"function": function_name, "attribute": attr, "result": vals})

        else:
            return JSONResponse({
                "function": function_name,
                "message": "Direct invocation not implemented for this function. Use the discovery endpoints instead.",
                "metadata": fn_meta,
            })


def _png_response(png_path: str, function_name: str):
    with open(png_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return JSONResponse({
        "function": function_name,
        "image_format": "png",
        "image_base64": data,
    })