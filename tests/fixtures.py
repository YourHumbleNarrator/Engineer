"""
fixtures.py
Shared helpers for the graph-viz test suite.

Provides
--------
make_graph()        Build a known reference DiGraph used in every test.
write_tmp()         Write text content to a temporary file with a given suffix.
GraphFixture        Dataclass holding the reference graph's expected values.
XES_PATH            Path to the real BPI12 XES file (skipped when absent).
"""

from __future__ import annotations

import json
import pathlib
import tempfile
from dataclasses import dataclass, field

import networkx as nx

# ── Real XES file (optional) ────────────────────────────────────────────────
XES_PATH = pathlib.Path("/mnt/user-data/uploads/bpi12.xes")

# ── Reference graph ──────────────────────────────────────────────────────────
# A → B (weight=1.5, label="x")
# B → C (weight=2.0, label="y")
# A → C (weight=0.5, label="z")
# Isolated node D (attr: color="red")
#
# This graph is small enough to serialise as JSON (3 edges < 250).


@dataclass
class GraphFixture:
    nodes: list = field(default_factory=lambda: ["A", "B", "C", "D"])
    edges: list = field(default_factory=lambda: [
        ("A", "B", {"weight": 1.5, "label": "x"}),
        ("B", "C", {"weight": 2.0, "label": "y"}),
        ("A", "C", {"weight": 0.5, "label": "z"}),
    ])
    node_attrs: dict = field(default_factory=lambda: {"D": {"color": "red"}})
    n_nodes: int = 4
    n_edges: int = 3


REF = GraphFixture()


def make_graph() -> nx.DiGraph:
    """Return a fresh copy of the reference DiGraph."""
    g = nx.DiGraph()
    for n in REF.nodes:
        g.add_node(n, **REF.node_attrs.get(n, {}))
    for u, v, attrs in REF.edges:
        g.add_edge(u, v, **attrs)
    return g


def write_tmp(content: str, suffix: str) -> pathlib.Path:
    """Write *content* to a named temp file and return its Path."""
    f = tempfile.NamedTemporaryFile(
        mode="w", suffix=suffix, delete=False, encoding="utf-8"
    )
    f.write(content)
    f.flush()
    f.close()
    return pathlib.Path(f.name)


# ── Graph equality helpers ────────────────────────────────────────────────────

def assert_graphs_equal(tc, got: nx.DiGraph, expected: nx.DiGraph,
                        check_edge_attrs: bool = True,
                        check_node_attrs: bool = False,
                        msg: str = "") -> None:
    """
    Assert that *got* and *expected* have the same nodes and directed edges.
    Optionally compare edge / node attributes.
    """
    prefix = f"[{msg}] " if msg else ""

    got_nodes = set(str(n) for n in got.nodes())
    exp_nodes = set(str(n) for n in expected.nodes())
    tc.assertEqual(got_nodes, exp_nodes, f"{prefix}node sets differ")

    got_edges = {(str(u), str(v)) for u, v in got.edges()}
    exp_edges = {(str(u), str(v)) for u, v in expected.edges()}
    tc.assertEqual(got_edges, exp_edges, f"{prefix}edge sets differ")

    if check_edge_attrs:
        for u, v, exp_data in expected.edges(data=True):
            got_data = got[str(u)][str(v)]
            for k, exp_val in exp_data.items():
                tc.assertIn(k, got_data,
                            f"{prefix}edge ({u}→{v}) missing attr {k!r}")
                # Compare as float when both are numeric
                try:
                    tc.assertAlmostEqual(
                        float(got_data[k]), float(exp_val), places=5,
                        msg=f"{prefix}edge ({u}→{v}) attr {k!r} mismatch"
                    )
                except (TypeError, ValueError):
                    tc.assertEqual(
                        str(got_data[k]), str(exp_val),
                        f"{prefix}edge ({u}→{v}) attr {k!r} mismatch"
                    )

    if check_node_attrs:
        for n, exp_data in expected.nodes(data=True):
            got_data = got.nodes[str(n)]
            for k, exp_val in exp_data.items():
                tc.assertIn(k, got_data,
                            f"{prefix}node {n!r} missing attr {k!r}")
                tc.assertEqual(str(got_data[k]), str(exp_val),
                               f"{prefix}node {n!r} attr {k!r} mismatch")
