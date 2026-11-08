"""
graph_loader.py
Load a graph from any supported format, then export it to JSON or CSV
depending on a user-configurable routing condition.

Supported input formats
-----------------------
  .xes            Event log  → directly-follows graph (pm4py)
  .yaml / .yml    Custom schema  {nodes: [...], edges: [...]}
  .json           NetworkX node-link JSON
  .txt            Auto-detected: adjacency list or edge list
  .csv            Edge list  (source, target[, weight, ...])
  .adjlist        NetworkX adjacency list
  .edgelist       NetworkX weighted edge list
  .gml            GML
  .graphml        GraphML
  .gexf           GEXF
  .pajek / .net   Pajek
"""

from __future__ import annotations

import csv
import io
import json
import pathlib

import networkx as nx
import yaml


# ── Supported extensions ────────────────────────────────────────────────────

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset({
    ".xes",
    ".yaml", ".yml",
    ".json",
    ".txt",
    ".csv",
    ".adjlist",
    ".edgelist",
    ".gml",
    ".graphml",
    ".gexf",
    ".pajek", ".net",
})


# ══════════════════════════════════════════════════════════════════════════════
#  OUTPUT ROUTING CONDITION
#  ─────────────────────────
#  Replace the body of `_use_json` with any expression you like.
#  It receives the loaded NetworkX graph and must return True → JSON,
#  False → CSV.
#
#  Examples you can paste in:
#    return g.number_of_edges() < 250            # current default
#    return g.number_of_nodes() < 100
#    return nx.density(g) > 0.1
#    return g.number_of_edges() < 250 and g.number_of_nodes() < 100
#    return True                                  # always JSON
#    return False                                 # always CSV
# ══════════════════════════════════════════════════════════════════════════════

def _use_json(g: nx.DiGraph) -> bool:
    return g.number_of_edges() < 250


# ── Public API ───────────────────────────────────────────────────────────────

def load_and_convert(path: str | pathlib.Path) -> tuple[str, str]:
    """
    Load a graph from *path* and convert it to JSON or CSV.

    Returns
    -------
    (content, fmt)
        content : the serialised string (JSON or CSV)
        fmt     : "json" or "csv"
    """
    g = load_graph(path)
    if _use_json(g):
        return _to_json(g), "json"
    else:
        return _to_csv(g), "csv"


