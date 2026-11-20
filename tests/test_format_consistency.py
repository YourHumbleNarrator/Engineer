"""
Format-consistency tests
========================
The same event log expressed in different file formats (CSV, XES, PNML, …)
must produce identical — or provably equivalent — DFG outputs when passed
through the discovery pipeline.

What "identical" means here
----------------------------
* Same set of activity labels
* Same set of (source, target) edge pairs
* Same edge frequencies (counts)
* Same start-activity and end-activity sets and their counts

We do NOT require that auto-generated IDs or graph-level metadata fields
(id, name) match, because those are generated fresh on every call.

Fixture strategy
----------------
Every test class creates a *canonical* in-memory event log (a list of
trace dicts) and then writes it to multiple formats via pm4py or by hand.
Each format is parsed by the corresponding parser, fed to discover_dfg,
and the resulting DFGGraph is compared against a *reference* DFG that was
discovered directly from the Python log object without any serialisation
round-trip.

Running without pm4py
---------------------
All tests are skipped gracefully when pm4py is not installed, so the
test suite still passes in a bare-Python environment (CI lint stage, etc.).
"""
from __future__ import annotations

import os
import textwrap
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

# ---------------------------------------------------------------------------
# Shared skip guard
# ---------------------------------------------------------------------------

def _require_pm4py():
    try:
        import pm4py  # noqa: F401
    except ImportError:
        pytest.skip("pm4py not installed")


# ---------------------------------------------------------------------------
# Canonical event log fixture
# ---------------------------------------------------------------------------

#: Five cases, four activities — deterministic, small enough for unit tests
CANONICAL_TRACES: List[List[str]] = [
    ["CreateOrder", "ApproveOrder", "ShipOrder", "CloseOrder"],
    ["CreateOrder", "ApproveOrder", "ShipOrder", "CloseOrder"],
    ["CreateOrder", "ApproveOrder", "CloseOrder"],
    ["CreateOrder", "ShipOrder", "CloseOrder"],
    ["CreateOrder", "ApproveOrder", "ApproveOrder", "ShipOrder", "CloseOrder"],
]

#: Expected edges present in every correctly discovered DFG
EXPECTED_EDGES: set[Tuple[str, str]] = {
    ("CreateOrder",  "ApproveOrder"),
    ("ApproveOrder", "ShipOrder"),
    ("ShipOrder",    "CloseOrder"),
    ("ApproveOrder", "CloseOrder"),
    ("CreateOrder",  "ShipOrder"),
    ("ApproveOrder", "ApproveOrder"),  # self-loop from last trace
}

EXPECTED_START_ACTIVITIES = {"CreateOrder"}
EXPECTED_END_ACTIVITIES   = {"CloseOrder"}


# ---------------------------------------------------------------------------
# Helpers — write the canonical log to various formats
# ---------------------------------------------------------------------------

def _write_canonical_csv(path: Path) -> None:
    """Write CANONICAL_TRACES as a standard pm4py CSV."""
    rows = ["case:concept:name,concept:name,time:timestamp"]
    ts_base = "2024-01-01 09:{:02d}:00"
    for case_idx, trace in enumerate(CANONICAL_TRACES):
        for event_idx, activity in enumerate(trace):
            rows.append(
                f"case{case_idx + 1},{activity},{ts_base.format(event_idx * 5)}"
            )
    path.write_text("\n".join(rows))


def _write_canonical_xes(path: Path) -> None:
    """Write CANONICAL_TRACES as a minimal XES file (hand-crafted XML)."""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<log xes.version="1.0" xmlns="http://www.xes-standard.org/">',
        '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
        '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
    ]
    for case_idx, trace in enumerate(CANONICAL_TRACES):
        lines.append("  <trace>")
        lines.append(f'    <string key="concept:name" value="case{case_idx + 1}"/>')
        for event_idx, activity in enumerate(trace):
            ts = f"2024-01-01T09:{event_idx * 5:02d}:00.000+00:00"
            lines.append("    <event>")
            lines.append(f'      <string key="concept:name" value="{activity}"/>')
            lines.append(f'      <date key="time:timestamp" value="{ts}"/>')
            lines.append("    </event>")
        lines.append("  </trace>")
    lines.append("</log>")
    path.write_text("\n".join(lines))


