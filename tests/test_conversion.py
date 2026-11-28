"""Tests for the graph file converter."""
import json
from pathlib import Path

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assert_dfg_shape(result: dict):
    """Verify a result dict looks like a DFG graph."""
    assert result["kind"] == "dfg"
    assert "id" in result
    assert "activities" in result
    assert "edges" in result
    assert isinstance(result["activities"], list)
    assert isinstance(result["edges"], list)


# ── CSV edge list ─────────────────────────────────────────────────────────────

class TestCsvConversion:
    def test_csv_edge_list(self, tmp_path):
        """CSV with source/target columns should produce a DFG-shaped dict."""
        csv = tmp_path / "graph.csv"
        csv.write_text(
            "source,target,weight\n"
            "CreateOrder,ApproveOrder,80\n"
            "ApproveOrder,ShipOrder,75\n"
            "ShipOrder,CloseOrder,70\n"
            "CreateOrder,CloseOrder,10\n"
        )
        from app.services.graph_conversion.converter import convert
        result = convert(csv, "csv")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 4
        # Edge weights should be preserved
        weights = {e["count"] for e in result["edges"]}
        assert 80 in weights

    def test_csv_alternate_col_names(self, tmp_path):
        """CSV with 'from'/'to' column names should still parse."""
        csv = tmp_path / "graph2.csv"
        csv.write_text("from,to\nA,B\nB,C\nC,A\n")
        from app.services.graph_conversion.converter import convert
        result = convert(csv, "csv")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 3

    def test_csv_no_weight_defaults_to_1(self, tmp_path):
        csv = tmp_path / "g.csv"
        csv.write_text("source,target\nX,Y\nY,Z\n")
        from app.services.graph_conversion.converter import convert
        result = convert(csv, "csv")
        for edge in result["edges"]:
            assert edge["count"] == 1


# ── YAML graph ────────────────────────────────────────────────────────────────

class TestYamlConversion:
    def test_yaml_nodes_and_edges(self, tmp_path):
        """YAML with nodes and edges list should produce valid DFG."""
        yaml_file = tmp_path / "graph.yaml"
        yaml_file.write_text(
            "nodes:\n"
            "  - id: A\n"
            "  - id: B\n"
            "  - id: C\n"
            "edges:\n"
            "  - source: A\n"
            "    target: B\n"
            "    weight: 10\n"
            "  - source: B\n"
            "    target: C\n"
            "    weight: 8\n"
        )
        from app.services.graph_conversion.converter import convert
        result = convert(yaml_file, "yaml")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 2

    def test_yaml_simple_string_nodes(self, tmp_path):
        """YAML with plain string nodes (not dicts) should work."""
        yaml_file = tmp_path / "simple.yaml"
        yaml_file.write_text(
            "nodes: [A, B]\n"
            "edges:\n"
            "  - [A, B]\n"
        )
        from app.services.graph_conversion.converter import convert
        result = convert(yaml_file, "yaml")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 1

    def test_yaml_missing_nodes_key(self, tmp_path):
        """YAML with no 'nodes' key but valid edges should still work."""
        yaml_file = tmp_path / "edges_only.yaml"
        yaml_file.write_text(
            "edges:\n"
            "  - source: X\n"
            "    target: Y\n"
        )
        from app.services.graph_conversion.converter import convert
        result = convert(yaml_file, "yaml")
        _assert_dfg_shape(result)


# ── TXT edge list ─────────────────────────────────────────────────────────────

class TestTxtConversion:
    def test_txt_space_separated(self, tmp_path):
        """Space-separated source target [weight] format should parse."""
        txt = tmp_path / "graph.txt"
        txt.write_text(
            "# comment line\n"
            "A B 5\n"
            "B C 3\n"
            "C D\n"
        )
        from app.services.graph_conversion.converter import convert
        result = convert(txt, "txt")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 3

    def test_txt_skips_comments(self, tmp_path):
        txt = tmp_path / "g.txt"
        txt.write_text("# header\n# another comment\nA B\nB C\n")
        from app.services.graph_conversion.converter import convert
        result = convert(txt, "txt")
        assert len(result["edges"]) == 2

    def test_txt_empty_file(self, tmp_path):
        txt = tmp_path / "empty.txt"
        txt.write_text("")
        from app.services.graph_conversion.converter import convert
        result = convert(txt, "txt")
        _assert_dfg_shape(result)
        assert result["edges"] == []


# ── GML (via networkx) ────────────────────────────────────────────────────────

