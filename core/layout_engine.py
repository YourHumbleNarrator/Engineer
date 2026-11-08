"""
layout_engine.py
Compute 2-D node positions using NetworkX layout algorithms.
Returns a dict {node_id: {"x": float, "y": float}} for the frontend.
"""
import networkx as nx

# Scale factor: Cytoscape works in pixels
_SCALE = 500


LAYOUTS = ["spring", "spectral", "kamada_kawai", "circular", "shell", "random"]


def compute(g: nx.DiGraph, algorithm: str = "spring", **kwargs) -> dict[str, dict]:
    """Return {node_id: {x, y}} for the given *algorithm*."""
    algo_map = {
        "spring":        nx.spring_layout,
        "spectral":      nx.spectral_layout,
        "kamada_kawai":  nx.kamada_kawai_layout,
        "circular":      nx.circular_layout,
        "shell":         nx.shell_layout,
        "random":        nx.random_layout,
    }
    if algorithm not in algo_map:
        raise ValueError(f"Unknown layout: {algorithm!r}. Available: {LAYOUTS}")

    pos = algo_map[algorithm](g, **kwargs)
    return {str(node): {"x": float(xy[0]) * _SCALE,
                        "y": float(xy[1]) * _SCALE}
            for node, xy in pos.items()}
