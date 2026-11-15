"""
Layout Selector
===============
Automatically picks the best NetworkX layout for a given graph,
based on structural conditions.

HOW TO MODIFY:
  Edit LAYOUT_RULES below. Each rule is a dict with:
    "condition": callable(G) → bool
    "layout":    name of an nx.xxx_layout function
    "priority":  int (higher = checked first)
    "note":      human-readable reason

Rules are evaluated in descending priority order.
The first matching rule wins. "default" is used if nothing matches.
"""

import math
import networkx as nx
from typing import Optional


# ─────────────────────────────────────────────────────────────
#  MODIFIABLE LAYOUT RULES
#  Add, remove, or reorder entries freely.
# ─────────────────────────────────────────────────────────────
LAYOUT_RULES = [
    {
        "priority": 100,
        "layout":   "planar_layout",
        "condition": lambda G: nx.is_planar(G) and G.number_of_nodes() <= 200,
        "note":     "Planar graphs with ≤200 nodes → planar layout (no crossings)",
    },
    {
        "priority": 90,
        "layout":   "dot_layout",          # Graphviz dot — best for DAGs
        "condition": lambda G: nx.is_directed_acyclic_graph(G),
        "note":     "DAGs → hierarchical dot layout",
    },
    {
        "priority": 80,
        "layout":   "shell_layout",
        "condition": lambda G: _is_layered(G),
        "note":     "Layered / BFS-structured graphs → shell layout",
    },
    {
        "priority": 70,
        "layout":   "kamada_kawai_layout",
        "condition": lambda G: G.number_of_nodes() <= 300,
        "note":     "Medium graphs ≤300 nodes → Kamada-Kawai (good aesthetics)",
    },
    {
        "priority": 60,
        "layout":   "spectral_layout",
        "condition": lambda G: G.number_of_nodes() <= 1000,
        "note":     "Graphs ≤1 000 nodes → spectral layout",
    },
    {
        "priority": 50,
        "layout":   "spring_layout",
        "condition": lambda G: True,        # always matches — de-facto default
        "note":     "Large/dense graphs → spring layout (force-directed)",
    },
]

# Manual overrides available to the user
AVAILABLE_LAYOUTS = [
    "spring_layout",
    "kamada_kawai_layout",
    "spectral_layout",
    "shell_layout",
    "circular_layout",
    "planar_layout",
    "random_layout",
    "dot_layout",        # requires pygraphviz / pydot
    "neato_layout",      # requires pygraphviz
    "twopi_layout",      # requires pygraphviz
]


def _is_layered(G) -> bool:
    """Heuristic: graph has clear BFS layers (avg betweenness < threshold)."""
    if G.number_of_nodes() == 0:
        return False
    try:
        bc   = nx.betweenness_centrality(G)
        mean = sum(bc.values()) / len(bc)
        return mean < 0.1
    except Exception:
        return False


class LayoutSelector:

    def pick(self, G: nx.Graph, override: Optional[str] = None) -> dict:
        """
        Returns:
        {
          "layout_name": str,
          "positions":   {node: (x, y), ...},
          "auto":        bool  (False if override was used),
          "reason":      str,
        }
        """
        if override:
            return self._apply(G, override, auto=False, reason="User override")

        sorted_rules = sorted(LAYOUT_RULES, key=lambda r: r["priority"], reverse=True)
        for rule in sorted_rules:
            try:
                if rule["condition"](G):
                    return self._apply(G, rule["layout"], auto=True, reason=rule["note"])
            except Exception:
                continue

        return self._apply(G, "spring_layout", auto=True, reason="Fallback default")

    def _apply(self, G, layout_name, auto, reason) -> dict:
        pos = self._compute(G, layout_name)
        # Normalise to 0-1 range for JSON transport
        pos_list = {str(node): list(xy) for node, xy in pos.items()}
        return {
            "layout_name": layout_name,
            "positions":   pos_list,
            "auto":        auto,
            "reason":      reason,
        }

    def _compute(self, G, layout_name):
        nx_name = layout_name.replace("_layout", "")
        # Graphviz layouts
        graphviz_layouts = {"dot", "neato", "twopi", "fdp", "sfdp", "circo"}
        if nx_name in graphviz_layouts:
            try:
                return nx.nx_pydot.pydot_layout(G, prog=nx_name)
            except Exception:
                # Fallback if pydot/graphviz not installed
                return nx.spring_layout(G)

        fn = getattr(nx, layout_name, None)
        if fn is None:
            fn = nx.spring_layout
        try:
            return fn(G)
        except Exception:
            return nx.spring_layout(G)
