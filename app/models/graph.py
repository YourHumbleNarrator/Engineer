from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field


# ── Shared ───────────────────────────────────────────────────────────────────

class Activity(BaseModel):
    id: str
    label: str
    count: int = 0
    meanDurationSec: Optional[float] = None


class DFGEdge(BaseModel):
    id: str
    source: str
    target: str
    count: int = 0
    meanDurationSec: Optional[float] = None


class DFGGraph(BaseModel):
    kind: Literal["dfg"] = "dfg"
    id: str
    name: str
    activities: List[Activity] = []
    startActivities: Dict[str, int] = {}
    endActivities: Dict[str, int] = {}
    edges: List[DFGEdge] = []


# ── Petri Net ─────────────────────────────────────────────────────────────────

class Place(BaseModel):
    id: str
    label: str
    initialTokens: int = 0
    isFinal: bool = False


class Transition(BaseModel):
    id: str
    label: str
    silent: bool = False
    frequency: Optional[int] = None


class Arc(BaseModel):
    id: str
    source: str
    target: str
    weight: int = 1


class PetriNetGraph(BaseModel):
    kind: Literal["petri_net"] = "petri_net"
    id: str
    name: str
    places: List[Place] = []
    transitions: List[Transition] = []
    arcs: List[Arc] = []


# ── Process Tree ──────────────────────────────────────────────────────────────

class ProcessTreeNode(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    id: str
    type: Literal["operator", "activity", "tau"]
    label: Optional[str] = None
    operator: Optional[Literal["seq", "xor", "and", "loop", "or"]] = None
    children: List["ProcessTreeNode"] = []
    frequency: Optional[int] = None


ProcessTreeNode.model_rebuild()


class ProcessTreeGraph(BaseModel):
    kind: Literal["process_tree"] = "process_tree"
    id: str
    name: str
    root: ProcessTreeNode


# ── BPMN ──────────────────────────────────────────────────────────────────────

class BPMNNode(BaseModel):
    id: str
    type: Literal[
        "startEvent", "endEvent", "intermediateEvent",
        "task", "xorGateway", "andGateway", "orGateway"
    ]
    label: Optional[str] = None
    laneId: Optional[str] = None


class BPMNEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None


class BPMNLane(BaseModel):
    id: str
    label: str


class BPMNGraph(BaseModel):
    kind: Literal["bpmn"] = "bpmn"
    id: str
    name: str
    nodes: List[BPMNNode] = []
    edges: List[BPMNEdge] = []
    lanes: List[BPMNLane] = []


# ── Union ─────────────────────────────────────────────────────────────────────

GraphObject = Union[DFGGraph, PetriNetGraph, ProcessTreeGraph, BPMNGraph]
