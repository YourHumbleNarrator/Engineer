"""Parse .bpmn files using pm4py."""
from pathlib import Path

import pm4py


def parse_bpmn(path: Path):
    """Return a pm4py BPMN graph from a .bpmn file."""
    bpmn_graph = pm4py.read_bpmn(str(path))
    return bpmn_graph
