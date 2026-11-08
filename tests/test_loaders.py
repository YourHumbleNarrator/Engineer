"""
test_loaders.py
Tests for core/graph_loader.load() — one class per format.

Each class:
  • writes a temp file in that format
  • loads it back
  • asserts node/edge counts, edge attributes, and directionality
"""

from fixtures import make_graph, write_tmp, assert_graphs_equal, REF, XES_PATH
from core.graph_loader import load_graph, SUPPORTED_EXTENSIONS
import json
import pathlib
import textwrap
import unittest

import networkx as nx

import sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))


# ── helpers ───────────────────────────────────────────────────────────────────

def _cleanup(*paths):
    for p in paths:
        try:
            pathlib.Path(p).unlink(missing_ok=True)
        except Exception:
            pass


# ════════════════════════════════════════════════════════════════════════════
# Format-specific loader tests
# ════════════════════════════════════════════════════════════════════════════

class TestLoadYAML(unittest.TestCase):

    def _load_yaml(self, content):
        p = write_tmp(textwrap.dedent(content), ".yaml")
        try:
            return load_graph(p)
        finally:
            _cleanup(p)

    def test_nodes_edges_schema(self):
        g = self._load_yaml("""
            nodes:
              - {id: A}
              - {id: B}
              - {id: C}
              - {id: D, color: red}
            edges:
              - {source: A, target: B, weight: 1.5, label: x}
              - {source: B, target: C, weight: 2.0, label: y}
              - {source: A, target: C, weight: 0.5, label: z}
        """)
        assert_graphs_equal(self, g, make_graph(),
                            check_edge_attrs=True, msg="nodes+edges")

    def test_adjacency_dict_lists(self):
        g = self._load_yaml("A: [B, C]\nB: [C]\nC: []\n")
        self.assertEqual(g.number_of_nodes(), 3)
        self.assertEqual(g.number_of_edges(), 3)
        self.assertIn(("A", "B"), g.edges())
        self.assertIn(("A", "C"), g.edges())
        self.assertIn(("B", "C"), g.edges())

    def test_weighted_adjacency_dict(self):
        g = self._load_yaml("A:\n  B: 1.5\n  C: 0.5\nB:\n  C: 2.0\nC: {}\n")
        self.assertEqual(g.number_of_edges(), 3)
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)
        self.assertAlmostEqual(g["B"]["C"]["weight"], 2.0)

    def test_bare_edge_mapping_list(self):
        g = self._load_yaml("""
            - {source: A, target: B, weight: 1.5}
            - {source: B, target: C, weight: 2.0}
            - {source: A, target: C, weight: 0.5}
        """)
        self.assertEqual(g.number_of_edges(), 3)
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)

    def test_bare_edge_pair_list(self):
        g = self._load_yaml("- [A, B, 1.5]\n- [B, C, 2.0]\n- [A, C, 0.5]\n")
        self.assertEqual(g.number_of_edges(), 3)
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)

    def test_bare_node_list(self):
        g = self._load_yaml("- {id: A, color: red}\n- {id: B}\n")
        self.assertEqual(g.number_of_nodes(), 2)
        self.assertEqual(g.number_of_edges(), 0)

    def test_multidocument(self):
        g = self._load_yaml("""
            nodes:
              - {id: A}
              - {id: B}
            ---
            edges:
              - {source: A, target: B, weight: 1.0}
        """)
        self.assertEqual(g.number_of_nodes(), 2)
        self.assertEqual(g.number_of_edges(), 1)

    def test_yml_extension(self):
        p = write_tmp("A: [B]\nB: []\n", ".yml")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 1)
        finally:
            _cleanup(p)

    def test_directionality(self):
        """A→B should NOT imply B→A."""
        g = self._load_yaml("A: [B]\nB: []\n")
        self.assertIn(("A", "B"), g.edges())
        self.assertNotIn(("B", "A"), g.edges())


