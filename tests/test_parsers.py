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
        log = parse_csv(csv, case_id_col="caseId",
                        activity_col="activity", timestamp_col="ts")
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

        # pm4py.read_xes should have been called once, with the string path
        # as the first positional argument. We don't assert on extra kwargs
        # (show_progress_bar, return_legacy_log_object) so the test stays
        # valid if those defaults change.
        mock_read.assert_called_once()
        assert mock_read.call_args.args[0] == str(fake_xes)
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


# ── XES sanitiser (no pm4py needed) ──────────────────────────────────────────

class TestXesSanitiser:
    """Unit-test _sanitise_xes_bytes in isolation — no pm4py dependency."""

    @staticmethod
    def _sanitise(raw: bytes) -> bytes:
        from app.services.parsers.xes_parser import _sanitise_xes_bytes
        return _sanitise_xes_bytes(raw)

    def test_strips_utf8_bom(self):
        raw = b"\xef\xbb\xbf<?xml version=\"1.0\"?><log/>"
        result = self._sanitise(raw)
        assert not result.startswith(b"\xef\xbb\xbf")
        assert result.startswith(b"<?xml")

    def test_strips_leading_whitespace(self):
        raw = b"   \r\n<?xml version=\"1.0\"?><log/>"
        result = self._sanitise(raw)
        assert result.startswith(b"<?xml")

    def test_strips_null_bytes_before_declaration(self):
        raw = b"\x00\x00<?xml version=\"1.0\"?><log/>"
        result = self._sanitise(raw)
        assert result.startswith(b"<?xml")

    def test_rewrites_non_utf8_encoding_declaration(self):
        raw = b'<?xml version="1.0" encoding="windows-1252"?><log/>'
        result = self._sanitise(raw)
        assert b"windows-1252" not in result
        assert b"UTF-8" in result

    def test_rewrites_iso_encoding_declaration(self):
        raw = b'<?xml version="1.0" encoding="ISO-8859-1"?><log/>'
        result = self._sanitise(raw)
        assert b"ISO-8859-1" not in result
        assert b"UTF-8" in result

    def test_leaves_utf8_declaration_intact(self):
        raw = b'<?xml version="1.0" encoding="UTF-8"?><log/>'
        result = self._sanitise(raw)
        # UTF-8 stays; the declaration may be rewritten but must remain valid
        assert b"UTF-8" in result
        assert result.endswith(b"<log/>")

    def test_no_declaration_passthrough(self):
        """Files with no XML declaration should pass through unchanged."""
        raw = b"<log><trace></trace></log>"
        result = self._sanitise(raw)
        assert result == raw

    def test_bom_plus_bad_encoding(self):
        raw = b"\xef\xbb\xbf<?xml version=\"1.0\" encoding=\"latin-1\"?><log/>"
        result = self._sanitise(raw)
        assert not result.startswith(b"\xef\xbb\xbf")
        assert b"latin-1" not in result
        assert b"UTF-8" in result

    def test_sanitised_copy_streams_large_file(self, tmp_path):
        """_make_sanitised_copy must handle files larger than its head window."""
        from app.services.parsers.xes_parser import _make_sanitised_copy

        # Build a file: bad header + 2 MB of body
        body = b"<trace><event/></trace>\n" * 90_000   # ~2 MB
        raw = b"\xef\xbb\xbf<?xml version=\"1.0\" encoding=\"windows-1252\"?>\n<log>\n" + body + b"</log>"
        src = tmp_path / "big.xes"
        src.write_bytes(raw)

        out = _make_sanitised_copy(src)
        result_bytes = out.read_bytes()

        assert not result_bytes.startswith(b"\xef\xbb\xbf")
        assert b"windows-1252" not in result_bytes
        assert b"UTF-8" in result_bytes
        # Body must be intact — no data loss
        assert result_bytes.endswith(b"</log>")
        assert result_bytes.count(b"<event/>") == 90_000
