"""Parse .csv event log files into pm4py EventLog."""
from pathlib import Path

import pandas as pd
import pm4py


def parse_csv(
    path: Path,
    case_id_col: str = "case:concept:name",
    activity_col: str = "concept:name",
    timestamp_col: str = "time:timestamp",
):
    """
    Read a CSV event log and convert to a pm4py EventLog.
    Automatically renames columns to pm4py standard names if they differ.
    """
    df = pd.read_csv(str(path))

    # Rename to pm4py standard if needed
    rename_map = {}
    if case_id_col != "case:concept:name" and case_id_col in df.columns:
        rename_map[case_id_col] = "case:concept:name"
    if activity_col != "concept:name" and activity_col in df.columns:
        rename_map[activity_col] = "concept:name"
    if timestamp_col != "time:timestamp" and timestamp_col in df.columns:
        rename_map[timestamp_col] = "time:timestamp"
    if rename_map:
        df = df.rename(columns=rename_map)

    df = pm4py.format_dataframe(
        df,
        case_id="case:concept:name",
        activity_key="concept:name",
        timestamp_key="time:timestamp",
    )
    log = pm4py.convert_to_event_log(df)
    return log
