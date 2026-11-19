"""Parse .xes event log files using pm4py."""
from pathlib import Path

import pm4py


def parse_xes(path: Path):
    """Return a pm4py EventLog from a .xes file."""
    log = pm4py.read_xes(str(path))
    return log
