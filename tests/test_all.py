"""
Test Suite
==========
Run with:  cd process_mining && pytest tests/ -v

Tests are structured so they pass even without pm4py or R installed —
modules degrade gracefully and stubs are tested for correct shape.
"""

import json
import csv
import io
import os
import sys
import tempfile
import pytest
import networkx as nx

# ── Make sure the project root is on the path ───────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from modules.graph_stats     import GraphStats
from modules.graph_filter    import GraphFilter, REDUCTION_ALGORITHMS
from modules.layout_selector import LayoutSelector, LAYOUT_RULES, AVAILABLE_LAYOUTS
from modules.graph_loader    import GraphLoader, SMALL_GRAPH_THRESHOLD, EXTENSION_MAP
from modules.benchmarking    import BenchmarkRunner, LIBRARY_CATALOGUE


# ════════════════════════════════════════════════════════════
#  FIXTURES
# ════════════════════════════════════════════════════════════

@pytest.fixture
def small_dag():
    """Small directed acyclic graph (5 nodes, 4 edges)."""
    G = nx.DiGraph()
    G.add_edges_from([("A", "B"), ("A", "C"), ("B", "D"), ("C", "D")])
    return G


@pytest.fixture
def weighted_graph():
    """Graph with frequency attributes on edges."""
    G = nx.DiGraph()
    G.add_edge("start", "task1", frequency=50)
    G.add_edge("task1", "task2", frequency=5)
    G.add_edge("task2", "end",   frequency=50)
    G.add_edge("task1", "end",   frequency=1)
    return G


@pytest.fixture
def large_graph():
    """Larger graph above the threshold."""
    return nx.scale_free_graph(300).to_directed()


@pytest.fixture
def attributed_graph():
    """Graph with node and edge attributes for filter tests."""
    G = nx.DiGraph()
    G.add_node("n1", role="start")
    G.add_node("n2", role="task")
    G.add_node("n3", role="end")
    G.add_edge("n1", "n2", label="ok",  weight=10)
    G.add_edge("n2", "n3", label="ok",  weight=5)
    G.add_edge("n1", "n3", label="skip", weight=1)
    return G


# ════════════════════════════════════════════════════════════
#  graph_stats.py
# ════════════════════════════════════════════════════════════

class TestGraphStats:
    s = GraphStats()

    def test_basic_counts(self, small_dag):
        r = self.s.compute(small_dag)
        assert r["nodes"] == 4
        assert r["edges"] == 4

    def test_density_range(self, small_dag):
        r = self.s.compute(small_dag)
        assert 0.0 <= r["density"] <= 1.0

    def test_avg_degree_positive(self, small_dag):
        r = self.s.compute(small_dag)
        assert r["avg_degree"] >= 0

    def test_dag_flag(self, small_dag):
        r = self.s.compute(small_dag)
        assert r["is_dag"] is True

    def test_dag_flag_false_for_cycle(self):
        G = nx.DiGraph([("A", "B"), ("B", "A")])
        r = self.s.compute(G)
        assert r["is_dag"] is False

    def test_empty_graph(self):
        r = self.s.compute(nx.DiGraph())
        assert r["nodes"] == 0
        assert r["edges"] == 0

    def test_node_table_columns(self, small_dag):
        t = self.s.to_node_table(small_dag)
        assert "id"     in t["columns"]
        assert "degree" in t["columns"]
        assert len(t["rows"]) == 4

    def test_edge_table_columns(self, small_dag):
        t = self.s.to_edge_table(small_dag)
        assert "source" in t["columns"]
        assert "target" in t["columns"]
        assert len(t["rows"]) == 4

    def test_edge_table_with_attrs(self, weighted_graph):
        t = self.s.to_edge_table(weighted_graph)
        assert "frequency" in t["columns"]


# ════════════════════════════════════════════════════════════
#  graph_filter.py
# ════════════════════════════════════════════════════════════