def load_graph(path: str | pathlib.Path) -> nx.DiGraph:
    """
    Load a graph from *path* into a NetworkX DiGraph.
    Raises ValueError for unrecognised extensions.
    """
    path = pathlib.Path(path)
    ext = path.suffix.lower()

    _loaders = {
        ".xes":      _load_xes,
        ".yaml":     _load_yaml,
        ".yml":      _load_yaml,
        ".json":     _load_json,
        ".txt":      _load_txt,
        ".csv":      _load_csv_edges,
        ".adjlist":  _load_adjlist,
        ".edgelist": _load_edgelist,
        ".gml": lambda p: nx.read_gml(p),
        ".graphml": lambda p: nx.read_graphml(p),
        ".gexf": lambda p: nx.read_gexf(p),
        ".pajek": lambda p: nx.DiGraph(nx.read_pajek(p)),
        ".net": lambda p: nx.DiGraph(nx.read_pajek(p)),
    }

    if ext not in _loaders:
        raise ValueError(
            f"Unsupported extension {ext!r}. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    return _loaders[ext](path)


# ── Serialisers ──────────────────────────────────────────────────────────────

def _to_json(g: nx.DiGraph) -> str:
    """NetworkX node-link JSON (round-trips cleanly back through load())."""
    return json.dumps(nx.node_link_data(g), indent=2, default=str)


def _to_csv(g: nx.DiGraph) -> str:
    """
    Edge-list CSV with columns: source, target, <edge attributes...>

    Node-only graphs (no edges) fall back to a node-list CSV:
    id, <node attributes...>
    """
    buf = io.StringIO()

    edges = list(g.edges(data=True))
    if edges:
        # Collect all edge attribute keys across the whole graph
        attr_keys = sorted({k for _, _, d in edges for k in d})
        writer = csv.DictWriter(
            buf,
            fieldnames=["source", "target"] + attr_keys,
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        for u, v, data in edges:
            writer.writerow({"source": u, "target": v, **data})
    else:
        # Node-only fallback
        nodes = list(g.nodes(data=True))
        attr_keys = sorted({k for _, d in nodes for k in d})
        writer = csv.DictWriter(
            buf,
            fieldnames=["id"] + attr_keys,
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        for node, data in nodes:
            writer.writerow({"id": node, **data})

    return buf.getvalue()


def to_cytoscape(g: nx.DiGraph) -> dict:
    """Convert a NetworkX graph to Cytoscape.js elements JSON (for the frontend)."""
    elements = []
    for node, data in g.nodes(data=True):
        elements.append({"data": {"id": str(node), **_stringify_values(data)}})
    for u, v, data in g.edges(data=True):
        elements.append({"data": {
            "source": str(u), "target": str(v),
            **_stringify_values(data),
        }})
    return {"elements": elements}


# ── Private loaders ───────────────────────────────────────────────────────────

def _load_xes(path: pathlib.Path) -> nx.DiGraph:
    """
    Build a directly-follows graph from an XES event log using stdlib only.

    Why not pm4py.read_xes()
    ────────────────────────
    Recent pm4py versions route read_xes() through an internal REST/JSON
    service.  When that service is unavailable it returns an HTML error page
    and pm4py raises: "Unexpected token '<', '<!doctype' is not valid JSON".
    We avoid pm4py entirely and stream-parse the XML with iterparse, which
    is robust, has no network dependency, and handles 70 MB+ files without
    loading the whole tree into memory.

    DFG construction
    ────────────────
    For each trace we extract the sequence of concept:name values, then
    count every consecutive (activity_i → activity_{i+1}) pair.
    start/end sentinel nodes (▶ / ■) record trace boundaries if needed.
    """
    import xml.etree.ElementTree as ET

    XES_NS = "http://www.xes-standard.org/"
    TAG_LOG = f"{{{XES_NS}}}log"
    TAG_TRACE = f"{{{XES_NS}}}trace"
    TAG_EVENT = f"{{{XES_NS}}}event"
    TAG_STR = f"{{{XES_NS}}}string"

    dfg: dict[tuple[str, str], int] = {}

    for _, elem in ET.iterparse(str(path), events=("end",)):
        if elem.tag != TAG_TRACE:
            continue

        # Collect activity names in order
        activities: list[str] = []
        for event in elem.findall(TAG_EVENT):
            for s in event.findall(TAG_STR):
                if s.get("key") == "concept:name":
                    activities.append(s.get("value", "?"))
                    break

        # Count consecutive pairs
        for a, b in zip(activities, activities[1:]):
            dfg[(a, b)] = dfg.get((a, b), 0) + 1

        elem.clear()   # free memory immediately after each trace

    g = nx.DiGraph()
    for (src, tgt), freq in dfg.items():
        g.add_edge(src, tgt, weight=freq)
    return g


def _load_yaml(path: pathlib.Path) -> nx.DiGraph:
    """
    Accepts all common YAML graph representations:

    1. {nodes, edges} schema (single- or multi-document):
         nodes: [{id: a, label: A}, ...]
         edges: [{source: a, target: b, weight: 1}, ...]

    2. Adjacency dict — values are lists of neighbour names:
         A: [B, C]
         B: [C]

    3. Weighted adjacency dict — values are dicts of {neighbour: weight}:
         A: {B: 1.0, C: 2.5}
         B: {C: 1.0}

    4. Bare edge-mapping list:
         - {source: a, target: b, weight: 1}

    5. Bare edge-pair list (2-element sequences):
         - [a, b]
         - [b, c]

    6. Bare node list (must have an "id" key):
         - {id: a, label: A}

    Multi-document YAML (--- separators) is handled transparently:
    all documents are collected with safe_load_all and merged before
    dispatch, so "expected a single document" is never raised.
    """
    with open(path, encoding="utf-8") as f:
        raw = f.read()

    # safe_load_all yields lazily — no "single document" error
    docs = [d for d in yaml.safe_load_all(raw) if d is not None]

    if not docs:
        return nx.DiGraph()

    # Merge multiple documents
    if len(docs) == 1:
        data = docs[0]
    elif all(isinstance(d, dict) for d in docs):
        data: dict = {}
        for d in docs:
            for k, v in d.items():
                if k in data and isinstance(data[k], list) and isinstance(v, list):
                    data[k] = data[k] + v
                else:
                    data[k] = v
    elif all(isinstance(d, list) for d in docs):
        data = [item for d in docs for item in d]
    else:
        data = [item for d in docs
                for item in (d if isinstance(d, list) else [d])]

    g = nx.DiGraph()

    # ── Layout 1: {nodes: [...], edges: [...]} ──────────────────────
    if isinstance(data, dict) and ("nodes" in data or "edges" in data):
        for n in data.get("nodes", []):
            n = dict(n)
            nid = n.pop("id")
            g.add_node(nid, **n)
        for e in data.get("edges", []):
            e = dict(e)
            src = e.pop("source")
            tgt = e.pop("target")
            g.add_edge(src, tgt, **e)
        return g

    # ── Layout 2: adjacency dict with list values  {A: [B, C], ...} ─
    if isinstance(data, dict) and all(isinstance(v, (list, type(None)))
                                      for v in data.values()):
        for src, neighbours in data.items():
            g.add_node(str(src))
            for tgt in (neighbours or []):
                g.add_edge(str(src), str(tgt))
        return g

    # ── Layout 3: weighted adjacency dict  {A: {B: 1.0, C: 2.5}} ───
    if isinstance(data, dict) and all(isinstance(v, (dict, type(None)))
                                      for v in data.values()):
        for src, neighbours in data.items():
            g.add_node(str(src))
            for tgt, weight in (neighbours or {}).items():
                g.add_edge(str(src), str(tgt), weight=weight)
        return g

    # ── Layouts 4 / 5 / 6: bare sequence ────────────────────────────
    if isinstance(data, list) and data:
        first = data[0]

        # Layout 4: list of edge mappings  [{source: a, target: b}, ...]
        if isinstance(first, dict) and "source" in first and "target" in first:
            for e in data:
                e = dict(e)
                src = e.pop("source")
                tgt = e.pop("target")
                g.add_edge(str(src), str(tgt), **e)
            return g

        # Layout 5: list of edge pairs  [[a, b], [b, c], ...]
        if isinstance(first, (list, tuple)) and len(first) >= 2:
            for pair in data:
                attrs = {"weight": pair[2]} if len(pair) > 2 else {}
                g.add_edge(str(pair[0]), str(pair[1]), **attrs)
            return g

        # Layout 6: list of node dicts  [{id: a, label: A}, ...]
        if isinstance(first, dict) and "id" in first:
            for n in data:
                n = dict(n)
                nid = n.pop("id")
                g.add_node(str(nid), **n)
            return g

        raise ValueError(
            f"YAML list items in {path.name!r} were not recognised.\n"
            "Expected one of:\n"
            "  • edge mappings: [{source: a, target: b}, ...]\n"
            "  • edge pairs:    [[a, b], [b, c], ...]\n"
            "  • node dicts:    [{id: a, label: A}, ...]"
        )

    raise ValueError(
        f"Unrecognised YAML structure in {path.name!r}.\n"
        "Supported layouts: {nodes/edges}, adjacency dict, "
        "weighted adjacency dict, edge-mapping list, edge-pair list, node list."
    )


def _load_json(path: pathlib.Path) -> nx.DiGraph:
    """
    Auto-detect and load any of these common JSON graph formats:

    1. NetworkX node-link  {"directed":…, "nodes":[…], "edges":[…]}
    2. D3 force-graph      {"nodes":[…], "links":[…]}
    3. Adjacency dict      {"A": ["B","C"], …}  or  {"A": {"B": 1.0}, …}
    4. Cytoscape wrapped   {"elements": […]}
    5. Flat edge list      [{"source":…,"target":…}, …]
    6. Cytoscape list      [{"data":{"id":…}}, {"data":{"source":…,"target":…}}, …]
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    g = nx.DiGraph()

    # ── 1. NetworkX node-link ────────────────────────────────────────
    if isinstance(data, dict) and "multigraph" in data:
        return nx.node_link_graph(data, directed=True)

    # ── 2. D3 force-graph  {"nodes": [...], "links": [...]} ─────────
    if isinstance(data, dict) and "links" in data:
        for n in data.get("nodes", []):
            nid = n.get("id", n.get("name", str(n)))
            g.add_node(str(nid), **{k: v for k,
                       v in n.items() if k not in {"id", "name"}})
        for e in data["links"]:
            src = e.get("source")
            tgt = e.get("target")
            attrs = {k: v for k, v in e.items() if k not in {
                "source", "target"}}
            if "value" in attrs:                   # D3 convention: value → weight
                attrs["weight"] = attrs.pop("value")
            g.add_edge(str(src), str(tgt), **attrs)
        return g

    # ── 3. Adjacency dict ────────────────────────────────────────────
    if isinstance(data, dict) and all(
        isinstance(v, (list, dict, type(None))) for v in data.values()
    ) and not any(k in data for k in ("nodes", "edges", "elements")):
        for src, neighbours in data.items():
            g.add_node(str(src))
            if isinstance(neighbours, list):
                for tgt in (neighbours or []):
                    g.add_edge(str(src), str(tgt))
            elif isinstance(neighbours, dict):
                for tgt, weight in (neighbours or {}).items():
                    g.add_edge(str(src), str(tgt), weight=weight)
        return g

    # ── 4. Cytoscape wrapped  {"elements": [...]} ───────────────────
    if isinstance(data, dict) and "elements" in data:
        elements = data["elements"]
        if isinstance(elements, dict):          # {"nodes":[…],"edges":[…]}
            elements = elements.get("nodes", []) + elements.get("edges", [])
        return _parse_cytoscape_elements(elements, g)

    # ── 5 & 6. Top-level list ────────────────────────────────────────
    if isinstance(data, list):
        if not data:
            return g
        first = data[0]
        # Cytoscape element objects have a "data" wrapper
        if isinstance(first, dict) and "data" in first:
            return _parse_cytoscape_elements(data, g)
        # Flat edge list  [{"source":…, "target":…}, …]
        if isinstance(first, dict) and "source" in first and "target" in first:
            for e in data:
                attrs = {k: v for k, v in e.items() if k not in {
                    "source", "target"}}
                g.add_edge(str(e["source"]), str(e["target"]), **attrs)
            return g

    raise ValueError(
        f"Unrecognised JSON structure in {path.name!r}.\n"
        "Supported: NetworkX node-link, D3 force-graph, adjacency dict, "
        "Cytoscape elements, flat edge list."
    )


def _parse_cytoscape_elements(elements: list, g: nx.DiGraph) -> nx.DiGraph:
    """Shared helper for Cytoscape element lists (wrapped or bare)."""
    for el in elements:
        d = el.get("data", {})
        if "source" in d and "target" in d:
            attrs = {k: v for k, v in d.items() if k not in {
                "source", "target", "id"}}
            g.add_edge(str(d["source"]), str(d["target"]), **attrs)
        elif "id" in d:
            g.add_node(str(d["id"]), **{k: v for k,
                       v in d.items() if k != "id"})
    return g


def _load_txt(path: pathlib.Path) -> nx.DiGraph:
    """
    Auto-detect between adjacency list and edge list by inspecting the
    first non-comment, non-empty line.

    Adjacency list line:  "a b c d"   (node + neighbours, ≥1 token per line)
    Edge list line:       "a b 0.5"   (exactly source + target [+ weight])

    Heuristic: if the first data line has ≤ 3 tokens we treat it as an
    edge list; otherwise as an adjacency list.
    """
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            tokens = line.split()
            if len(tokens) <= 3:
                return _load_edgelist(path)
            else:
                return _load_adjlist(path)
    # Empty file → return empty graph
    return nx.DiGraph()


def _load_csv_edges(path: pathlib.Path) -> nx.DiGraph:
    """
    Edge-list CSV.  The first two columns must be source and target.
    Any further columns become edge attributes.
    The header row is optional; if absent the columns are named
    "source", "target", "attr_2", "attr_3", ...
    """
    g = nx.DiGraph()
    with open(path, newline="", encoding="utf-8") as f:
        sample = f.read(1024)
        f.seek(0)
        has_header = csv.Sniffer().has_header(sample)
        reader = csv.reader(f)

        if has_header:
            headers = next(reader)
        else:
            headers = None

        for row in reader:
            if not row:
                continue
            src, tgt = row[0], row[1]
            if headers:
                attrs = {headers[i]: row[i]
                         for i in range(2, len(row)) if i < len(headers)}
            else:
                attrs = {f"attr_{i}": row[i] for i in range(2, len(row))}
            g.add_edge(src, tgt, **attrs)

    return g


def _load_adjlist(path: pathlib.Path) -> nx.DiGraph:
    return nx.read_adjlist(path, create_using=nx.DiGraph)


def _load_edgelist(path: pathlib.Path) -> nx.DiGraph:
    return nx.read_weighted_edgelist(path, create_using=nx.DiGraph)


# ── Utility ──────────────────────────────────────────────────────────────────

def _stringify_values(d: dict) -> dict:
    """Coerce non-JSON-serialisable values to str (e.g. Timestamps)."""
    return {k: v if isinstance(v, (str, int, float, bool, type(None))) else str(v)
            for k, v in d.items()}
