"""
Simplification router — apply graph simplification algorithms.
"""
import json
import logging

from fastapi import APIRouter, HTTPException

from app.models.requests import SimplifyRequest
from app.services.simplification.simplifier import ALGORITHM_REGISTRY

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/algorithms", summary="List available simplification algorithms")
async def list_algorithms():
    """Return metadata for all registered simplification algorithms."""
    return {"algorithms": ALGORITHM_REGISTRY}


@router.post("/simplify", summary="Simplify a graph")
async def simplify_graph(body: SimplifyRequest):
    """
    Load a graph by graph_id and apply the requested simplification algorithm.
    Returns the simplified graph JSON.
    """
    from app.config import settings
    from app.utils.file_utils import get_upload_path

    # Try to load graph JSON
    json_path = settings.upload_dir / f"{body.graph_id}.json"
    if json_path.exists():
        graph = json.loads(json_path.read_text())
    else:
        # Maybe it was stored directly as a discovered graph by graph_id
        raise HTTPException(
            status_code=404,
            detail=f"Graph '{body.graph_id}' not found. Upload a graph first via /graphs/upload."
        )

    try:
        from app.services.simplification.simplifier import simplify
        result = simplify(graph, body.algorithm, body.threshold, body.params)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Simplification failed")
        raise HTTPException(status_code=500, detail=f"Simplification error: {exc}")

    return result
