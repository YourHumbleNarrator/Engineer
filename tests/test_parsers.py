"""Tests for event log parsers."""
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest


# ── CSV parser ────────────────────────────────────────────────────────────────

class TestCsvParser:
    def test_parse_csv_standard_columns(self, tmp_path):
        """parse_csv should work with standard pm4py column names."""
        csv = tmp_path / "log.csv"
        csv.write_text(
            "case:concept:name,concept:name,time:timestamp\n"
            "case1,CreateOrder,2024-01-01 09:00:00\n"
            "case1,ApproveOrder,2024-01-01 10:00:00\n"
            "case1,CloseOrder,2024-01-01 11:00:00\n"
        )
        try:
            import pm4py
        except ImportError:
            pytest.skip("pm4py not installed")

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv)
        assert log is not None
        assert len(log) == 1  # 1 case

    def test_parse_csv_custom_columns(self, tmp_path):
        """parse_csv should rename custom columns to pm4py standard."""
        csv = tmp_path / "log.csv"
        csv.write_text(
            "caseId,activity,ts\n"
            "c1,A,2024-01-01 08:00:00\n"
            "c1,B,2024-01-01 09:00:00\n"
            "c2,A,2024-01-01 08:30:00\n"
        )
        try:
            import pm4py
        except ImportError:
            pytest.skip("pm4py not installed")

        from app.services.parsers.csv_parser import parse_csv
        log = parse_csv(csv, case_id_col="caseId", activity_col="activity", timestamp_col="ts")
        assert len(log) == 2  # 2 cases

    def test_parse_csv_missing_file(self, tmp_path):
        """parse_csv should raise when the file does not exist."""
        from app.services.parsers.csv_parser import parse_csv
        with pytest.raises(Exception):
            parse_csv(tmp_path / "nonexistent.csv")


# ── XES parser ────────────────────────────────────────────────────────────────

class TestXesParser:
    def test_parse_xes_calls_pm4py(self, tmp_path):
        """parse_xes should delegate to pm4py.read_xes."""
        fake_xes = tmp_path / "log.xes"
        fake_xes.write_text("<log></log>")  # minimal placeholder

        mock_log = MagicMock()
        with patch("pm4py.read_xes", return_value=mock_log) as mock_read:
            from app.services.parsers import xes_parser
            # Reload to pick up the patch
            import importlib
            importlib.reload(xes_parser)
            result = xes_parser.parse_xes(fake_xes)

        # pm4py.read_xes should have been called with the string path
        mock_read.assert_called_once_with(str(fake_xes))
        assert result is mock_log


# ── PNML parser ───────────────────────────────────────────────────────────────

class TestPnmlParser:
    def test_parse_pnml_returns_triple(self, tmp_path):
        """parse_pnml should return (net, im, fm)."""
        fake_pnml = tmp_path / "net.pnml"
        fake_pnml.write_text("<pnml></pnml>")

        mock_net = MagicMock()
        mock_im = MagicMock()
        mock_fm = MagicMock()

        with patch("pm4py.read_pnml", return_value=(mock_net, mock_im, mock_fm)):
            from app.services.parsers import pnml_parser
            import importlib
            importlib.reload(pnml_parser)
            net, im, fm = pnml_parser.parse_pnml(fake_pnml)

        assert net is mock_net
        assert im is mock_im
        assert fm is mock_fm


# ── BPMN parser ───────────────────────────────────────────────────────────────

class TestBpmnParser:
    def test_parse_bpmn_calls_pm4py(self, tmp_path):
        """parse_bpmn should delegate to pm4py.read_bpmn."""
        fake_bpmn = tmp_path / "process.bpmn"
        fake_bpmn.write_text("<definitions></definitions>")

        mock_bpmn = MagicMock()
        with patch("pm4py.read_bpmn", return_value=mock_bpmn):
            from app.services.parsers import bpmn_parser
            import importlib
            importlib.reload(bpmn_parser)
            result = bpmn_parser.parse_bpmn(fake_bpmn)

        assert result is mock_bpmn
