"""Discover process trees using pm4py Inductive Miner."""
import uuid
from typing import Optional

import pm4py
from pm4py.objects.process_tree.obj import Operator, ProcessTree

from app.models.graph import ProcessTreeGraph, ProcessTreeNode

_OP_MAP = {
    Operator.SEQUENCE: "seq",
    Operator.XOR: "xor",
    Operator.PARALLEL: "and",
    Operator.LOOP: "loop",
    Operator.OR: "or",
}


def discover_process_tree(
    log,
    graph_id: Optional[str] = None,
    graph_name: str = "Discovered Process Tree",
) -> ProcessTreeGraph:
    """Discover a process tree from a pm4py EventLog using the Inductive Miner."""
    gid = graph_id or f"pt-{uuid.uuid4().hex[:8]}"
    tree = pm4py.discover_process_tree_inductive(log)
    counter = [0]
    root = _node_to_model(tree, counter)
    return ProcessTreeGraph(kind="process_tree", id=gid, name=graph_name, root=root)


def _node_to_model(node: ProcessTree, counter: list) -> ProcessTreeNode:
    nid = f"n{counter[0]}"
    counter[0] += 1

    if node.operator is not None:
        op = _OP_MAP.get(node.operator, "seq")
        children = [_node_to_model(c, counter) for c in node.children]
        return ProcessTreeNode(id=nid, type="operator", operator=op, children=children)
    elif node.label is not None:
        return ProcessTreeNode(id=nid, type="activity", label=node.label)
    else:
        return ProcessTreeNode(id=nid, type="tau")
