"""Discover Petri nets using pm4py."""
import uuid
from typing import Literal, Optional

import pm4py

from app.models.graph import Arc, PetriNetGraph, Place, Transition

AlgoType = Literal["alpha", "inductive", "heuristics"]


def discover_petri_net(
    log,
    algorithm: AlgoType = "inductive",
    graph_id: Optional[str] = None,
    graph_name: str = "Discovered Petri Net",
) -> PetriNetGraph:
    """Discover a Petri net from a pm4py EventLog using the specified algorithm."""
    gid = graph_id or f"pn-{uuid.uuid4().hex[:8]}"

    if algorithm == "alpha":
        net, im, fm = pm4py.discover_petri_net_alpha(log)
    elif algorithm == "heuristics":
        net, im, fm = pm4py.discover_petri_net_heuristics(log)
    else:  # inductive (default)
        net, im, fm = pm4py.discover_petri_net_inductive(log)

    return _net_to_graph(net, im, fm, gid, graph_name)


def pnml_to_graph(
    net,
    im,
    fm,
    graph_id: Optional[str] = None,
    graph_name: str = "Petri Net",
) -> PetriNetGraph:
    """Convert a pm4py PetriNet object (from PNML) to a PetriNetGraph model."""
    gid = graph_id or f"pn-{uuid.uuid4().hex[:8]}"
    return _net_to_graph(net, im, fm, gid, graph_name)


def _net_to_graph(net, im, fm, gid: str, name: str) -> PetriNetGraph:
    places = []
    for p in net.places:
        initial = im.get(p, 0) if im else 0
        is_final = p in fm if fm else False
        places.append(
            Place(
                id=str(p.name),
                label=str(p.name),
                initialTokens=int(initial),
                isFinal=is_final,
            )
        )

    transitions = []
    for t in net.transitions:
        transitions.append(
            Transition(
                id=str(t.name),
                label=str(t.label) if t.label else "",
                silent=(t.label is None),
            )
        )

    arcs = []
    for idx, arc in enumerate(net.arcs):
        arcs.append(
            Arc(
                id=f"a{idx}",
                source=str(arc.source.name),
                target=str(arc.target.name),
                weight=getattr(arc, "weight", 1),
            )
        )

    return PetriNetGraph(
        kind="petri_net",
        id=gid,
        name=name,
        places=places,
        transitions=transitions,
        arcs=arcs,
    )
