"""
Request / response dataclasses for the graph API.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class UploadResponse:
    session: str
    filename: str
    num_cases: int
    num_events: int
    num_activities: int
    attributes: list[str] = field(default_factory=list)


@dataclass
class GraphResponse:
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    meta:  dict[str, Any] = field(default_factory=dict)


@dataclass
class LayoutRequest:
    algorithm: str = "cose"          # cose | dagre | breadthfirst | circle
    options:   dict[str, Any] = field(default_factory=dict)


@dataclass
class ExportRequest:
    format: str = "json"              # json | graphml | xes | svg