def _build_pm4py_log():
    """Build a pm4py EventLog directly from CANONICAL_TRACES (no file I/O)."""
    import pm4py
    import pandas as pd

    rows = []
    for case_idx, trace in enumerate(CANONICAL_TRACES):
        for event_idx, activity in enumerate(trace):
            rows.append({
                "case:concept:name": f"case{case_idx + 1}",
                "concept:name": activity,
                "time:timestamp": pd.Timestamp(
                    f"2024-01-01 09:{event_idx * 5:02d}:00", tz="UTC"
                ),
            })
    df = pd.DataFrame(rows)
    df = pm4py.format_dataframe(
        df,
        case_id="case:concept:name",
        activity_key="concept:name",
        timestamp_key="time:timestamp",
    )
    return pm4py.convert_to_event_log(df)


# ---------------------------------------------------------------------------
# DFG extraction helpers
# ---------------------------------------------------------------------------

def _dfg_from_log(log) -> Tuple[Dict, Dict, Dict]:
    """Return (dfg_dict, start_acts, end_acts) from any pm4py-compatible log."""
    import pm4py
    return pm4py.discover_dfg(log)


def _edge_set(dfg: Dict) -> set[Tuple[str, str]]:
    return set(dfg.keys())


def _activities_in_dfg(dfg: Dict, start: Dict, end: Dict) -> set[str]:
    acts: set = set()
    for src, tgt in dfg:
        acts.add(src)
        acts.add(tgt)
    acts.update(start)
    acts.update(end)
    return acts


# ---------------------------------------------------------------------------
# Reference DFG (no file I/O round-trip)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def reference_dfg():
    """Discover the DFG directly from the in-memory log — ground truth."""
    _require_pm4py()
    log = _build_pm4py_log()
    dfg, start, end = _dfg_from_log(log)
    return dfg, start, end


# ---------------------------------------------------------------------------
# Test: CSV → parser → discover_dfg
# ---------------------------------------------------------------------------

class TestCSVConsistency:
    def test_edge_set_matches_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv_path)
        dfg, start, end = _dfg_from_log(log)

        ref_dfg, ref_start, ref_end = reference_dfg
        assert _edge_set(dfg) == _edge_set(ref_dfg), (
            f"CSV-parsed DFG edges differ from reference.\n"
            f"  Extra:   {_edge_set(dfg) - _edge_set(ref_dfg)}\n"
            f"  Missing: {_edge_set(ref_dfg) - _edge_set(dfg)}"
        )

    def test_edge_counts_match_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv_path)
        dfg, start, end = _dfg_from_log(log)

        ref_dfg, _, _ = reference_dfg
        for edge, count in ref_dfg.items():
            assert dfg.get(edge) == count, (
                f"Edge {edge}: expected count={count}, got {dfg.get(edge)}"
            )

    def test_start_activities_match_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv_path)
        _, start, _ = _dfg_from_log(log)
        _, ref_start, _ = reference_dfg
        assert set(start.keys()) == set(ref_start.keys())

    def test_end_activities_match_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv_path)
        _, _, end = _dfg_from_log(log)
        _, _, ref_end = reference_dfg
        assert set(end.keys()) == set(ref_end.keys())

    def test_activity_set_matches_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv_path)
        dfg, start, end = _dfg_from_log(log)
        ref_dfg, ref_start, ref_end = reference_dfg
        assert _activities_in_dfg(dfg, start, end) == _activities_in_dfg(ref_dfg, ref_start, ref_end)


# ---------------------------------------------------------------------------
# Test: XES → parser → discover_dfg
# ---------------------------------------------------------------------------

