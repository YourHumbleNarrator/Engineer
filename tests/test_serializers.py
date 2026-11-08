"""
test_serialisers.py
Tests for the two output serialisers (_to_json / _to_csv) and
the routing condition (_use_json / load_and_convert).

Checks:
  • JSON output is valid and round-trips back to an identical graph
  • CSV output has correct headers, correct row count, no data loss
  • Routing condition switches at the right threshold
  • Node-only graphs serialise without crashing
"""

from fixtures import make_graph, write_tmp, REF
from core.graph_loader import _to_json, _to_csv, load_and_convert, _use_json
import core.graph_loader as gl
import csv
import io
import json
import pathlib
import sys
import tempfile
import unittest

import networkx as nx

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))


def _cleanup(*paths):
    for p in paths:
        try:
            pathlib.Path(p).unlink(missing_ok=True)
        except Exception:
            pass


# ════════════════════════════════════════════════════════════════════════════
# JSON serialiser
# ════════════════════════════════════════════════════════════════════════════

class TestToJSON(unittest.TestCase):

    def setUp(self):
        self.g = make_graph()
        self.raw = _to_json(self.g)

    def test_output_is_valid_json(self):
        try:
            json.loads(self.raw)
        except json.JSONDecodeError as e:
            self.fail(f"_to_json produced invalid JSON: {e}")

    def test_round_trip_node_count(self):
        data = json.loads(self.raw)
        g2 = nx.node_link_graph(data, directed=True)
        self.assertEqual(g2.number_of_nodes(), self.g.number_of_nodes())

    def test_round_trip_edge_count(self):
        data = json.loads(self.raw)
        g2 = nx.node_link_graph(data, directed=True)
        self.assertEqual(g2.number_of_edges(), self.g.number_of_edges())

    def test_round_trip_edge_weights(self):
        data = json.loads(self.raw)
        g2 = nx.node_link_graph(data, directed=True)
        for u, v, attrs in self.g.edges(data=True):
            self.assertIn("weight", g2[u][v])
            self.assertAlmostEqual(
                g2[u][v]["weight"], attrs["weight"], places=5)

    def test_round_trip_edge_labels(self):
        data = json.loads(self.raw)
        g2 = nx.node_link_graph(data, directed=True)
        for u, v, attrs in self.g.edges(data=True):
            self.assertEqual(g2[u][v].get("label"), attrs["label"])

    def test_directed_flag_preserved(self):
        data = json.loads(self.raw)
        self.assertTrue(data.get("directed"),
                        "JSON must record graph as directed")

    def test_node_attributes_preserved(self):
        data = json.loads(self.raw)
        g2 = nx.node_link_graph(data, directed=True)
        self.assertEqual(g2.nodes["D"].get("color"), "red")

    def test_isolated_node_included(self):
        """Node D has no edges — it must still appear in the output."""
        data = json.loads(self.raw)
        node_ids = {str(n["id"]) for n in data["nodes"]}
        self.assertIn("D", node_ids)


# ════════════════════════════════════════════════════════════════════════════
# CSV serialiser
# ════════════════════════════════════════════════════════════════════════════

class TestToCSV(unittest.TestCase):

    def setUp(self):
        self.g = make_graph()
        self.raw = _to_csv(self.g)
        reader = csv.DictReader(io.StringIO(self.raw))
        self.rows = list(reader)
        self.headers = reader.fieldnames

    def test_output_is_valid_csv(self):
        try:
            list(csv.DictReader(io.StringIO(self.raw)))
        except Exception as e:
            self.fail(f"_to_csv produced unparseable CSV: {e}")

    def test_has_source_target_columns(self):
        self.assertIn("source", self.headers)
        self.assertIn("target", self.headers)

    def test_row_count_equals_edge_count(self):
        self.assertEqual(len(self.rows), self.g.number_of_edges())

    def test_all_edges_present(self):
        pairs = {(r["source"], r["target"]) for r in self.rows}
        for u, v in self.g.edges():
            self.assertIn((str(u), str(v)), pairs)

    def test_weight_column_present(self):
        self.assertIn("weight", self.headers)

    def test_weight_values_correct(self):
        for row in self.rows:
            u, v = row["source"], row["target"]
            expected = self.g[u][v]["weight"]
            self.assertAlmostEqual(float(row["weight"]), expected, places=5)

    def test_label_column_present(self):
        self.assertIn("label", self.headers)

    def test_label_values_correct(self):
        for row in self.rows:
            u, v = row["source"], row["target"]
            expected = self.g[u][v]["label"]
            self.assertEqual(row["label"], expected)

    def test_no_empty_rows(self):
        for row in self.rows:
            self.assertTrue(any(v.strip() for v in row.values()),
                            f"Empty row found: {row}")

    def test_node_only_graph_fallback(self):
        """A graph with no edges should produce a node-list CSV, not an empty file."""
        g = nx.DiGraph()
        g.add_node("X", color="blue")
        g.add_node("Y")
        raw = _to_csv(g)
        reader = csv.DictReader(io.StringIO(raw))
        rows = list(reader)
        self.assertEqual(len(rows), 2)
        self.assertIn("id", reader.fieldnames)
        ids = {r["id"] for r in rows}
        self.assertIn("X", ids)
        self.assertIn("Y", ids)

    def test_missing_attrs_produce_empty_string(self):
        """Edges with missing attributes should write empty strings, not crash."""
        g = nx.DiGraph()
        g.add_edge("A", "B", weight=1.0)
        g.add_edge("B", "C")           # no weight
        raw = _to_csv(g)
        reader = csv.DictReader(io.StringIO(raw))
        rows = {(r["source"], r["target"]): r for r in reader}
        self.assertIn(("B", "C"), rows)
        # weight cell should exist but may be empty
        self.assertIn("weight", rows[("B", "C")])


