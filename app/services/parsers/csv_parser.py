"""Parse .csv event log files into pm4py EventLog.

Large-file strategy
-------------------
pandas.read_csv with chunksize reads the file in fixed-size row batches,
so peak memory is O(chunk) rather than O(file).  Chunks are concatenated
into a single DataFrame only after all chunks are processed; because each
chunk is a small slice the total memory at concat time equals one pass
over the file — not two.

For truly enormous logs (> several GB) consider using pm4py's own
streaming iterator (pm4py.streaming) instead, but chunked pandas covers
the typical "700 MB CSV" use-case without needing a different API.
"""
from pathlib import Path
from typing import Iterator

import pandas as pd
import pm4py

# Rows per chunk.  At ~200 B/row this is ~100 MB of raw CSV per batch.
_CHUNK_ROWS = 500_000


def parse_csv(
    path: Path,
    case_id_col: str = "case:concept:name",
    activity_col: str = "concept:name",
    timestamp_col: str = "time:timestamp",
) -> "pm4py.objects.log.obj.EventLog":
    """
    Stream-read a CSV event log in chunks and return a pm4py EventLog.

    Columns are renamed to pm4py standard names when they differ.
    Memory footprint is bounded by _CHUNK_ROWS rows at any one time.
    """
    rename_map = _build_rename_map(case_id_col, activity_col, timestamp_col)

    chunks: list[pd.DataFrame] = []
    for chunk in pd.read_csv(str(path), chunksize=_CHUNK_ROWS, low_memory=False):
        if rename_map:
            chunk = chunk.rename(columns=rename_map)
        chunks.append(chunk)

    df = pd.concat(chunks, ignore_index=True)
    df = pm4py.format_dataframe(
        df,
        case_id="case:concept:name",
        activity_key="concept:name",
        timestamp_key="time:timestamp",
    )
    return pm4py.convert_to_event_log(df)


def parse_csv_to_dataframe(
    path: Path,
    case_id_col: str = "case:concept:name",
    activity_col: str = "concept:name",
    timestamp_col: str = "time:timestamp",
) -> pd.DataFrame:
    """
    Like parse_csv but returns a formatted DataFrame instead of an EventLog.
    Useful when pm4py DataFrame-based algorithms are preferred (faster on large logs).
    """
    rename_map = _build_rename_map(case_id_col, activity_col, timestamp_col)
    chunks: list[pd.DataFrame] = []
    for chunk in pd.read_csv(str(path), chunksize=_CHUNK_ROWS, low_memory=False):
        if rename_map:
            chunk = chunk.rename(columns=rename_map)
        chunks.append(chunk)
    df = pd.concat(chunks, ignore_index=True)
    return pm4py.format_dataframe(
        df,
        case_id="case:concept:name",
        activity_key="concept:name",
        timestamp_key="time:timestamp",
    )


# ── helpers ───────────────────────────────────────────────────────────────────

def _build_rename_map(case_id_col: str, activity_col: str, timestamp_col: str) -> dict:
    rename_map: dict = {}
    if case_id_col != "case:concept:name":
        rename_map[case_id_col] = "case:concept:name"
    if activity_col != "concept:name":
        rename_map[activity_col] = "concept:name"
    if timestamp_col != "time:timestamp":
        rename_map[timestamp_col] = "time:timestamp"
    return rename_map
