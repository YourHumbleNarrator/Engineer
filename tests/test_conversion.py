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
        graphml = tmp_path / "graph.graphml"
        graphml.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<graphml xmlns="http://graphml.graphdrawing.org/graphml">\n'
            '  <graph id="G" edgedefault="directed">\n'
            '    <node id="n0"/>\n'
            '    <node id="n1"/>\n'
            '    <node id="n2"/>\n'
            '    <edge id="e0" source="n0" target="n1"/>\n'
            '    <edge id="e1" source="n1" target="n2"/>\n'
            '  </graph>\n'
            '</graphml>\n'
        )
        try:
            import networkx  # noqa: F401
        except ImportError:
            pytest.skip("networkx not installed")

        from app.services.graph_conversion.converter import convert
        result = convert(graphml, "graphml")
        _assert_dfg_shape(result)
        assert len(result["activities"]) == 3
        assert len(result["edges"]) == 2


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
