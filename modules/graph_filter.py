"""
Graph Filter & Reduction Module
=================================
Provides:
  1. Frequency-based filtering (remove edges below a threshold)
  2. Attribute-based filtering (keep/remove nodes or edges by attribute)
  3. Reduction algorithms — STUB SLOTS for you to fill in

HOW TO ADD A REDUCTION ALGORITHM:
  Add an entry to REDUCTION_ALGORITHMS below, then implement
  the corresponding method prefixed with _reduce_.
  The key becomes the algorithm ID exposed in the API.
"""

import networkx as nx
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────
#  REDUCTION ALGORITHM REGISTRY
#  Add your algorithms here. Each entry:
#    "id":          unique string key (must match _reduce_<id> method)
#    "name":        display name
#    "description": shown in the UI
#    "params":      list of {name, type, default, description}
# ─────────────────────────────────────────────────────────────
REDUCTION_ALGORITHMS = [
    {
        "id":          "stub_placeholder",
        "name":        "Placeholder (stub)",
        "description": "Replace this with your first reduction algorithm.",
        "params":      [],
    },
    # ── Add your algorithms below ───────────────────────────
    # {
    #     "id":          "my_algo",
    #     "name":        "My Custom Reduction",
    #     "description": "...",
    #     "params":      [{"name": "k", "type": "int", "default": 3,
    #                      "description": "Number of nodes to keep"}],
    # },
]


class GraphFilter:

    # ── Frequency filtering ─────────────────────────────────

    def filter_by_frequency(
        self,
        G: nx.DiGraph,
        min_frequency: float = 1,
        frequency_attr: str  = "frequency",
    ) -> nx.DiGraph:
        """
        Remove edges whose `frequency_attr` value is below `min_frequency`.
        Isolated nodes are also removed.

        Parameters
        ----------
        G               : input graph
        min_frequency   : edges with freq < this are removed
        frequency_attr  : edge attribute name to use as frequency
        """
        H = G.copy()
        to_remove = [
            (u, v) for u, v, d in H.edges(data=True)
            if d.get(frequency_attr, 1) < min_frequency
        ]
        H.remove_edges_from(to_remove)
        # Remove isolated nodes
        isolates = list(nx.isolates(H))
        H.remove_nodes_from(isolates)
        return H

    # ── Attribute filtering ─────────────────────────────────

    def filter_by_attribute(
        self,
        G: nx.DiGraph,
        target: str         = "edge",    # "edge" | "node"
        attribute: str      = "",
        operator: str       = "eq",      # eq | neq | gt | lt | gte | lte | contains
        value: Any          = None,
        keep_matching: bool = True,      # True=keep matching, False=remove matching
    ) -> nx.DiGraph:
        """
        Filter graph elements by a named attribute.

        Parameters
        ----------
        target        : "edge" or "node"
        attribute     : attribute key to test
        operator      : comparison operator
        value         : value to compare against
        keep_matching : if True, keep elements where condition is True
        """
        H = G.copy()
        ops = {
            "eq":       lambda a, b: a == b,
            "neq":      lambda a, b: a != b,
            "gt":       lambda a, b: float(a) > float(b),
            "lt":       lambda a, b: float(a) < float(b),
            "gte":      lambda a, b: float(a) >= float(b),
            "lte":      lambda a, b: float(a) <= float(b),
            "contains": lambda a, b: str(b).lower() in str(a).lower(),
        }
        cmp = ops.get(operator, ops["eq"])

        if target == "edge":
            to_remove = []
            for u, v, d in H.edges(data=True):
                attr_val = d.get(attribute)
                try:
                    matches = attr_val is not None and cmp(attr_val, value)
                except Exception:
                    matches = False
                if keep_matching != matches:
                    to_remove.append((u, v))
            H.remove_edges_from(to_remove)

        elif target == "node":
            to_remove = []
            for node, d in H.nodes(data=True):
                attr_val = d.get(attribute)
                try:
                    matches = attr_val is not None and cmp(attr_val, value)
                except Exception:
                    matches = False
                if keep_matching != matches:
                    to_remove.append(node)
            H.remove_nodes_from(to_remove)

        return H

    # ── Reduction algorithms ─────────────────────────────────

    def reduce(self, G: nx.DiGraph, algorithm_id: str, params: dict) -> nx.DiGraph:
        """
        Dispatch to a registered reduction algorithm.
        """
        method = getattr(self, f"_reduce_{algorithm_id}", None)
        if method is None:
            raise ValueError(f"Unknown reduction algorithm: '{algorithm_id}'. "
                             f"Available: {[a['id'] for a in REDUCTION_ALGORITHMS]}")
        return method(G, **params)

    # ── Reduction stubs (fill these in) ─────────────────────

    def _reduce_stub_placeholder(self, G: nx.DiGraph, **kwargs) -> nx.DiGraph:
        """
        STUB — Replace with your algorithm.
        Currently returns the graph unchanged.
        """
        # ── YOUR CODE HERE ───────────────────────────────────
        return G.copy()

    # def _reduce_my_algo(self, G: nx.DiGraph, k: int = 3, **kwargs) -> nx.DiGraph:
    #     """Fill in your algorithm here."""
    #     H = G.copy()
    #     # ... your logic ...
    #     return H

    # ── Helpers ──────────────────────────────────────────────

    def get_algorithms(self) -> List[dict]:
        """Return the registry for the UI."""
        return REDUCTION_ALGORITHMS
