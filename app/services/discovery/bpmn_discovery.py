"""Discover BPMN models using pm4py."""
import uuid
from typing import Optional

import pm4py

from app.models.graph import BPMNEdge, BPMNGraph, BPMNNode


def discover_bpmn(
    log,
    graph_id: Optional[str] = None,
    graph_name: str = "Discovered BPMN",
) -> BPMNGraph:
    """Discover a BPMN 2.0 model from a pm4py EventLog using the Inductive Miner."""
    gid = graph_id or f"bpmn-{uuid.uuid4().hex[:8]}"
    bpmn_graph = pm4py.discover_bpmn_inductive(log)
    return _bpmn_to_graph(bpmn_graph, gid, graph_name)


def bpmn_file_to_graph(
    bpmn_obj,
    graph_id: Optional[str] = None,
    graph_name: str = "BPMN",
) -> BPMNGraph:
    """Convert a pm4py BPMN object (from file) to a BPMNGraph model."""
    gid = graph_id or f"bpmn-{uuid.uuid4().hex[:8]}"
    return _bpmn_to_graph(bpmn_obj, gid, graph_name)


def _bpmn_to_graph(bpmn_graph, gid: str, name: str) -> BPMNGraph:
    from pm4py.objects.bpmn.obj import BPMN

    type_map = {
        BPMN.StartEvent: "startEvent",
        BPMN.EndEvent: "endEvent",
        BPMN.IntermediateCatchEvent: "intermediateEvent",
        BPMN.Task: "task",
        BPMN.ExclusiveGateway: "xorGateway",
        BPMN.ParallelGateway: "andGateway",
        BPMN.InclusiveGateway: "orGateway",
    }

    nodes = []
    for node in bpmn_graph.get_nodes():
        ntype = type_map.get(type(node), "task")
        nodes.append(
            BPMNNode(
                id=str(node.get_id()),
                type=ntype,
                label=node.get_name() or "",
            )
        )

    edges = []
    for idx, flow in enumerate(bpmn_graph.get_flows()):
        edges.append(
            BPMNEdge(
                id=f"f{idx}",
                source=str(flow.get_source().get_id()),
                target=str(flow.get_target().get_id()),
                label=flow.get_name() or None,
            )
        )

    return BPMNGraph(kind="bpmn", id=gid, name=name, nodes=nodes, edges=edges, lanes=[])