class TestLoadJSON(unittest.TestCase):

    def _load(self, data):
        p = write_tmp(json.dumps(data), ".json")
        try:
            return load_graph(p)
        finally:
            _cleanup(p)

    def test_node_link_format(self):
        ref = make_graph()
        g = self._load(nx.node_link_data(ref))
        assert_graphs_equal(
            self, g, ref, check_edge_attrs=True, msg="node-link")

    def test_d3_force_graph(self):
        g = self._load({
            "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "links": [
                {"source": "A", "target": "B", "value": 1.5},
                {"source": "B", "target": "C", "value": 2.0},
            ],
        })
        self.assertEqual(g.number_of_edges(), 2)
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)  # value → weight

    def test_adjacency_dict_lists(self):
        g = self._load({"A": ["B", "C"], "B": ["C"], "C": []})
        self.assertEqual(g.number_of_edges(), 3)

    def test_adjacency_dict_weighted(self):
        g = self._load({"A": {"B": 1.5}, "B": {"C": 2.0}, "C": {}})
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)

    def test_cytoscape_wrapped(self):
        g = self._load({"elements": [
            {"data": {"id": "A"}},
            {"data": {"id": "B"}},
            {"data": {"source": "A", "target": "B", "weight": 3}},
        ]})
        self.assertEqual(g.number_of_edges(), 1)
        self.assertEqual(g["A"]["B"]["weight"], 3)

    def test_flat_edge_list(self):
        g = self._load([
            {"source": "A", "target": "B", "weight": 1.5},
            {"source": "B", "target": "C", "weight": 2.0},
        ])
        self.assertEqual(g.number_of_edges(), 2)
        self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)

    def test_cytoscape_bare_list(self):
        g = self._load([
            {"data": {"id": "A"}},
            {"data": {"id": "B"}},
            {"data": {"source": "A", "target": "B"}},
        ])
        self.assertEqual(g.number_of_nodes(), 2)
        self.assertEqual(g.number_of_edges(), 1)

    def test_node_link_round_trip_attributes(self):
        """All edge attributes survive a node-link JSON round-trip."""
        ref = make_graph()
        data = nx.node_link_data(ref)
        p = write_tmp(json.dumps(data), ".json")
        try:
            g = load_graph(p)
        finally:
            _cleanup(p)
        for u, v, exp_attrs in ref.edges(data=True):
            self.assertIn((str(u), str(v)), {
                          (str(a), str(b)) for a, b in g.edges()})
            got_attrs = g[str(u)][str(v)]
            for k, exp_val in exp_attrs.items():
                self.assertIn(
                    k, got_attrs, f"attr {k!r} missing on edge ({u}→{v})")
                try:
                    # Numeric attrs: compare as float
                    self.assertAlmostEqual(float(got_attrs[k]), float(exp_val), places=5,
                                           msg=f"attr {k!r} on ({u}→{v})")
                except (TypeError, ValueError):
                    # String attrs: compare as string
                    self.assertEqual(str(got_attrs[k]), str(exp_val),
                                     f"attr {k!r} on ({u}→{v})")


class TestLoadCSV(unittest.TestCase):

    def test_with_header(self):
        p = write_tmp("source,target,weight\nA,B,1.5\nB,C,2.0\n", ".csv")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
            self.assertEqual(g["A"]["B"]["weight"], "1.5")
        finally:
            _cleanup(p)

    def test_without_header(self):
        p = write_tmp("A,B,1.5\nB,C,2.0\n", ".csv")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
        finally:
            _cleanup(p)

    def test_extra_columns_become_attrs(self):
        p = write_tmp("source,target,weight,label\nA,B,1.5,x\n", ".csv")
        try:
            g = load_graph(p)
            self.assertIn("label", g["A"]["B"])
            self.assertEqual(g["A"]["B"]["label"], "x")
        finally:
            _cleanup(p)

    def test_directionality(self):
        p = write_tmp("source,target\nA,B\n", ".csv")
        try:
            g = load_graph(p)
            self.assertIn(("A", "B"), g.edges())
            self.assertNotIn(("B", "A"), g.edges())
        finally:
            _cleanup(p)


class TestLoadTXT(unittest.TestCase):

    def test_edge_list_detection(self):
        p = write_tmp("A B 1.5\nB C 2.0\n", ".txt")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
        finally:
            _cleanup(p)

    def test_adjacency_list_detection(self):
        p = write_tmp("A B C D\nB C\nC\n", ".txt")
        try:
            g = load_graph(p)
            self.assertGreaterEqual(g.number_of_nodes(), 3)
        finally:
            _cleanup(p)

    def test_comments_skipped(self):
        p = write_tmp("# comment\nA B 1.0\n", ".txt")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 1)
        finally:
            _cleanup(p)

    def test_empty_file(self):
        p = write_tmp("", ".txt")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_nodes(), 0)
        finally:
            _cleanup(p)


