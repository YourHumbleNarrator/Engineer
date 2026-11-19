"""Parse .pnml Petri net files using pm4py."""
from pathlib import Path

import pm4py


def parse_pnml(path: Path):
    """Return (net, initial_marking, final_marking) from a .pnml file."""
    net, im, fm = pm4py.read_pnml(str(path))
    return net, im, fm
