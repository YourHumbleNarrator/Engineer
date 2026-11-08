"""
test_api.py
Tests for api/routes.py using Flask's built-in test client.

Covers:
  • POST /api/upload  — happy path, bad extension, oversized file (mocked)
  • GET  /api/graph/<id>
  • POST /api/layout/<id>
  • POST /api/simplify/<id>
  • GET  /api/layouts
  • Error responses are always JSON (never HTML)
"""

import networkx as nx
from fixtures import make_graph, XES_PATH
import app as flask_app
import io
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))


def _yaml_payload(content: str, filename: str = "graph.yaml"):
    return (io.BytesIO(content.encode()), filename)


def _json_payload(data: dict, filename: str = "graph.json"):
    return (io.BytesIO(json.dumps(data).encode()), filename)


class TestAPIBase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        flask_app.app.config["TESTING"] = True
        flask_app.app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024
        cls.client = flask_app.app.test_client()

    def _upload(self, content_bytes: bytes, filename: str):
        return self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(content_bytes), filename)},
            content_type="multipart/form-data",
        )

    def _upload_graph(self, g: nx.DiGraph, filename: str = "graph.json") -> str:
        """Upload a NetworkX graph as node-link JSON and return session_id."""
        payload = json.dumps(nx.node_link_data(g)).encode()
        res = self._upload(payload, filename)
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        return res.get_json()["session_id"]


# ════════════════════════════════════════════════════════════════════════════
# /api/layouts  (no session needed)
# ════════════════════════════════════════════════════════════════════════════

class TestLayoutsEndpoint(TestAPIBase):

    def test_status_200(self):
        res = self.client.get("/api/layouts")
        self.assertEqual(res.status_code, 200)

    def test_returns_json(self):
        res = self.client.get("/api/layouts")
        self.assertEqual(res.content_type, "application/json")

    def test_has_layouts_key(self):
        body = self.client.get("/api/layouts").get_json()
        self.assertIn("layouts", body)

    def test_layouts_is_non_empty_list(self):
        body = self.client.get("/api/layouts").get_json()
        self.assertIsInstance(body["layouts"], list)
        self.assertGreater(len(body["layouts"]), 0)

    def test_spring_is_listed(self):
        body = self.client.get("/api/layouts").get_json()
        self.assertIn("spring", body["layouts"])


# ════════════════════════════════════════════════════════════════════════════
# POST /api/upload
# ════════════════════════════════════════════════════════════════════════════

class TestUpload(TestAPIBase):

    def test_happy_path_yaml(self):
        yaml = "A: [B, C]\nB: [C]\nC: []\n"
        res = self._upload(yaml.encode(), "graph.yaml")
        self.assertEqual(res.status_code, 200)

    def test_response_is_json(self):
        yaml = "A: [B]\nB: []\n"
        res = self._upload(yaml.encode(), "graph.yaml")
        self.assertIn("application/json", res.content_type)

    def test_response_has_session_id(self):
        yaml = "A: [B]\nB: []\n"
        body = self._upload(yaml.encode(), "graph.yaml").get_json()
        self.assertIn("session_id", body)
        self.assertIsNotNone(body["session_id"])

    def test_response_has_node_count(self):
        yaml = "A: [B, C]\nB: [C]\nC: []\n"
        body = self._upload(yaml.encode(), "graph.yaml").get_json()
        self.assertEqual(body["node_count"], 3)

    def test_response_has_edge_count(self):
        yaml = "A: [B, C]\nB: [C]\nC: []\n"
        body = self._upload(yaml.encode(), "graph.yaml").get_json()
        self.assertEqual(body["edge_count"], 3)

    def test_unsupported_extension_returns_422(self):
        res = self._upload(b"garbage", "graph.xyz")
        self.assertEqual(res.status_code, 422)

    def test_unsupported_extension_returns_json_error(self):
        res = self._upload(b"garbage", "graph.xyz")
        body = res.get_json()
        self.assertIsNotNone(body, "Response must be JSON, not HTML")
        self.assertIn("error", body)

    def test_malformed_yaml_returns_422(self):
        res = self._upload(b": bad: yaml: {{{{", "graph.yaml")
        self.assertEqual(res.status_code, 422)

    def test_malformed_yaml_error_is_json(self):
        res = self._upload(b": bad: yaml: {{{{", "graph.yaml")
        body = res.get_json()
        self.assertIsNotNone(body, "Error response must be JSON")
        self.assertIn("error", body)

    def test_no_file_field_returns_400(self):
        res = self.client.post("/api/upload", data={},
                               content_type="multipart/form-data")
        self.assertEqual(res.status_code, 400)

    def test_no_file_error_is_json(self):
        res = self.client.post("/api/upload", data={},
                               content_type="multipart/form-data")
        body = res.get_json()
        self.assertIsNotNone(body)
        self.assertIn("error", body)

    def test_json_upload(self):
        g = make_graph()
        payload = json.dumps(nx.node_link_data(g)).encode()
        res = self._upload(payload, "graph.json")
        body = res.get_json()
        self.assertEqual(body["node_count"], g.number_of_nodes())
        self.assertEqual(body["edge_count"], g.number_of_edges())