class TestXESConsistency:
    def test_edge_set_matches_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        xes_path = tmp_path / "log.xes"
        _write_canonical_xes(xes_path)

        from app.services.parsers.xes_parser import parse_xes
        log = parse_xes(xes_path)
        dfg, start, end = _dfg_from_log(log)

        ref_dfg, ref_start, ref_end = reference_dfg
        assert _edge_set(dfg) == _edge_set(ref_dfg), (
            f"XES-parsed DFG edges differ from reference.\n"
            f"  Extra:   {_edge_set(dfg) - _edge_set(ref_dfg)}\n"
            f"  Missing: {_edge_set(ref_dfg) - _edge_set(dfg)}"
        )

    def test_edge_counts_match_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        xes_path = tmp_path / "log.xes"
        _write_canonical_xes(xes_path)

        from app.services.parsers.xes_parser import parse_xes
        log = parse_xes(xes_path)
        dfg, start, end = _dfg_from_log(log)

        ref_dfg, _, _ = reference_dfg
        for edge, count in ref_dfg.items():
            assert dfg.get(edge) == count, (
                f"Edge {edge}: expected count={count}, got {dfg.get(edge)}"
            )

    def test_start_end_activities_match_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        xes_path = tmp_path / "log.xes"
        _write_canonical_xes(xes_path)

        from app.services.parsers.xes_parser import parse_xes
        log = parse_xes(xes_path)
        _, start, end = _dfg_from_log(log)
        _, ref_start, ref_end = reference_dfg
        assert set(start.keys()) == set(ref_start.keys())
        assert set(end.keys())   == set(ref_end.keys())

    def test_activity_set_matches_reference(self, tmp_path, reference_dfg):
        _require_pm4py()
        xes_path = tmp_path / "log.xes"
        _write_canonical_xes(xes_path)

        from app.services.parsers.xes_parser import parse_xes
        log = parse_xes(xes_path)
        dfg, start, end = _dfg_from_log(log)
        ref_dfg, ref_start, ref_end = reference_dfg
        assert _activities_in_dfg(dfg, start, end) == _activities_in_dfg(ref_dfg, ref_start, ref_end)


# ---------------------------------------------------------------------------
# Test: CSV vs XES pairwise (no reference needed — just compare the two)
# ---------------------------------------------------------------------------

class TestCSVvsXESPairwise:
    """
    Cross-format consistency: the same log in CSV and XES must produce
    exactly the same DFG without any reference fixture.
    """

    @pytest.fixture(autouse=True)
    def _build_logs(self, tmp_path):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        xes_path = tmp_path / "log.xes"
        _write_canonical_csv(csv_path)
        _write_canonical_xes(xes_path)

        from app.services.parsers.csv_parser import parse_csv
        from app.services.parsers.xes_parser import parse_xes
        log_csv = parse_csv(csv_path)
        log_xes = parse_xes(xes_path)

        self.dfg_csv, self.start_csv, self.end_csv = _dfg_from_log(log_csv)
        self.dfg_xes, self.start_xes, self.end_xes = _dfg_from_log(log_xes)

    def test_same_edge_set(self):
        assert _edge_set(self.dfg_csv) == _edge_set(self.dfg_xes), (
            f"CSV and XES edge sets differ.\n"
            f"  CSV only: {_edge_set(self.dfg_csv) - _edge_set(self.dfg_xes)}\n"
            f"  XES only: {_edge_set(self.dfg_xes) - _edge_set(self.dfg_csv)}"
        )

    def test_same_edge_counts(self):
        for edge in self.dfg_csv:
            assert self.dfg_csv[edge] == self.dfg_xes.get(edge), (
                f"Edge {edge}: CSV count={self.dfg_csv[edge]}, "
                f"XES count={self.dfg_xes.get(edge)}"
            )

    def test_same_start_activities(self):
        assert set(self.start_csv.keys()) == set(self.start_xes.keys())

    def test_same_start_activity_counts(self):
        for act in self.start_csv:
            assert self.start_csv[act] == self.start_xes.get(act), (
                f"Start activity '{act}': CSV={self.start_csv[act]}, "
                f"XES={self.start_xes.get(act)}"
            )

    def test_same_end_activities(self):
        assert set(self.end_csv.keys()) == set(self.end_xes.keys())

    def test_same_end_activity_counts(self):
        for act in self.end_csv:
            assert self.end_csv[act] == self.end_xes.get(act), (
                f"End activity '{act}': CSV={self.end_csv[act]}, "
                f"XES={self.end_xes.get(act)}"
            )

    def test_same_activity_set(self):
        acts_csv = _activities_in_dfg(self.dfg_csv, self.start_csv, self.end_csv)
        acts_xes = _activities_in_dfg(self.dfg_xes, self.start_xes, self.end_xes)
        assert acts_csv == acts_xes


# ---------------------------------------------------------------------------
# Test: DFGGraph model — CSV vs XES via discover_dfg service
# ---------------------------------------------------------------------------

