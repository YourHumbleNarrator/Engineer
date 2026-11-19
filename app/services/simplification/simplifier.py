"""
Graph simplification algorithms.

Each function accepts a graph dict (any kind) and returns a simplified graph dict.
Currently implemented as documented stubs — the TODO comments describe the
full algorithm to implement in each case.
"""
from typing import Any, Dict, List


def simplify(
    graph: Dict[str, Any],
    algorithm: str,
    threshold: float = 0.2,
    params: dict = {},
) -> Dict[str, Any]:
    """
    Dispatch to the requested simplification algorithm.

    Args:
        graph: Graph JSON dict (any kind: dfg, petri_net, bpmn, process_tree).
        algorithm: One of "filter_dfg", "abstraction", "merge_parallel".
        threshold: Primary tuning parameter (meaning varies by algorithm).
        params: Additional algorithm-specific parameters.

    Returns:
        Simplified graph dict.

    Raises:
        ValueError: If algorithm is not recognised.
    """
    dispatch = {
        "filter_dfg": filter_dfg,
        "abstraction": abstraction,
        "merge_parallel": merge_parallel,
    }
    fn = dispatch.get(algorithm)
    if fn is None:
        raise ValueError(
            f"Unknown simplification algorithm: '{algorithm}'. "
            f"Available: {sorted(dispatch.keys())}"
        )
    return fn(graph, threshold, params)


def filter_dfg(graph: Dict[str, Any], threshold: float, params: dict) -> Dict[str, Any]:
    """
    DFG edge-frequency filtering.

    Remove edges whose count is below (max_count * threshold), then
    remove activities that become isolated after filtering, and
    re-calculate startActivities / endActivities.

    Args:
        graph: DFG graph JSON dict.
        threshold: Fraction of max edge frequency below which edges are pruned (0–1).
                   Overridden by params["absolute_threshold"] if present.
        params: Optional overrides:
            - absolute_threshold (int): hard minimum edge count.

    TODO: Implement fully. Currently returns graph unchanged (stub).
    """
    edges: List[Dict] = graph.get("edges", [])
    if not edges:
        return graph

    absolute = params.get("absolute_threshold")
    if absolute is not None:
        min_count = int(absolute)
    else:
        max_count = max((e.get("count", 0) for e in edges), default=0)
        min_count = int(max_count * threshold)

    # TODO: Filter edges, prune isolated activities, recompute start/end sets.
    # Stub — returns graph unchanged.
    return graph


def abstraction(graph: Dict[str, Any], threshold: float, params: dict) -> Dict[str, Any]:
    """
    Activity abstraction / clustering.

    Group activities whose occurrence count falls below the given
    frequency percentile into a single abstract node (default label "OTHER").
    Redirect edges that pointed to abstracted activities to the new node.

    Args:
        graph: Any graph kind.
        threshold: Frequency percentile below which activities are abstracted (0–1).
        params: Optional overrides:
            - label (str): Name for the abstract node (default "OTHER").
            - strategy ("merge"|"remove"): Whether to merge into a node or remove.

    TODO: Implement fully. Currently returns graph unchanged (stub).
    """
    # TODO: Collect activity counts, compute percentile cutoff, merge/remove.
    # Stub — returns graph unchanged.
    return graph


def merge_parallel(graph: Dict[str, Any], threshold: float, params: dict) -> Dict[str, Any]:
    """
    Merge parallel/concurrent activity chains into single composite nodes.

    Detect strongly-connected sub-graphs representing parallel branches
    and collapse them into a single AND-block node.
    Primarily useful for DFG → more compact visual representation.

    Args:
        graph: DFG graph JSON dict.
        threshold: Minimum edge-overlap ratio to trigger a merge (0–1).
        params: Optional overrides:
            - max_merge_size (int): Maximum activities per merged block.

    TODO: Implement fully. Currently returns graph unchanged (stub).
    """
    # TODO: Detect parallel subgraphs via SCC analysis, merge nodes.
    # Stub — returns graph unchanged.
    return graph


ALGORITHM_REGISTRY = [
    {
        "id": "filter_dfg",
        "name": "DFG Edge Frequency Filtering",
        "description": (
            "Removes low-frequency edges from a DFG based on a relative frequency threshold. "
            "Edges with count < max_count * threshold are pruned. "
            "Isolated activities are removed and start/end sets are recalculated."
        ),
        "params": {
            "threshold": "float 0–1 (fraction of max frequency)",
            "absolute_threshold": "int (optional hard minimum count — overrides threshold)",
        },
        "applicable_kinds": ["dfg"],
        "status": "stub",
    },
    {
        "id": "abstraction",
        "name": "Activity Abstraction",
        "description": (
            "Groups rare activities into a single abstract node to reduce graph complexity. "
            "Activities below the frequency percentile cutoff are merged or removed."
        ),
        "params": {
            "threshold": "float 0–1 (frequency percentile cutoff)",
            "label": "str (name for abstract node, default 'OTHER')",
            "strategy": "'merge' | 'remove'",
        },
        "applicable_kinds": ["dfg", "petri_net", "bpmn"],
        "status": "stub",
    },
    {
        "id": "merge_parallel",
        "name": "Parallel Branch Merging",
        "description": (
            "Detects and collapses parallel activity chains into AND-block nodes. "
            "Useful for making large concurrent process models more readable."
        ),
        "params": {
            "threshold": "float 0–1 (edge-overlap ratio to trigger merge)",
            "max_merge_size": "int (max activities per merged block)",
        },
        "applicable_kinds": ["dfg"],
        "status": "stub",
    },
]