# ════════════════════════════════════════════════════════════════════════════
# GET /api/graph/<session_id>
# ════════════════════════════════════════════════════════════════════════════

class TestGetGraph(TestAPIBase):

    def setUp(self):
        self.sid = self._upload_graph(make_graph())

    def test_status_200(self):
        res = self.client.get(f"/api/graph/{self.sid}")
        self.assertEqual(res.status_code, 200)

    def test_returns_json(self):
        res = self.client.get(f"/api/graph/{self.sid}")
        self.assertIn("application/json", res.content_type)

    def test_has_elements_key(self):
        body = self.client.get(f"/api/graph/{self.sid}").get_json()
        self.assertIn("elements", body)

    def test_elements_is_list(self):
        body = self.client.get(f"/api/graph/{self.sid}").get_json()
        self.assertIsInstance(body["elements"], list)

    def test_node_count_in_elements(self):
        body = self.client.get(f"/api/graph/{self.sid}").get_json()
        nodes = [e for e in body["elements"] if "source" not in e["data"]]
        self.assertEqual(len(nodes), make_graph().number_of_nodes())

    def test_edge_count_in_elements(self):
        body = self.client.get(f"/api/graph/{self.sid}").get_json()
        edges = [e for e in body["elements"] if "source" in e["data"]]
        self.assertEqual(len(edges), make_graph().number_of_edges())

    def test_unknown_session_returns_404(self):
        res = self.client.get("/api/graph/nonexistent_id_xyz")
        self.assertEqual(res.status_code, 404)

    def test_unknown_session_error_is_json(self):
        res = self.client.get("/api/graph/nonexistent_id_xyz")
        body = res.get_json()
        self.assertIsNotNone(body)
        self.assertIn("error", body)


# ════════════════════════════════════════════════════════════════════════════
# POST /api/layout/<session_id>
# ════════════════════════════════════════════════════════════════════════════

class TestApplyLayout(TestAPIBase):

    def setUp(self):
        self.sid = self._upload_graph(make_graph())

    def _layout(self, algorithm: str):
        return self.client.post(
            f"/api/layout/{self.sid}",
            json={"algorithm": algorithm},
        )

    def test_status_200(self):
        self.assertEqual(self._layout("spring").status_code, 200)

    def test_returns_positions_key(self):
        body = self._layout("circular").get_json()
        self.assertIn("positions", body)

    def test_positions_has_all_nodes(self):
        body = self._layout("circular").get_json()
        pos = body["positions"]
        expected = {str(n) for n in make_graph().nodes()}
        self.assertEqual(set(pos.keys()), expected)

    def test_positions_have_x_and_y(self):
        body = self._layout("spring").get_json()
        for node, xy in body["positions"].items():
            with self.subTest(node=node):
                self.assertIn("x", xy)
                self.assertIn("y", xy)

    def test_all_algorithms_return_200(self):
        layouts = self.client.get("/api/layouts").get_json()["layouts"]
        for algo in layouts:
            with self.subTest(algo=algo):
                res = self._layout(algo)
                self.assertEqual(res.status_code, 200,
                                 f"{algo} returned {res.status_code}: {res.get_data(as_text=True)}")

    def test_unknown_algorithm_returns_422(self):
        res = self._layout("nonexistent_algo")
        self.assertEqual(res.status_code, 422)

    def test_unknown_algorithm_error_is_json(self):
        res = self._layout("nonexistent_algo")
        body = res.get_json()
        self.assertIsNotNone(body)
        self.assertIn("error", body)

    def test_unknown_session_returns_404(self):
        res = self.client.post("/api/layout/bad_session",
                               json={"algorithm": "spring"})
        self.assertEqual(res.status_code, 404)

    def test_missing_algorithm_uses_default(self):
        """Empty body should not crash — default algorithm is used."""
        res = self.client.post(f"/api/layout/{self.sid}", json={})
        self.assertEqual(res.status_code, 200)


