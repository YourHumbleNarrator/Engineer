"""Discover Directly-Follows Graphs (DFG) using pm4py.

Large-file note
---------------
pm4py.discover_dfg accepts both EventLog objects and pandas DataFrames.
Passing a DataFrame is significantly faster for large logs because pm4py
can operate on vectorised pandas operations rather than iterating Python
dicts.  The router passes whichever representation the parser produced.
"""
import uuid
from typing import Optional, Union

import pandas as pd
import pm4py

from app.models.graph import Activity, DFGEdge, DFGGraph

_Log = Union["pm4py.objects.log.obj.EventLog", pd.DataFrame]


def discover_dfg(
    log: _Log,
    graph_id: Optional[str] = None,
    graph_name: str = "Discovered DFG",
) -> DFGGraph:
    """
    Discover a DFG from a pm4py EventLog or a formatted pandas DataFrame.
    Also discovers the performance DFG to annotate edges with mean duration.
    """
    gid = graph_id or f"dfg-{uuid.uuid4().hex[:8]}"

    # Frequency DFG — works with both EventLog and DataFrame
    dfg, start_acts, end_acts = pm4py.discover_dfg(log)

    # Performance DFG for mean sojourn durations
    try:
        perf_dfg, _, _ = pm4py.discover_performance_dfg(log)
    except Exception:
        perf_dfg = {}

    # Activity occurrence counts
    try:
        act_counts = pm4py.get_event_attribute_values(log, "concept:name")
    except Exception:
        act_counts = {}

    # Collect all activity names
    act_set: set = set()
    for src, tgt in dfg:
        act_set.add(src)
        act_set.add(tgt)
    act_set.update(start_acts)
    act_set.update(end_acts)

    activities = [
        Activity(
            id=_safe_id(act),
            label=act,
            count=act_counts.get(act, 0),
            meanDurationSec=None,
        )
        for act in act_set
    ]

    edges = []
    for idx, ((src, tgt), cnt) in enumerate(dfg.items()):
        mean_dur = None
        perf_entry = perf_dfg.get((src, tgt))
        if perf_entry and isinstance(perf_entry, dict):
            mean_dur = perf_entry.get("mean")
        edges.append(
            DFGEdge(
                id=f"e{idx}",
                source=_safe_id(src),
                target=_safe_id(tgt),
                count=cnt,
                meanDurationSec=mean_dur,
            )
        )

    return DFGGraph(
        kind="dfg",
        id=gid,
        name=graph_name,
        activities=activities,
        startActivities={_safe_id(k): v for k, v in start_acts.items()},
        endActivities={_safe_id(k): v for k, v in end_acts.items()},
        edges=edges,
    )


def _safe_id(label: str) -> str:
    """Convert a label to a safe ID string."""
    return label.lower().replace(" ", "_").replace("-", "_")[:32]
