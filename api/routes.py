"""
api/routes.py
All /api/* endpoints. The heavy logic lives in core/.
"""
import pathlib
import tempfile

from flask import Blueprint, jsonify, request

from core.graph_loader import load_graph, to_cytoscape
from core.graph_processor import (
    process_graph, ProcessorConfig, FrequencyFilter, AttributeFilter,
    ReductionConfig, ReductionAlgorithm, FilterOp,
)
from core.layout_engine import compute as compute_layout, LAYOUTS

api_bp = Blueprint("api", __name__)

# In-memory graph store: session_id -> nx.DiGraph
# Replace with a proper cache / db for multi-user use
_graphs: dict[str, object] = {}


@api_bp.route("/upload", methods=["POST"])
def upload():
    """
    POST /api/upload
    Body: multipart/form-data with field 'file'
    Returns: { session_id, node_count, edge_count }
    """
    if "file" not in request.files:
        return jsonify(error="No file uploaded"), 400

    file = request.files["file"]
    suffix = pathlib.Path(file.filename).suffix

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        g = load_graph(tmp_path)
    except Exception as e:
        return jsonify(error=str(e)), 422

    session_id = str(id(g))           # TODO: use a real UUID / session
    _graphs[session_id] = g

    return jsonify(
        session_id=session_id,
        node_count=g.number_of_nodes(),
        edge_count=g.number_of_edges(),
    )


@api_bp.route("/graph/<session_id>", methods=["GET"])
def get_graph(session_id: str):
    """
    GET /api/graph/<session_id>
    Returns Cytoscape.js elements JSON for the stored graph.
    """
    g = _graphs.get(session_id)
    if g is None:
        return jsonify(error="Session not found"), 404
    return jsonify(to_cytoscape(g))


@api_bp.route("/layout/<session_id>", methods=["POST"])
def apply_layout(session_id: str):
    """
    POST /api/layout/<session_id>
    Body: { algorithm: "spring" | "spectral" | ... }
    Returns: { positions: { node_id: {x, y} } }
    """
    g = _graphs.get(session_id)
    if g is None:
        return jsonify(error="Session not found"), 404

    body = request.get_json(silent=True) or {}
    algorithm = body.get("algorithm", "spring")

    try:
        positions = compute_layout(g, algorithm)
    except Exception as e:
        return jsonify(error=str(e)), 422

    return jsonify(positions=positions)


@api_bp.route("/simplify/<session_id>", methods=["POST"])
def simplify(session_id: str):
    """
    POST /api/simplify/<session_id>

    Body (all fields optional):
    {
      "frequency_filter": {
        "min_frequency": 2,
        "max_frequency": null,
        "percentile_min": null,
        "frequency_attr": "weight",
        "apply_to_nodes": false,
        "apply_to_edges": true,
        "remove_orphans": true
      },
      "attribute_filters": [
        {"target": "edge", "key": "label", "op": "regex", "value": "^place_"}
      ],
      "reduction": {
        "algorithm": "FREQUENCY_THRESHOLD",
        "params": {"frequency_threshold": 5}
      }
    }
    """
    g = _graphs.get(session_id)
    if g is None:
        return jsonify(error="Session not found"), 404

    body = request.get_json(silent=True) or {}

    try:
        # ── frequency filter ─────────────────────────────────────────
        ff = None
        if "frequency_filter" in body:
            ff = FrequencyFilter(**body["frequency_filter"])

        # ── attribute filters ────────────────────────────────────────
        afs = []
        for f in body.get("attribute_filters", []):
            afs.append(AttributeFilter(
                target=f["target"],
                key=f["key"],
                op=FilterOp(f["op"]),
                value=f.get("value"),
            ))

        # ── reduction ────────────────────────────────────────────────
        rc = None
        if "reduction" in body:
            r = body["reduction"]
            rc = ReductionConfig(
                algorithm=ReductionAlgorithm[r["algorithm"]],
                params=r.get("params", {}),
            )

        config = ProcessorConfig(
            frequency_filter=ff,
            attribute_filters=afs,
            reduction=rc,
        )
        simplified = process_graph(g, config)

    except Exception as e:
        return jsonify(error=str(e)), 422

    _graphs[session_id] = simplified
    return jsonify(
        node_count=simplified.number_of_nodes(),
        edge_count=simplified.number_of_edges(),
        elements=to_cytoscape(simplified),
    )


@api_bp.route("/layouts", methods=["GET"])
def list_layouts():
    """GET /api/layouts — return available layout algorithm names."""
    return jsonify(layouts=LAYOUTS)