# ════════════════════════════════════════════════════════════════════════════
# POST /api/simplify/<session_id>
# ════════════════════════════════════════════════════════════════════════════

class TestSimplify(TestAPIBase):
    """
    The simplify endpoint now accepts a ProcessorConfig-shaped body:
      { frequency_filter: {...}, attribute_filters: [...], reduction: {...} }
    All fields are optional; an empty body is a no-op.
    """

    def setUp(self):
        self.sid = self._upload_graph(make_graph())
        # make_graph() edges: A→B(w=1.5), B→C(w=2.0), A→C(w=0.5)
        # We use 'weight' as the frequency_attr so existing attrs are reused.

    def _simplify(self, body: dict):
        return self.client.post(f"/api/simplify/{self.sid}", json=body)

    def _freq_filter(self, **kwargs):
        return {"frequency_filter": {"frequency_attr": "weight", **kwargs}}

    def test_status_200_empty_body(self):
        self.assertEqual(self._simplify({}).status_code, 200)

    def test_returns_node_and_edge_counts(self):
        body = self._simplify({}).get_json()
        self.assertIn("node_count", body)
        self.assertIn("edge_count", body)

    def test_returns_elements(self):
        body = self._simplify({}).get_json()
        self.assertIn("elements", body)

    def test_no_filter_keeps_all_edges(self):
        body = self._simplify({}).get_json()
        self.assertEqual(body["edge_count"], make_graph().number_of_edges())

    def test_frequency_filter_removes_low_weight_edges(self):
        # weights: 0.5, 1.5, 2.0 — min_frequency=1.5 keeps 2 edges
        body = self._simplify(self._freq_filter(
            min_frequency=1.5, apply_to_nodes=False, remove_orphans=False,
        )).get_json()
        self.assertLess(body["edge_count"], make_graph().number_of_edges())
        self.assertEqual(body["edge_count"], 2)

    def test_frequency_filter_zero_min_keeps_all(self):
        body = self._simplify(self._freq_filter(
            min_frequency=0.0, apply_to_nodes=False, remove_orphans=False,
        )).get_json()
        self.assertEqual(body["edge_count"], make_graph().number_of_edges())

    def test_attribute_filter_by_label(self):
        # make_graph() has edge labels x, y, z — keep only label=="x"
        body = self._simplify({"attribute_filters": [
            {"target": "edge", "key": "label", "op": "eq", "value": "x"}
        ]}).get_json()
        self.assertEqual(body["edge_count"], 1)

    def test_elements_match_reported_counts(self):
        body = self._simplify(self._freq_filter(
            min_frequency=0.0, apply_to_nodes=False, remove_orphans=False,
        )).get_json()
        elements = body["elements"]["elements"]
        nodes = [e for e in elements if "source" not in e["data"]]
        edges = [e for e in elements if "source" in e["data"]]
        self.assertEqual(len(nodes), body["node_count"])
        self.assertEqual(len(edges), body["edge_count"])

    def test_invalid_filter_op_returns_422(self):
        res = self._simplify({"attribute_filters": [
            {"target": "edge", "key": "label", "op": "not_a_real_op", "value": "x"}
        ]})
        self.assertEqual(res.status_code, 422)

    def test_invalid_reduction_algorithm_returns_422(self):
        res = self._simplify(
            {"reduction": {"algorithm": "NONEXISTENT", "params": {}}})
        self.assertEqual(res.status_code, 422)

    def test_not_implemented_reduction_returns_422(self):
        res = self._simplify({"reduction": {
            "algorithm": "FREQUENCY_THRESHOLD", "params": {}
        }})
        self.assertEqual(res.status_code, 422)

    def test_unknown_session_returns_404(self):
        res = self.client.post("/api/simplify/bad_session", json={})
        self.assertEqual(res.status_code, 404)


