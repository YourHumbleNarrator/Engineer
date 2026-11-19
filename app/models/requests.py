from pydantic import BaseModel
from typing import Literal, Optional


class DiscoverRequest(BaseModel):
    algorithm: Literal["alpha", "inductive", "heuristics"] = "inductive"
    output: Literal["dfg", "petri_net", "process_tree", "bpmn"] = "dfg"
    graph_id: Optional[str] = None
    graph_name: Optional[str] = None
    # CSV column mapping
    case_id_col: str = "case:concept:name"
    activity_col: str = "concept:name"
    timestamp_col: str = "time:timestamp"
    # R bridge
    use_r: bool = False


class SimplifyRequest(BaseModel):
    graph_id: str
    algorithm: Literal["filter_dfg", "abstraction", "merge_parallel"] = "filter_dfg"
    threshold: float = 0.2
    params: dict = {}


class SVGExportRequest(BaseModel):
    graph_json: dict   # raw graph object (any kind)
    width: int = 1200
    height: int = 800
    theme: Literal["light", "dark"] = "light"


class PMFunctionViewRequest(BaseModel):
    file_id: str
    extra_params: dict = {}
