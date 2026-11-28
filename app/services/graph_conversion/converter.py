"""Convert various graph file formats into a DFG-compatible JSON graph."""
import uuid
from pathlib import Path
from typing import Any, Dict

import networkx as nx
import pandas as pd
import yaml


_NATIVE_KINDS = {"dfg", "petri_net", "process_tree", "bpmn"}


def convert(path: Path, fmt: str) -> Dict[str, Any]:
    """
    Convert a graph file to a DFG-style JSON dict with nodes and edges.
    Returns a dict matching the DFGGraph schema.

    Supported formats:
      gml, graphml, gexf, net / pajek, yaml / yml, csv, txt, xes, json.

    Lossless pass-through
    ---------------------
    When the uploaded JSON already carries a native graph envelope
    (``"kind": "dfg" | "petri_net" | "process_tree" | "bpmn"``) the file
    is returned as-is without routing through the NetworkX pipeline.
    This preserves every field — ``count``, ``meanDurationSec``,
    ``startActivities``, ``endActivities``, ``places``, ``arcs``, etc. —
    that would otherwise be silently dropped or overwritten by
    ``_nx_to_dfg``.
    """
    fmt = fmt.lower().lstrip(".")

    if fmt == "json":
        import json
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("kind") in _NATIVE_KINDS:
            return data  # ← lossless pass-through, nothing rebuilt

    G = _load_graph(path, fmt)
    return _nx_to_dfg(G, path.stem)


def _load_graph(path: Path, fmt: str) -> nx.Graph:
    if fmt == "gml":
        return nx.read_gml(str(path))
    elif fmt == "graphml":
        return nx.read_graphml(str(path))
    elif fmt == "gexf":
        return nx.read_gexf(str(path))
    elif fmt in ("net", "pajek"):
        # Both .net and .pajek extensions map to Pajek format
        return nx.read_pajek(str(path))
    elif fmt in ("yaml", "yml"):
        return _load_yaml_graph(path)
    elif fmt == "csv":
        return _load_csv_graph(path)
    elif fmt == "txt":
        return _load_txt_graph(path)
    elif fmt == "xes":
        return _load_xes_as_dfg_graph(path)
    elif fmt == "json":
        return _load_json_graph(path)
    else:
        raise ValueError(f"Unsupported graph format: {fmt}")


def _load_yaml_graph(path: Path) -> nx.DiGraph:
    with open(path) as f:
        data = yaml.safe_load(f)
    G = nx.DiGraph()
    for n in data.get("nodes", []):
        nid = n if isinstance(n, str) else n.get("id", str(n))
        G.add_node(nid, label=nid)
    for e in data.get("edges", []):
        if isinstance(e, (list, tuple)):
            G.add_edge(str(e[0]), str(e[1]))
        else:
            G.add_edge(
                str(e["source"]),
                str(e["target"]),
                weight=e.get("weight", 1),
            )
    return G


def _load_csv_graph(path: Path) -> nx.DiGraph:
    df = pd.read_csv(str(path))
    cols = df.columns.tolist()
    src_col = next(
        (c for c in cols if "source" in c.lower() or c.lower() in ("src", "from")),
        cols[0],
    )
    tgt_col = next(
        (c for c in cols if "target" in c.lower() or c.lower() in ("dst", "to")),
        cols[1],
    )
    weight_col = next(
        (c for c in cols if "weight" in c.lower() or "count" in c.lower()),
        None,
    )
    G = nx.DiGraph()
    for _, row in df.iterrows():
        w = int(row[weight_col]) if weight_col else 1
        G.add_edge(str(row[src_col]), str(row[tgt_col]), weight=w)
    return G


def _load_txt_graph(path: Path) -> nx.DiGraph:
    G = nx.DiGraph()
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                w = int(parts[2]) if len(parts) >= 3 else 1
                G.add_edge(parts[0], parts[1], weight=w)
    return G