# ════════════════════════════════════════════════════════════════════════════
# Error responses are always JSON  (regression — the <!doctype bug)
# ════════════════════════════════════════════════════════════════════════════

class TestErrorsAreNeverHTML(TestAPIBase):
    """
    Every error path must return application/json.
    This is the regression test for the <!doctype bug where unhandled
    exceptions produced an HTML 500 page that the frontend couldn't parse.
    """

    def _assert_json_error(self, res, expected_status: int):
        self.assertEqual(res.status_code, expected_status,
                         res.get_data(as_text=True))
        ct = res.content_type
        self.assertIn("application/json", ct,
                      f"Expected JSON, got Content-Type: {ct}\n"
                      f"Body: {res.get_data(as_text=True)[:200]}")
        body = res.get_json()
        self.assertIsNotNone(body, "Body could not be parsed as JSON")
        self.assertIn("error", body)

    def test_bad_extension(self):
        res = self._upload(b"x", "file.unknown")
        self._assert_json_error(res, 422)

    def test_no_file(self):
        res = self.client.post("/api/upload", data={},
                               content_type="multipart/form-data")
        self._assert_json_error(res, 400)

    def test_graph_not_found(self):
        res = self.client.get("/api/graph/does_not_exist")
        self._assert_json_error(res, 404)

    def test_layout_not_found(self):
        res = self.client.post("/api/layout/does_not_exist",
                               json={"algorithm": "spring"})
        self._assert_json_error(res, 404)

    def test_simplify_not_found(self):
        res = self.client.post(
            "/api/simplify/does_not_exist",
            json={"method": "edge_weight", "params": {}},
        )
        self._assert_json_error(res, 404)

    def test_bad_layout_algorithm(self):
        sid = self._upload_graph(make_graph())
        res = self.client.post(f"/api/layout/{sid}",
                               json={"algorithm": "bad_algo"})
        self._assert_json_error(res, 422)

    def test_bad_simplify_op(self):
        sid = self._upload_graph(make_graph())
        res = self.client.post(f"/api/simplify/{sid}", json={
            "attribute_filters": [
                {"target": "edge", "key": "label",
                    "op": "not_a_real_op", "value": "x"}
            ]
        })
        self._assert_json_error(res, 422)


# ════════════════════════════════════════════════════════════════════════════
# XES upload (integration, skipped when file absent)
# ════════════════════════════════════════════════════════════════════════════

@unittest.skipUnless(XES_PATH.exists(), f"BPI12 XES not found at {XES_PATH}")
class TestXESUpload(TestAPIBase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(XES_PATH, "rb") as f:
            data = f.read()
        res = cls.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(data), "bpi12.xes")},
            content_type="multipart/form-data",
        )
        assert res.status_code == 200, (
            f"XES upload failed: {res.get_data(as_text=True)}"
        )
        body = res.get_json()
        cls.sid = body["session_id"]
        cls.node_count = body["node_count"]
        cls.edge_count = body["edge_count"]

    def test_node_count(self):
        self.assertEqual(self.node_count, 24)

    def test_edge_count(self):
        self.assertEqual(self.edge_count, 125)

    def test_graph_elements_retrievable(self):
        res = self.client.get(f"/api/graph/{self.sid}")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        edges = [e for e in body["elements"] if "source" in e["data"]]
        self.assertEqual(len(edges), 125)

    def test_layout_works_on_xes_graph(self):
        res = self.client.post(
            f"/api/layout/{self.sid}",
            json={"algorithm": "spring"},
        )
        self.assertEqual(res.status_code, 200)
        pos = res.get_json()["positions"]
        self.assertEqual(len(pos), 24)


if __name__ == "__main__":
    unittest.main(verbosity=2)