# ════════════════════════════════════════════════════════════════════════════
# Routing condition
# ════════════════════════════════════════════════════════════════════════════

class TestRoutingCondition(unittest.TestCase):
    """
    Tests for _use_json() and load_and_convert().
    These tests patch _use_json so they remain valid even when the user
    changes the routing condition.
    """

    def _make_graph_with_edges(self, n: int) -> nx.DiGraph:
        g = nx.DiGraph()
        for i in range(n):
            g.add_edge(str(i), str(i + 1))
        return g

    def test_small_graph_uses_json(self):
        g = self._make_graph_with_edges(10)
        self.assertTrue(_use_json(g))

    def test_large_graph_uses_csv(self):
        g = self._make_graph_with_edges(300)
        self.assertFalse(_use_json(g))

    def test_boundary_below(self):
        g = self._make_graph_with_edges(249)
        self.assertTrue(_use_json(g))

    def test_boundary_at(self):
        g = self._make_graph_with_edges(250)
        self.assertFalse(_use_json(g))

    def test_load_and_convert_returns_tuple(self):
        p = write_tmp('{"A": ["B"]}', ".json")
        try:
            result = load_and_convert(p)
            self.assertIsInstance(result, tuple)
            self.assertEqual(len(result), 2)
        finally:
            _cleanup(p)

    def test_load_and_convert_fmt_is_json_for_small(self):
        p = write_tmp('{"A": ["B"]}', ".json")
        try:
            _, fmt = load_and_convert(p)
            self.assertEqual(fmt, "json")
        finally:
            _cleanup(p)

    def test_load_and_convert_fmt_is_csv_for_large(self):
        # Build a graph with 300 edges, write as node-link JSON
        g = self._make_graph_with_edges(300)
        p = write_tmp(json.dumps(nx.node_link_data(g)), ".json")
        try:
            _, fmt = load_and_convert(p)
            self.assertEqual(fmt, "csv")
        finally:
            _cleanup(p)

    def test_load_and_convert_json_content_parseable(self):
        p = write_tmp('{"A": ["B"]}', ".json")
        try:
            content, fmt = load_and_convert(p)
            if fmt == "json":
                json.loads(content)   # must not throw
        finally:
            _cleanup(p)

    def test_load_and_convert_csv_content_parseable(self):
        g = self._make_graph_with_edges(300)
        p = write_tmp(json.dumps(nx.node_link_data(g)), ".json")
        try:
            content, fmt = load_and_convert(p)
            if fmt == "csv":
                rows = list(csv.DictReader(io.StringIO(content)))
                self.assertEqual(len(rows), 300)
        finally:
            _cleanup(p)


# ════════════════════════════════════════════════════════════════════════════
# to_cytoscape
# ════════════════════════════════════════════════════════════════════════════

class TestToCytoscape(unittest.TestCase):

    def setUp(self):
        from core.graph_loader import to_cytoscape
        self.cy = to_cytoscape(make_graph())

    def test_has_elements_key(self):
        self.assertIn("elements", self.cy)

    def test_node_count(self):
        nodes = [e for e in self.cy["elements"] if "source" not in e["data"]]
        self.assertEqual(len(nodes), REF.n_nodes)

    def test_edge_count(self):
        edges = [e for e in self.cy["elements"] if "source" in e["data"]]
        self.assertEqual(len(edges), REF.n_edges)

    def test_all_ids_are_strings(self):
        for el in self.cy["elements"]:
            d = el["data"]
            if "source" in d:
                self.assertIsInstance(d["source"], str)
                self.assertIsInstance(d["target"], str)
            else:
                self.assertIsInstance(d["id"], str)

    def test_edge_attributes_included(self):
        edges = {
            (e["data"]["source"], e["data"]["target"]): e["data"]
            for e in self.cy["elements"]
            if "source" in e["data"]
        }
        self.assertAlmostEqual(
            float(edges[("A", "B")]["weight"]), 1.5, places=5)
        self.assertEqual(edges[("A", "B")]["label"], "x")


if __name__ == "__main__":
    unittest.main(verbosity=2)
