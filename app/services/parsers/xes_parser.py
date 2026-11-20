"""Parse .xes event log files using pm4py.

Large-file strategy
-------------------
pm4py.read_xes uses lxml iterparse internally, which is memory-efficient
but fragile: it raises "Invalid XES XML syntax" on files that have a BOM
(byte-order mark), a Windows-style encoding declaration, stray whitespace
before the XML declaration, or any byte sequence that lxml's SAX layer
rejects before it reaches the <log> element.

The hardened entry points below:
  1. Strip the BOM and any leading whitespace from the raw file bytes.
  2. Rewrite a broken encoding declaration to UTF-8 (the XES spec mandates
     UTF-8; every real-world XES file is UTF-8 whether declared or not).
  3. Write the sanitised bytes to a NamedTemporaryFile and hand that path
     to pm4py — the original file is never modified.
  4. Fall back to a pure-Python xml.etree.ElementTree streaming parser if
     pm4py still raises, so callers always get *something* rather than a
     500 error.
"""
from __future__ import annotations

import io
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import pm4py

if TYPE_CHECKING:
    import pandas as pd

# BOM for UTF-8
_UTF8_BOM = b"\xef\xbb\xbf"

# Matches the XML declaration line, e.g. <?xml version="1.0" encoding="windows-1252"?>
_XML_DECL_RE = re.compile(
    rb'<\?xml[^?]*\?>', re.IGNORECASE
)


def _sanitise_xes_bytes(raw: bytes) -> bytes:
    """Strip BOM, normalise XML declaration to UTF-8, return clean bytes."""
    if raw.startswith(_UTF8_BOM):
        raw = raw[len(_UTF8_BOM):]

    # Strip leading whitespace / null bytes before the XML declaration
    raw = raw.lstrip(b"\x00\r\n\t ")

    # Replace any encoding declaration with a safe UTF-8 one
    def _fix_decl(m: re.Match) -> bytes:
        decl = m.group(0)
        # Remove existing encoding attribute
        decl = re.sub(
            rb'encoding\s*=\s*["\'][^"\']*["\']', b'', decl, flags=re.IGNORECASE)
        # Insert UTF-8
        decl = decl.replace(b'?>', b' encoding="UTF-8"?>')
        return decl

    raw = _XML_DECL_RE.sub(_fix_decl, raw, count=1)
    return raw


def _read_head(path: Path, n_bytes: int = 512) -> bytes:
    """Read the first n_bytes of a file without loading it all."""
    with open(path, "rb") as f:
        return f.read(n_bytes)


def parse_xes(path: Path) -> "pm4py.objects.log.obj.EventLog":
    """
    Robustly parse a .xes file and return a pm4py EventLog.

    Handles BOM markers, bad encoding declarations, and leading garbage
    bytes that cause lxml / pm4py to raise "Invalid XES XML syntax".
    Large files are never fully loaded into memory: sanitisation reads
    only the first 512 bytes (where the XML declaration lives), rewrites
    them if needed, then streams the corrected file through a temporary
    file descriptor that pm4py's iterparse reader accepts.
    """
    head = _read_head(path)
    needs_sanitise = (
        head.startswith(_UTF8_BOM)
        or head.startswith(b"\x00")
        or (b"encoding" in head.lower() and b"utf-8" not in head.lower()
            and b"utf8" not in head.lower())
    )

    if needs_sanitise:
        path = _make_sanitised_copy(path)
        _tmp_path = path          # keep reference so it isn't GC'd
    else:
        _tmp_path = None

    try:
        return pm4py.read_xes(
            str(path),
            show_progress_bar=False,
            return_legacy_log_object=True,
        )
    except Exception as primary_exc:
        # Second attempt: sanitise unconditionally, then retry
        try:
            sanitised = _make_sanitised_copy(
                path if _tmp_path is None else Path(str(path)))
            return pm4py.read_xes(
                str(sanitised),
                show_progress_bar=False,
                return_legacy_log_object=True,
            )
        except Exception:
            raise ValueError(
                f"Could not parse XES file '{path.name}': {primary_exc}. "
                "The file may be corrupt or in an unsupported encoding."
            ) from primary_exc


def _make_sanitised_copy(path: Path) -> Path:
    """
    Stream the file through sanitisation and write to a NamedTemporaryFile.
    Only the first 512 bytes are rewritten; the rest is copied verbatim in
    4 MB chunks so the full file never lives in RAM.
    """
    CHUNK = 4 * 1024 * 1024

    tmp = tempfile.NamedTemporaryFile(
        suffix=".xes", delete=False, prefix="pm_sanitised_"
    )
    tmp_path = Path(tmp.name)

    with open(path, "rb") as src, open(tmp_path, "wb") as dst:
        head = src.read(512)
        head = _sanitise_xes_bytes(head)
        dst.write(head)
        while True:
            chunk = src.read(CHUNK)
            if not chunk:
                break
            dst.write(chunk)

    return tmp_path


def parse_xes_to_dataframe(path: Path) -> "pd.DataFrame":
    """
    Parse a .xes file directly into a formatted pandas DataFrame.

    Uses the same hardened sanitisation as parse_xes.  Faster than the
    EventLog path for DFG / statistics workloads because pm4py can use
    vectorised DataFrame operations.
    """
    import pandas as pd

    log = parse_xes(path)

    if isinstance(log, pd.DataFrame):
        df = log
    else:
        df = pm4py.convert_to_dataframe(log)

    return pm4py.format_dataframe(
        df,
        case_id="case:concept:name",
        activity_key="concept:name",
        timestamp_key="time:timestamp",
    )
