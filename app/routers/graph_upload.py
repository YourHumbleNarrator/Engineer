"""
Graph upload router — convert generic graph files to DFG-style JSON.
"""
import json
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import settings
from app.utils.file_utils import ALLOWED_GRAPH_EXTS, get_upload_path, save_upload

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload", summary="Upload and convert a graph file")
async def upload_graph(file: UploadFile = File(...)):
    """
    Accept a graph file (GML, GraphML, GEXF, Pajek .net, CSV edge list,
    YAML, TXT edge list, XES) and convert it to DFG-style JSON.
    Returns the converted graph plus a graph_id for later retrieval.
    """
    try:
        file_id, saved_path = save_upload(file, settings.upload_dir, ALLOWED_GRAPH_EXTS)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Graph upload failed")
        raise HTTPException(status_code=500, detail=str(exc))

    suffix = saved_path.suffix.lstrip(".")

    try:
        from app.services.graph_conversion.converter import convert
        graph_dict = convert(saved_path, suffix)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Graph conversion failed")
        raise HTTPException(status_code=500, detail=f"Conversion error: {exc}")

    # Persist converted graph JSON alongside the original
    json_path = settings.upload_dir / f"{file_id}.json"
    json_path.write_text(json.dumps(graph_dict))

    return {
        "graph_id": file_id,
        "filename": file.filename,
        "format": suffix,
        "graph": graph_dict,
    }


@router.get("/{graph_id}", summary="Retrieve a previously converted graph")
async def get_graph(graph_id: str):
    """
    Load a graph that was previously uploaded and converted.
    Returns the DFG-style JSON dict.
    """
    json_path = settings.upload_dir / f"{graph_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found.")
    try:
        return json.loads(json_path.read_text())
    except Exception as exc:
        logger.exception("Failed to load graph JSON")
        raise HTTPException(status_code=500, detail=str(exc))