class TestGmlConversion:
    def test_gml_directed_graph(self, tmp_path):
        """Standard GML directed graph should convert cleanly."""
        gml = tmp_path / "graph.gml"
        gml.write_text(
            "graph [\n"
            "  directed 1\n"
            "  node [ id 0 label \"CreateOrder\" ]\n"
            "  node [ id 1 label \"ApproveOrder\" ]\n"
            "  node [ id 2 label \"CloseOrder\" ]\n"
            "  edge [ source 0 target 1 ]\n"
            "  edge [ source 1 target 2 ]\n"
            "]\n"
        )
        try:
            import networkx  # noqa: F401
        except ImportError:
            pytest.skip("networkx not installed")

        from app.services.graph_conversion.converter import convert
        result = convert(gml, "gml")
        _assert_dfg_shape(result)
        assert len(result["activities"]) == 3
        assert len(result["edges"]) == 2

    def test_gml_node_labels_in_activities(self, tmp_path):
        gml = tmp_path / "labeled.gml"
        gml.write_text(
            "graph [\n"
            "  node [ id 0 label \"Task A\" ]\n"
            "  node [ id 1 label \"Task B\" ]\n"
            "  edge [ source 0 target 1 ]\n"
            "]\n"
        )
        try:
            import networkx  # noqa: F401
        except ImportError:
            pytest.skip("networkx not installed")

        from app.services.graph_conversion.converter import convert
        result = convert(gml, "gml")
        labels = {a["label"] for a in result["activities"]}
        assert "Task A" in labels or "0" in labels  # networkx may use id as key


# ── GraphML ───────────────────────────────────────────────────────────────────

class TestGraphMLConversion:
    def test_graphml_basic(self, tmp_path):
        """Standard GraphML file should parse and produce a DFG-shaped result."""
        try:
            import networkx as nx
        except ImportError:
            pytest.skip("networkx not installed")

        # Use networkx's own writer so the namespace and schema-location
        # attributes are exactly what its reader expects (xmlns/xmlns is
        # http://graphml.graphdrawing.org/xmlns, NOT /graphml).
        graphml = tmp_path / "graph.graphml"
        G = nx.DiGraph()
        G.add_node("n0", label="CreateOrder")
        G.add_node("n1", label="ApproveOrder")
        G.add_node("n2", label="CloseOrder")
        G.add_edge("n0", "n1")
        G.add_edge("n1", "n2")
        nx.write_graphml(G, str(graphml))

        from app.services.graph_conversion.converter import convert
        result = convert(graphml, "graphml")
        _assert_dfg_shape(result)
        assert len(result["activities"]) == 3
        assert len(result["edges"]) == 2


# ── JSON graph ────────────────────────────────────────────────────────────────

class TestJsonConversion:
    def test_node_link_format(self, tmp_path):
        """networkx node-link JSON should round-trip cleanly."""
        import networkx as nx
        import json
        G = nx.DiGraph()
        G.add_edge("A", "B", weight=5)
        G.add_edge("B", "C", weight=3)
        p = tmp_path / "g.json"
        p.write_text(json.dumps(nx.node_link_data(G)))
        from app.services.graph_conversion.converter import convert
        result = convert(p, "json")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 2

    def test_adjacency_dict_format(self, tmp_path):
        """Dict with 'edges' key should parse."""
        import json
        data = {
            "nodes": ["X", "Y", "Z"],
            "edges": [
                {"source": "X", "target": "Y", "weight": 10},
                {"source": "Y", "target": "Z", "weight": 7},
            ],
        }
        p = tmp_path / "g.json"
        p.write_text(json.dumps(data))
        from app.services.graph_conversion.converter import convert
        result = convert(p, "json")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 2
        counts = {e["count"] for e in result["edges"]}
        assert 10 in counts and 7 in counts

    def test_plain_edge_list_dicts(self, tmp_path):
        """Plain list of {source, target} dicts should parse."""
        import json
        data = [{"source": "A", "target": "B"}, {"source": "B", "target": "C"}]
        p = tmp_path / "g.json"
        p.write_text(json.dumps(data))
        from app.services.graph_conversion.converter import convert
        result = convert(p, "json")
        assert len(result["edges"]) == 2

    def test_plain_edge_list_arrays(self, tmp_path):
        """Plain list of [src, tgt, weight] arrays should parse."""
        import json
        data = [["A", "B", 4], ["B", "C", 2]]
        p = tmp_path / "g.json"
        p.write_text(json.dumps(data))
        from app.services.graph_conversion.converter import convert
        result = convert(p, "json")
        assert len(result["edges"]) == 2
        assert result["edges"][0]["count"] == 4

    def test_invalid_json_structure_raises(self, tmp_path):
        import json
        p = tmp_path / "g.json"
        p.write_text(json.dumps({"foo": "bar"}))  # no edges, no links
        from app.services.graph_conversion.converter import convert
        with pytest.raises((ValueError, Exception)):
            convert(p, "json")