class TestDFGGraphModelConsistency:
    """
    End-to-end: use the service layer (discover_dfg) and compare DFGGraph
    model objects, not raw pm4py dicts.  Verifies the mapping from pm4py
    output → our JSON schema is format-independent.
    """

    @pytest.fixture(autouse=True)
    def _build_graphs(self, tmp_path):
        _require_pm4py()
        csv_path = tmp_path / "log.csv"
        xes_path = tmp_path / "log.xes"
        _write_canonical_csv(csv_path)
        _write_canonical_xes(xes_path)

        from app.services.parsers.csv_parser import parse_csv
        from app.services.parsers.xes_parser import parse_xes
        from app.services.discovery.dfg import discover_dfg

        self.graph_csv = discover_dfg(parse_csv(csv_path), graph_id="csv-test", graph_name="CSV")
        self.graph_xes = discover_dfg(parse_xes(xes_path), graph_id="xes-test", graph_name="XES")

    def test_same_activity_labels(self):
        labels_csv = {a.label for a in self.graph_csv.activities}
        labels_xes = {a.label for a in self.graph_xes.activities}
        assert labels_csv == labels_xes, (
            f"Activity labels differ.\n"
            f"  CSV only: {labels_csv - labels_xes}\n"
            f"  XES only: {labels_xes - labels_csv}"
        )

    def test_same_edge_pairs(self):
        def _pairs(g):
            # edges use _safe_id, so compare via labels looked up from activities
            id_to_label = {a.id: a.label for a in g.activities}
            return {
                (id_to_label.get(e.source, e.source), id_to_label.get(e.target, e.target))
                for e in g.edges
            }
        pairs_csv = _pairs(self.graph_csv)
        pairs_xes = _pairs(self.graph_xes)
        assert pairs_csv == pairs_xes, (
            f"Edge pairs differ.\n"
            f"  CSV only: {pairs_csv - pairs_xes}\n"
            f"  XES only: {pairs_xes - pairs_csv}"
        )

    def test_same_edge_counts(self):
        def _count_map(g):
            id_to_label = {a.id: a.label for a in g.activities}
            return {
                (id_to_label.get(e.source, e.source), id_to_label.get(e.target, e.target)): e.count
                for e in g.edges
            }
        counts_csv = _count_map(self.graph_csv)
        counts_xes = _count_map(self.graph_xes)
        for edge, count in counts_csv.items():
            assert counts_xes.get(edge) == count, (
                f"Edge {edge}: CSV count={count}, XES count={counts_xes.get(edge)}"
            )

    def test_same_start_activities(self):
        # startActivities keys are safe IDs; compare by resolving back to labels
        id_to_label_csv = {a.id: a.label for a in self.graph_csv.activities}
        id_to_label_xes = {a.id: a.label for a in self.graph_xes.activities}
        starts_csv = {id_to_label_csv.get(k, k) for k in self.graph_csv.startActivities}
        starts_xes = {id_to_label_xes.get(k, k) for k in self.graph_xes.startActivities}
        assert starts_csv == starts_xes

    def test_same_end_activities(self):
        id_to_label_csv = {a.id: a.label for a in self.graph_csv.activities}
        id_to_label_xes = {a.id: a.label for a in self.graph_xes.activities}
        ends_csv = {id_to_label_csv.get(k, k) for k in self.graph_csv.endActivities}
        ends_xes = {id_to_label_xes.get(k, k) for k in self.graph_xes.endActivities}
        assert ends_csv == ends_xes

    def test_activity_counts_match(self):
        """Each activity's occurrence count must be the same regardless of format."""
        counts_csv = {a.label: a.count for a in self.graph_csv.activities}
        counts_xes = {a.label: a.count for a in self.graph_xes.activities}
        for label, count in counts_csv.items():
            assert counts_xes.get(label) == count, (
                f"Activity '{label}': CSV count={count}, XES count={counts_xes.get(label)}"
            )


# ---------------------------------------------------------------------------
# Test: large-file chunking — chunked CSV produces same DFG as normal load
# ---------------------------------------------------------------------------