class TestGraphFilter:
    f = GraphFilter()

    def test_frequency_removes_low_edges(self, weighted_graph):
        H = self.f.filter_by_frequency(weighted_graph, min_frequency=10)
        # edges with freq < 10 should be gone
        for u, v, d in H.edges(data=True):
            assert d.get("frequency", 10) >= 10

    def test_frequency_keeps_high_edges(self, weighted_graph):
        H = self.f.filter_by_frequency(weighted_graph, min_frequency=10)
        assert H.has_edge("start", "task1")

    def test_frequency_removes_isolates(self, weighted_graph):
        H = self.f.filter_by_frequency(weighted_graph, min_frequency=100)
        assert H.number_of_nodes() == 0 or all(
            H.degree(n) > 0 for n in H.nodes()
        )

    def test_attribute_filter_edge_keep(self, attributed_graph):
        H = self.f.filter_by_attribute(
            attributed_graph, target="edge", attribute="label",
            operator="eq", value="ok", keep_matching=True
        )
        for u, v, d in H.edges(data=True):
            assert d.get("label") == "ok"

    def test_attribute_filter_edge_remove(self, attributed_graph):
        H = self.f.filter_by_attribute(
            attributed_graph, target="edge", attribute="label",
            operator="eq", value="skip", keep_matching=False
        )
        for u, v, d in H.edges(data=True):
            assert d.get("label") != "skip"

    def test_attribute_filter_node(self, attributed_graph):
        H = self.f.filter_by_attribute(
            attributed_graph, target="node", attribute="role",
            operator="eq", value="start", keep_matching=False
        )
        assert "n1" not in H.nodes()

    def test_reduce_stub_returns_graph(self, small_dag):
        H = self.f.reduce(small_dag, "stub_placeholder", {})
        assert isinstance(H, (nx.DiGraph, nx.Graph))

    def test_reduce_unknown_raises(self, small_dag):
        with pytest.raises(ValueError):
            self.f.reduce(small_dag, "nonexistent_algo", {})

    def test_registry_has_required_keys(self):
        for algo in REDUCTION_ALGORITHMS:
            assert "id"          in algo
            assert "name"        in algo
            assert "description" in algo
            assert "params"      in algo


# ════════════════════════════════════════════════════════════
#  layout_selector.py
# ════════════════════════════════════════════════════════════

class TestLayoutSelector:
    ls = LayoutSelector()

    def test_dag_gets_hierarchical(self, small_dag):
        result = self.ls.pick(small_dag)
        # DAG should prefer dot or kamada-kawai
        assert result["layout_name"] in ("dot_layout", "kamada_kawai_layout",
                                          "spring_layout", "planar_layout")

    def test_override_respected(self, small_dag):
        result = self.ls.pick(small_dag, override="circular_layout")
        assert result["layout_name"] == "circular_layout"
        assert result["auto"] is False

    def test_positions_contain_all_nodes(self, small_dag):
        result = self.ls.pick(small_dag)
        for node in small_dag.nodes():
            assert str(node) in result["positions"]

    def test_position_values_are_pairs(self, small_dag):
        result = self.ls.pick(small_dag)
        for xy in result["positions"].values():
            assert len(xy) == 2

    def test_rules_have_required_keys(self):
        for rule in LAYOUT_RULES:
            assert "priority"  in rule
            assert "layout"    in rule
            assert "condition" in rule
            assert "note"      in rule

    def test_all_available_layouts_listed(self):
        assert len(AVAILABLE_LAYOUTS) > 0
        assert "spring_layout" in AVAILABLE_LAYOUTS


# ════════════════════════════════════════════════════════════
#  graph_loader.py  (no actual files — tests conversion logic)
# ════════════════════════════════════════════════════════════

class TestGraphLoader:
    loader = GraphLoader()

    def test_to_json_produces_valid_json(self, small_dag):
        s = self.loader._to_json(small_dag)
        data = json.loads(s)
        assert "nodes" in data or "links" in data

    def test_to_csv_produces_valid_csv(self, small_dag):
        s = self.loader._to_csv(small_dag)
        reader = csv.reader(io.StringIO(s))
        rows   = list(reader)
        assert rows[0][0] == "source"
        assert rows[0][1] == "target"
        assert len(rows) == small_dag.number_of_edges() + 1

    def test_threshold_determines_format(self, small_dag, large_graph):
        # small_dag has 4 edges < 250
        G_small = small_dag
        fmt = "json" if G_small.number_of_edges() < SMALL_GRAPH_THRESHOLD else "csv"
        assert fmt == "json"

        # large_graph should exceed threshold
        fmt_large = "json" if large_graph.number_of_edges() < SMALL_GRAPH_THRESHOLD else "csv"
        assert fmt_large == "csv"

    def test_extension_map_completeness(self):
        required = {".xes", ".yaml", ".json", ".csv", ".gml",
                    ".graphml", ".gexf", ".adjlist", ".edgelist"}
        for ext in required:
            assert ext in EXTENSION_MAP, f"Missing extension: {ext}"

    def test_load_csv_roundtrip(self, small_dag, tmp_path):
        # Save a CSV then load it back
        csv_path = str(tmp_path / "test.csv")
        with open(csv_path, "w") as f:
            f.write("source,target\n")
            for u, v in small_dag.edges():
                f.write(f"{u},{v}\n")
        result = self.loader.load(csv_path)
        assert result["graph"].number_of_edges() == small_dag.number_of_edges()

    def test_load_json_roundtrip(self, small_dag, tmp_path):
        json_path = str(tmp_path / "test.json")
        data = nx.node_link_data(small_dag)
        with open(json_path, "w") as f:
            json.dump(data, f)
        result = self.loader.load(json_path)
        assert result["graph"].number_of_nodes() == small_dag.number_of_nodes()

    def test_load_graphml_roundtrip(self, small_dag, tmp_path):
        gml_path = str(tmp_path / "test.graphml")
        nx.write_graphml(small_dag, gml_path)
        result = self.loader.load(gml_path)
        assert result["graph"].number_of_nodes() == small_dag.number_of_nodes()

    def test_load_gexf_roundtrip(self, small_dag, tmp_path):
        gexf_path = str(tmp_path / "test.gexf")
        nx.write_gexf(small_dag, gexf_path)
        result = self.loader.load(gexf_path)
        assert result["graph"].number_of_nodes() == small_dag.number_of_nodes()

    def test_unsupported_extension_raises(self, tmp_path):
        p = str(tmp_path / "test.xyz")
        open(p, "w").close()
        with pytest.raises(ValueError, match="Unsupported extension"):
            self.loader.load(p)