# ── Native DFG JSON pass-through ──────────────────────────────────────────────

class TestNativeDFGPassThrough:
    """
    A JSON file that already contains a native graph envelope
    (kind == "dfg" | "petri_net" | "process_tree" | "bpmn") must be
    returned verbatim — no fields overwritten or dropped.
    """

    _NATIVE_DFG = {
        "kind": "dfg",
        "id": "my-dfg",
        "name": "Event Log DFG",
        "activities": [
            {"id": "a", "label": "Create Order",
                "count": 120, "meanDurationSec": 300.0},
            {"id": "b", "label": "Approve Order",
                "count": 95,  "meanDurationSec": 600.0},
        ],
        "startActivities": {"a": 120},
        "endActivities":   {"b": 95},
        "edges": [
            {"id": "e1", "source": "a", "target": "b",
                "count": 95, "meanDurationSec": 1800.0}
        ],
    }

    def _write(self, tmp_path, data) -> "Path":
        import json
        p = tmp_path / "graph.json"
        p.write_text(json.dumps(data))
        return p

    # ── kind == "dfg" ─────────────────────────────────────────────────────────

    def test_kind_dfg_returned_verbatim(self, tmp_path):
        from app.services.graph_conversion.converter import convert
        p = self._write(tmp_path, self._NATIVE_DFG)
        result = convert(p, "json")
        assert result == self._NATIVE_DFG

    def test_activity_counts_preserved(self, tmp_path):
        """count must come from the file, not from G.degree()."""
        from app.services.graph_conversion.converter import convert
        p = self._write(tmp_path, self._NATIVE_DFG)
        result = convert(p, "json")
        counts = {a["label"]: a["count"] for a in result["activities"]}
        assert counts["Create Order"] == 120
        assert counts["Approve Order"] == 95

    def test_mean_duration_preserved(self, tmp_path):
        """meanDurationSec must not be dropped."""
        from app.services.graph_conversion.converter import convert
        p = self._write(tmp_path, self._NATIVE_DFG)
        result = convert(p, "json")
        edge = result["edges"][0]
        assert edge["meanDurationSec"] == 1800.0
        act = next(a for a in result["activities"] if a["id"] == "a")
        assert act["meanDurationSec"] == 300.0

    def test_start_end_activities_preserved(self, tmp_path):
        """startActivities / endActivities must not be recomputed."""
        from app.services.graph_conversion.converter import convert
        p = self._write(tmp_path, self._NATIVE_DFG)
        result = convert(p, "json")
        assert result["startActivities"] == {"a": 120}
        assert result["endActivities"] == {"b": 95}

    def test_id_and_name_preserved(self, tmp_path):
        from app.services.graph_conversion.converter import convert
        p = self._write(tmp_path, self._NATIVE_DFG)
        result = convert(p, "json")
        assert result["id"] == "my-dfg"
        assert result["name"] == "Event Log DFG"

    # ── other native kinds also pass through ──────────────────────────────────

    def test_kind_petri_net_passthrough(self, tmp_path):
        from app.services.graph_conversion.converter import convert
        data = {
            "kind": "petri_net",
            "id": "pn-1",
            "name": "My Net",
            "places": [{"id": "p0", "label": "source", "initialTokens": 1, "isFinal": False}],
            "transitions": [{"id": "t0", "label": "Create Order", "silent": False, "frequency": 120}],
            "arcs": [{"id": "a0", "source": "p0", "target": "t0", "weight": 1}],
        }
        p = self._write(tmp_path, data)
        assert convert(p, "json") == data

    def test_kind_bpmn_passthrough(self, tmp_path):
        from app.services.graph_conversion.converter import convert
        data = {
            "kind": "bpmn",
            "id": "bpmn-1",
            "name": "My BPMN",
            "nodes": [{"id": "n0", "type": "startEvent", "label": "Start"}],
            "edges": [{"id": "f0", "source": "n0", "target": "n1"}],
            "lanes": [],
        }
        p = self._write(tmp_path, data)
        assert convert(p, "json") == data

    def test_kind_process_tree_passthrough(self, tmp_path):
        from app.services.graph_conversion.converter import convert
        data = {
            "kind": "process_tree",
            "id": "pt-1",
            "name": "My Tree",
            "root": {
                "id": "n0", "type": "operator", "operator": "seq",
                "children": [
                    {"id": "n1", "type": "activity", "label": "A", "children": []},
                    {"id": "n2", "type": "activity", "label": "B", "children": []},
                ],
            },
        }
        p = self._write(tmp_path, data)
        assert convert(p, "json") == data

    # ── non-native JSON still goes through the NetworkX pipeline ─────────────

    def test_generic_edge_list_still_converted(self, tmp_path):
        """A JSON without 'kind' must still go through _load_json_graph."""
        import json
        from app.services.graph_conversion.converter import convert
        data = [{"source": "X", "target": "Y"}, {"source": "Y", "target": "Z"}]
        p = tmp_path / "edges.json"
        p.write_text(json.dumps(data))
        result = convert(p, "json")
        # Result is rebuilt by _nx_to_dfg — kind is still "dfg" but id is auto-generated
        assert result["kind"] == "dfg"
        assert len(result["edges"]) == 2
        # counts come from degree, not from the file — verify no meanDurationSec explosion
        for edge in result["edges"]:
            assert edge["meanDurationSec"] is None

    def test_unknown_kind_still_converted(self, tmp_path):
        """kind == 'custom' is not a native kind, so it goes through the pipeline."""
        import json
        from app.services.graph_conversion.converter import convert
        data = {"kind": "custom", "links": [{"source": "A", "target": "B"}]}
        p = tmp_path / "custom.json"
        p.write_text(json.dumps(data))
        # networkx node-link format — should parse via _load_json_graph
        result = convert(p, "json")
        assert result["kind"] == "dfg"  # rebuilt by _nx_to_dfg