class TestChunkedCSVConsistency:
    """
    Verify that parse_csv (chunked) gives exactly the same DFG as a
    direct DataFrame load — no edge lost or duplicated due to chunk
    boundary effects.
    """

    def test_chunked_matches_full_load(self, tmp_path):
        _require_pm4py()
        import pm4py
        import pandas as pd

        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        # Reference: read entire file at once
        df_full = pd.read_csv(str(csv_path))
        df_full = pm4py.format_dataframe(
            df_full,
            case_id="case:concept:name",
            activity_key="concept:name",
            timestamp_key="time:timestamp",
        )
        log_full = pm4py.convert_to_event_log(df_full)
        dfg_full, start_full, end_full = pm4py.discover_dfg(log_full)

        # Chunked parser
        from app.services.parsers.csv_parser import parse_csv
        log_chunked = parse_csv(csv_path)
        dfg_chunked, start_chunked, end_chunked = pm4py.discover_dfg(log_chunked)

        assert _edge_set(dfg_chunked) == _edge_set(dfg_full)
        for edge in dfg_full:
            assert dfg_chunked.get(edge) == dfg_full[edge], (
                f"Edge {edge}: full={dfg_full[edge]}, chunked={dfg_chunked.get(edge)}"
            )
        assert set(start_chunked.keys()) == set(start_full.keys())
        assert set(end_chunked.keys())   == set(end_full.keys())

    def test_tiny_chunk_size_same_result(self, tmp_path, monkeypatch):
        """Force a very small chunk size to exercise chunk-boundary logic."""
        _require_pm4py()
        import pm4py
        import pandas as pd
        import app.services.parsers.csv_parser as csv_mod

        monkeypatch.setattr(csv_mod, "_CHUNK_ROWS", 2)  # 2 rows per chunk

        csv_path = tmp_path / "log.csv"
        _write_canonical_csv(csv_path)

        # Reference
        df_full = pd.read_csv(str(csv_path))
        df_full = pm4py.format_dataframe(
            df_full,
            case_id="case:concept:name",
            activity_key="concept:name",
            timestamp_key="time:timestamp",
        )
        log_full = pm4py.convert_to_event_log(df_full)
        dfg_full, _, _ = pm4py.discover_dfg(log_full)

        from app.services.parsers.csv_parser import parse_csv
        log_tiny = parse_csv(csv_path)
        dfg_tiny, _, _ = pm4py.discover_dfg(log_tiny)

        assert _edge_set(dfg_tiny) == _edge_set(dfg_full)
        for edge in dfg_full:
            assert dfg_tiny.get(edge) == dfg_full[edge]


# ---------------------------------------------------------------------------
# Test: expected DFG structure from canonical log
# ---------------------------------------------------------------------------

class TestExpectedDFGStructure:
    """
    Sanity checks that the canonical log produces the DFG we expect,
    regardless of which format is used to load it.
    """

    @pytest.fixture(params=["csv", "xes"])
    def log_from_format(self, request, tmp_path):
        _require_pm4py()
        fmt = request.param
        if fmt == "csv":
            path = tmp_path / "log.csv"
            _write_canonical_csv(path)
            from app.services.parsers.csv_parser import parse_csv
            return parse_csv(path)
        elif fmt == "xes":
            path = tmp_path / "log.xes"
            _write_canonical_xes(path)
            from app.services.parsers.xes_parser import parse_xes
            return parse_xes(path)

    def test_expected_edges_present(self, log_from_format):
        import pm4py
        dfg, start, end = pm4py.discover_dfg(log_from_format)
        actual_edges = _edge_set(dfg)
        for edge in EXPECTED_EDGES:
            assert edge in actual_edges, f"Expected edge {edge} missing from DFG"

    def test_expected_start_activities(self, log_from_format):
        import pm4py
        _, start, _ = pm4py.discover_dfg(log_from_format)
        assert set(start.keys()) == EXPECTED_START_ACTIVITIES

    def test_expected_end_activities(self, log_from_format):
        import pm4py
        _, _, end = pm4py.discover_dfg(log_from_format)
        assert set(end.keys()) == EXPECTED_END_ACTIVITIES

    def test_no_unexpected_edges(self, log_from_format):
        """No edges should appear that are not in our hand-crafted expected set."""
        import pm4py
        dfg, _, _ = pm4py.discover_dfg(log_from_format)
        for edge in _edge_set(dfg):
            assert edge in EXPECTED_EDGES, (
                f"Unexpected edge {edge} found in DFG — "
                "either the test traces or EXPECTED_EDGES need updating."
            )