def _load_json_graph(path: Path) -> nx.DiGraph:
    """
    Load a graph from a JSON file.  Accepts three layouts:

    1. node-link format (networkx native):
       {"directed": true, "nodes": [...], "links": [...]}

    2. adjacency list:
       {"nodes": ["A","B"], "edges": [{"source":"A","target":"B","weight":3}]}

    3. plain edge list:
       [{"source":"A","target":"B"}, ...]
       or [["A","B"], ...]
    """
    import json

    with open(path) as f:
        data = json.load(f)

    # 1. networkx node-link format  {"nodes": [...], "links": [...]}
    # Parsed manually rather than via nx.node_link_graph because the
    # required keys ("nodes", "edges" vs "links") differ across nx versions.
    if isinstance(data, dict) and "links" in data:
        G = nx.DiGraph() if data.get("directed", True) else nx.Graph()
        for n in data.get("nodes", []):
            nid = n.get("id", str(n)) if isinstance(n, dict) else str(n)
            G.add_node(nid)
        for e in data["links"]:
            src = str(e.get("source", e.get("src", "")))
            tgt = str(e.get("target", e.get("dst", "")))
            w = int(e.get("weight", e.get("count", 1)))
            G.add_edge(src, tgt, weight=w)
        return G

    # 2. adjacency / edges dict
    if isinstance(data, dict) and ("edges" in data or "arcs" in data):
        edges = data.get("edges") or data.get("arcs", [])
        nodes = data.get("nodes", [])
        G = nx.DiGraph()
        for n in nodes:
            nid = n if isinstance(n, str) else n.get("id", str(n))
            G.add_node(nid, label=n.get("label", nid)
                       if isinstance(n, dict) else nid)
        for e in edges:
            if isinstance(e, (list, tuple)):
                src, tgt = str(e[0]), str(e[1])
                w = int(e[2]) if len(e) > 2 else 1
            else:
                src = str(e.get("source", e.get("src", e.get("from", ""))))
                tgt = str(e.get("target", e.get("dst", e.get("to", ""))))
                w = int(e.get("weight", e.get("count", 1)))
            G.add_edge(src, tgt, weight=w)
        return G

    # 3. plain list of edges
    if isinstance(data, list):
        G = nx.DiGraph()
        for e in data:
            if isinstance(e, (list, tuple)):
                G.add_edge(str(e[0]), str(e[1]), weight=int(
                    e[2]) if len(e) > 2 else 1)
            elif isinstance(e, dict):
                src = str(e.get("source", e.get("src", e.get("from", ""))))
                tgt = str(e.get("target", e.get("dst", e.get("to", ""))))
                G.add_edge(src, tgt, weight=int(
                    e.get("weight", e.get("count", 1))))
        return G

    raise ValueError(
        "JSON graph must be a node-link dict (with 'links'), "
        "an adjacency dict (with 'edges'), or a plain list of edges."
    )


def _load_xes_as_dfg_graph(path: Path) -> nx.DiGraph:
    import pm4py

    log = pm4py.read_xes(str(path))
    dfg, start_acts, end_acts = pm4py.discover_dfg(log)
    G = nx.DiGraph()
    for (src, tgt), cnt in dfg.items():
        G.add_edge(src, tgt, weight=cnt)
    return G


def _nx_to_dfg(G: nx.Graph, name: str) -> Dict[str, Any]:
    gid = f"graph-{uuid.uuid4().hex[:8]}"

    activities = []
    for nid, data in G.nodes(data=True):
        activities.append(
            {
                "id": str(nid),
                "label": data.get("label", str(nid)),
                "count": G.degree(nid),
                "meanDurationSec": None,
            }
        )

    edges = []
    for idx, (src, tgt, data) in enumerate(G.edges(data=True)):
        edges.append(
            {
                "id": f"e{idx}",
                "source": str(src),
                "target": str(tgt),
                "count": data.get("weight", 1),
                "meanDurationSec": None,
            }
        )

    if G.is_directed():
        start_acts = {str(n): G.degree(n)
                      for n in G.nodes() if G.in_degree(n) == 0}
        end_acts = {str(n): G.degree(n)
                    for n in G.nodes() if G.out_degree(n) == 0}
    else:
        start_acts = {}
        end_acts = {}

    return {
        "kind": "dfg",
        "id": gid,
        "name": name,
        "activities": activities,
        "startActivities": start_acts,
        "endActivities": end_acts,
        "edges": edges,
    }