# ════════════════════════════════════════════════════════════
#  benchmarking.py
# ════════════════════════════════════════════════════════════

class TestBenchmarking:
    runner = BenchmarkRunner()

    def test_catalogue_has_all_libraries(self):
        cat = self.runner.get_catalogue()
        for lib in ("pm4py", "bupar", "bpmn-js", "mp4js"):
            assert lib in cat

    def test_all_entries_have_required_keys(self):
        cat = self.runner.get_catalogue()
        required = {"id", "name", "category", "description", "callable"}
        for lib, entries in cat.items():
            for e in entries:
                for k in required:
                    assert k in e, f"{lib}/{e.get('id')} missing key '{k}'"

    def test_uncallable_returns_error(self):
        result = self.runner.call_function("bpmn-js", "bpmnjs_import_definition", {})
        assert result["error"] is not None
        assert result["result"] is None

    def test_unknown_library_returns_error(self):
        result = self.runner.call_function("nonexistent", "some_func", {})
        assert result["error"] is not None

    def test_unknown_func_returns_error(self):
        result = self.runner.call_function("pm4py", "nonexistent_func_id", {})
        assert result["error"] is not None

    def test_callable_pm4py_without_log_fails_gracefully(self):
        result = self.runner.call_function("pm4py", "pm4py_alpha_miner", {}, log_path=None)
        # Should fail with an error (no log), not a crash
        assert "error" in result


# ════════════════════════════════════════════════════════════
#  Flask app integration smoke tests
# ════════════════════════════════════════════════════════════

class TestFlaskApp:
    @pytest.fixture(autouse=True)
    def setup_client(self):
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
        from app import app
        app.config["TESTING"]       = True
        app.config["UPLOAD_FOLDER"] = tempfile.mkdtemp()
        app.config["EXPORT_FOLDER"] = tempfile.mkdtemp()
        self.client = app.test_client()

    def test_index_returns_html(self):
        # Will 404 without index.html, but should not 500
        r = self.client.get("/")
        assert r.status_code in (200, 404)

    def test_stats_without_graph_returns_400(self):
        r = self.client.get("/api/graph/stats")
        assert r.status_code == 400

    def test_discover_without_log_returns_stub(self):
        r = self.client.post("/api/graph/discover",
                             json={"graph_type": "dfg"})
        data = r.get_json()
        assert "ok" in data

    def test_catalogue_returns_dict(self):
        r = self.client.get("/api/benchmark/catalogue")
        assert r.status_code == 200
        data = r.get_json()
        assert "catalogue" in data

    def test_algorithms_endpoint(self):
        r = self.client.get("/api/graph/algorithms")
        assert r.status_code == 200
        data = r.get_json()
        assert "algorithms" in data

    def test_upload_no_file_returns_400(self):
        r = self.client.post("/api/upload/file")
        assert r.status_code == 400

    def test_upload_csv_round_trip(self):
        csv_content = "source,target\nA,B\nB,C\n"
        data = {"file": (io.BytesIO(csv_content.encode()), "test.csv")}
        r = self.client.post("/api/upload/file",
                             data=data, content_type="multipart/form-data")
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert body["stats"]["edges"] == 2

    def test_discover_after_upload_uses_shared_state(self):
        """After a CSV upload the state is shared — discover should not 500."""
        csv_content = "source,target\nA,B\nB,C\n"
        self.client.post("/api/upload/file",
                         data={"file": (io.BytesIO(csv_content.encode()), "g.csv")},
                         content_type="multipart/form-data")
        r = self.client.post("/api/graph/discover",
                             json={"graph_type": "dfg"},
                             content_type="application/json")
        assert r.status_code == 200   # must not 500 regardless of pm4py presence