class TestLoadNetworkXFormats(unittest.TestCase):
    """GML, GraphML, GEXF, adjlist, edgelist — all use NetworkX readers."""

    REF_SIMPLE = None   # set in setUpClass

    @classmethod
    def setUpClass(cls):
        # Simple 3-node graph without float attrs (GML is picky about types)
        g = nx.DiGraph()
        g.add_edge("A", "B", weight=1)
        g.add_edge("B", "C", weight=2)
        cls.REF_SIMPLE = g

    def _round_trip(self, write_fn, suffix):
        p = pathlib.Path(write_tmp("", suffix))  # get a tmp path
        p.unlink()
        write_fn(self.REF_SIMPLE, str(p))
        try:
            g = load_graph(p)
            return g
        finally:
            _cleanup(p)

    def test_graphml(self):
        g = self._round_trip(nx.write_graphml, ".graphml")
        self.assertEqual(g.number_of_edges(), 2)
        self.assertIn(("A", "B"), {(str(u), str(v)) for u, v in g.edges()})

    def test_gexf(self):
        g = self._round_trip(nx.write_gexf, ".gexf")
        self.assertEqual(g.number_of_edges(), 2)

    def test_gml(self):
        g = self._round_trip(nx.write_gml, ".gml")
        self.assertEqual(g.number_of_edges(), 2)

    def test_adjlist(self):
        p = write_tmp("A B\nB C\nC\n", ".adjlist")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
        finally:
            _cleanup(p)

    def test_edgelist(self):
        p = write_tmp("A B 1.5\nB C 2.0\n", ".edgelist")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
            self.assertAlmostEqual(g["A"]["B"]["weight"], 1.5)
        finally:
            _cleanup(p)

    def test_pajek(self):
        content = (
            "*Vertices 3\n1 \"A\"\n2 \"B\"\n3 \"C\"\n"
            "*Arcs\n1 2 1.5\n2 3 2.0\n"
        )
        p = write_tmp(content, ".pajek")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 2)
        finally:
            _cleanup(p)

    def test_net_extension(self):
        content = (
            "*Vertices 2\n1 \"A\"\n2 \"B\"\n"
            "*Arcs\n1 2 1.0\n"
        )
        p = write_tmp(content, ".net")
        try:
            g = load_graph(p)
            self.assertEqual(g.number_of_edges(), 1)
        finally:
            _cleanup(p)


@unittest.skipUnless(XES_PATH.exists(), f"BPI12 XES file not found at {XES_PATH}")
class TestLoadXES(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.g = load_graph(XES_PATH)

    def test_returns_digraph(self):
        self.assertIsInstance(self.g, nx.DiGraph)

    def test_node_count(self):
        # BPI12 has 24 unique activities
        self.assertEqual(self.g.number_of_nodes(), 24)

    def test_edge_count(self):
        # 125 directly-follows pairs
        self.assertEqual(self.g.number_of_edges(), 125)

    def test_known_activities_present(self):
        nodes = set(self.g.nodes())
        self.assertIn("A_SUBMITTED", nodes)
        self.assertIn("A_PARTLYSUBMITTED", nodes)

    def test_edges_have_weight(self):
        for _, _, data in self.g.edges(data=True):
            self.assertIn("weight", data)
            self.assertIsInstance(data["weight"], int)
            self.assertGreater(data["weight"], 0)

    def test_weight_sum_equals_total_transitions(self):
        # Total transition count must equal sum of all trace lengths - 1
        # For BPI12 this is a known fixed number
        total = sum(d["weight"] for _, _, d in self.g.edges(data=True))
        self.assertGreater(total, 0)
        # Sanity: BPI12 has 262200 events across 13087 traces
        # → 262200 - 13087 = 249113 transitions
        self.assertEqual(total, 249113)

    def test_self_loops_are_real_dfg_transitions(self):
        # BPI12 contains activities that repeat consecutively within a trace
        # (e.g. W_Completeren aanvraag → W_Completeren aanvraag), so self-loops
        # are expected in the DFG.  All self-loop edges must carry a positive weight.
        for u, v, data in nx.selfloop_edges(self.g, data=True):
            self.assertIn("weight", data, f"self-loop ({u}) has no weight")
            self.assertGreater(data["weight"], 0,
                               f"self-loop ({u}) has non-positive weight")


class TestUnsupportedFormat(unittest.TestCase):

    def test_raises_value_error(self):
        p = write_tmp("data", ".xyz")
        try:
            with self.assertRaises(ValueError) as ctx:
                load_graph(p)
            self.assertIn(".xyz", str(ctx.exception))
        finally:
            _cleanup(p)

    def test_error_lists_supported_extensions(self):
        p = write_tmp("data", ".abc")
        try:
            with self.assertRaises(ValueError) as ctx:
                load_graph(p)
            msg = str(ctx.exception)
            # At least some known extensions should appear in the message
            self.assertTrue(
                any(ext in msg for ext in [".json", ".yaml", ".csv"]),
                f"Expected supported extensions in error message, got: {msg}"
            )
        finally:
            _cleanup(p)

    def test_supported_extensions_constant(self):
        """SUPPORTED_EXTENSIONS must stay in sync with the loader dispatch table."""
        expected = {
            ".xes", ".yaml", ".yml", ".json", ".txt", ".csv",
            ".adjlist", ".edgelist", ".gml", ".graphml", ".gexf",
            ".pajek", ".net",
        }
        self.assertEqual(SUPPORTED_EXTENSIONS, expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
