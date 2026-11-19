"""
Discovery router — upload event logs and discover process models.
"""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings
from app.models.graph import BPMNGraph, DFGGraph, GraphObject, PetriNetGraph, ProcessTreeGraph
from app.models.requests import DiscoverRequest
from app.utils.file_utils import ALLOWED_EVENT_LOG_EXTS, get_upload_path, save_upload

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", summary="Upload an event log file (XES or CSV)")
async def upload_event_log(file: UploadFile = File(...)):
    """Accept an XES or CSV event log and store it server-side. Returns a file_id."""
    try:
        file_id, saved_path = save_upload(file, settings.upload_dir, ALLOWED_EVENT_LOG_EXTS)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(exc))

    suffix = saved_path.suffix.lstrip(".")
    return {"file_id": file_id, "filename": file.filename, "format": suffix}


# ── Discover ──────────────────────────────────────────────────────────────────

@router.post(
    "/discover",
    summary="Discover a process model from an uploaded event log",
)
async def discover(body: DiscoverRequest):
    """
    Given a previously uploaded file_id and discovery parameters, run the
    selected algorithm and return a graph JSON object.
    """
    if not body.graph_id:
        raise HTTPException(status_code=422, detail="file_id (as graph_id) is required for discovery.")

    file_path = get_upload_path(body.graph_id, settings.upload_dir)
    suffix = file_path.suffix.lower()

    # Optional R bridge
    if body.use_r and settings.r_enabled and suffix == ".csv":
        try:
            from app.services.r_bridge.r_discovery import discover_with_r
            result = discover_with_r(
                csv_path=file_path,
                algorithm=body.algorithm,
                case_id=body.case_id_col,
                activity=body.activity_col,
                timestamp=body.timestamp_col,
                output_format=body.output,
            )
            return JSONResponse(content=result)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=f"R bridge error: {exc}")

    # Load event log
    try:
        log = _load_log(file_path, suffix, body)
    except Exception as exc:
        logger.exception("Failed to parse event log")
        raise HTTPException(status_code=422, detail=f"Could not parse event log: {exc}")

    # Discover
    try:
        graph = _run_discovery(log, body)
    except Exception as exc:
        logger.exception("Discovery failed")
        raise HTTPException(status_code=500, detail=f"Discovery error: {exc}")

    return graph


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_log(file_path: Path, suffix: str, body: DiscoverRequest):
    if suffix == ".xes":
        from app.services.parsers.xes_parser import parse_xes
        return parse_xes(file_path)
    elif suffix == ".csv":
        from app.services.parsers.csv_parser import parse_csv
        return parse_csv(
            file_path,
            case_id_col=body.case_id_col,
            activity_col=body.activity_col,
            timestamp_col=body.timestamp_col,
        )
    else:
        raise ValueError(f"Unsupported event log format: {suffix}")


def _run_discovery(log, body: DiscoverRequest) -> GraphObject:
    output = body.output
    algorithm = body.algorithm
    gid = None  # will be auto-generated
    gname = body.graph_name or f"{algorithm.title()} {output.replace('_', ' ').title()}"

    if output == "dfg":
        from app.services.discovery.dfg import discover_dfg
        return discover_dfg(log, graph_id=gid, graph_name=gname)

    elif output == "petri_net":
        from app.services.discovery.petri_net import discover_petri_net
        return discover_petri_net(log, algorithm=algorithm, graph_id=gid, graph_name=gname)

    elif output == "process_tree":
        from app.services.discovery.process_tree import discover_process_tree
        return discover_process_tree(log, graph_id=gid, graph_name=gname)

    elif output == "bpmn":
        from app.services.discovery.bpmn_discovery import discover_bpmn
        return discover_bpmn(log, graph_id=gid, graph_name=gname)

    else:
        raise ValueError(f"Unknown output format: {output}")
