"""
Export router — render graph JSON to SVG.
"""
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.models.requests import SVGExportRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/svg", summary="Export a graph to SVG", response_class=Response)
async def export_svg(body: SVGExportRequest):
    """
    Accept a graph JSON (any kind: dfg, petri_net, process_tree, bpmn)
    and return an SVG string rendered with matplotlib.
    """
    try:
        from app.services.export.svg_exporter import export_graph_to_svg
        svg_str = export_graph_to_svg(
            graph_json=body.graph_json,
            width=body.width,
            height=body.height,
            theme=body.theme,
        )
    except Exception as exc:
        logger.exception("SVG export failed")
        raise HTTPException(status_code=500, detail=f"SVG export error: {exc}")

    return Response(content=svg_str, media_type="image/svg+xml")