# ── Pajek (.pajek alias) ──────────────────────────────────────────────────────

class TestPajekConversion:
    def test_pajek_via_net_extension(self, tmp_path):
        """Standard Pajek .net format should parse via networkx."""
        import networkx as nx
        G = nx.DiGraph()
        G.add_edge("1", "2", weight=3)
        G.add_edge("2", "3", weight=1)
        p = tmp_path / "graph.net"
        nx.write_pajek(G, str(p))
        from app.services.graph_conversion.converter import convert
        result = convert(p, "net")
        _assert_dfg_shape(result)
        assert len(result["edges"]) == 2

    def test_pajek_extension_alias(self, tmp_path):
        """.pajek extension should be treated same as .net."""
        import networkx as nx
        G = nx.DiGraph()
        G.add_edge("A", "B")
        # write as .net, then copy to .pajek — extension is what the router passes
        net_p = tmp_path / "g.net"
        nx.write_pajek(G, str(net_p))
        pajek_p = tmp_path / "g.pajek"
        pajek_p.write_bytes(net_p.read_bytes())
        from app.services.graph_conversion.converter import convert
        # converter only receives the fmt string, not the path extension
        # router strips dot and maps .pajek→net
        result = convert(pajek_p, "net")
        _assert_dfg_shape(result)


# ── Unsupported format ────────────────────────────────────────────────────────

class TestUnsupportedFormat:
    def test_unsupported_raises_value_error(self, tmp_path):
        f = tmp_path / "file.xyz"
        f.write_text("data")
        from app.services.graph_conversion.converter import convert
        with pytest.raises(ValueError, match="Unsupported"):
            convert(f, "xyz")


# ── Output structure invariants ───────────────────────────────────────────────

class TestOutputStructure:
    """The converter always returns a dict that matches the DFG JSON schema."""

    @pytest.mark.parametrize("content,fmt", [
        ("source,target\nA,B\nB,C\n", "csv"),
        ("nodes: [A, B]\nedges:\n  - [A, B]\n", "yaml"),
        ("A B\nB C\n", "txt"),
    ])
    def test_required_keys_present(self, tmp_path, content, fmt):
        f = tmp_path / f"g.{fmt}"
        f.write_text(content)
        from app.services.graph_conversion.converter import convert
        result = convert(f, fmt)
        for key in ("kind", "id", "name", "activities", "startActivities", "endActivities", "edges"):
            assert key in result, f"Missing key '{key}' in result for format {fmt}"

    @pytest.mark.parametrize("content,fmt", [
        ("source,target\nA,B\n", "csv"),
        ("nodes: [A]\nedges: []\n", "yaml"),
        ("A B\n", "txt"),
    ])
    def test_edge_has_required_fields(self, tmp_path, content, fmt):
        f = tmp_path / f"g.{fmt}"
        f.write_text(content)
        from app.services.graph_conversion.converter import convert
        result = convert(f, fmt)
        for edge in result["edges"]:
            for field in ("id", "source", "target", "count"):
                assert field in edge
