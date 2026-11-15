"""
Graph Loader
============
Loads graphs from 10 formats and auto-converts to JSON or CSV.

AUTO-CONVERT CONDITION — edit this to change the threshold:
    if edge_count < SMALL_GRAPH_THRESHOLD  →  export as JSON
    else                                    →  export as CSV
"""

import json
import csv
import io
import os
import yaml
import networkx as nx
import pandas as pd
from pathlib import Path
try:
    from pm4py.objects.log.importer.xes import importer as xes_importer
    from pm4py.objects.conversion.log import converter as log_converter
    PM4PY_AVAILABLE = True
except ImportError:
    PM4PY_AVAILABLE = False

# ─────────────────────────────────────────────────────────────
# MODIFIABLE CONDITION: change this value to adjust the threshold
# ─────────────────────────────────────────────────────────────
SMALL_GRAPH_THRESHOLD = 250  # edges; below → JSON, at/above → CSV

# Supported extensions → loader key
EXTENSION_MAP = {
    ".xes":      "xes",
    ".yaml":     "yaml",
    ".yml":      "yaml",
    ".json":     "json",
    ".txt":      "edgelist",   # plain text assumed to be edge list
    ".csv":      "csv",
    ".adjlist":  "adjlist",
    ".edgelist": "edgelist",
    ".gml":      "gml",
    ".graphml":  "graphml",
    ".gexf":     "gexf",
    ".net":      "pajek",
    ".paj":      "pajek",
}


class GraphLoader:

    def load(self, filepath: str) -> dict:
        """
        Load a graph file and return a normalised dict:
        {
            "graph":   nx.DiGraph | nx.Graph,
            "log":     pm4py EventLog | None,
            "source_format": str,
            "export_format": "json" | "csv",
            "export_data": str   # JSON string or CSV string
        }
        """
        path = Path(filepath)
        ext  = path.suffix.lower()
        fmt  = EXTENSION_MAP.get(ext)
        if fmt is None:
            raise ValueError(f"Unsupported extension: {ext}. "
                             f"Supported: {list(EXTENSION_MAP)}")

        loader = getattr(self, f"_load_{fmt}")
        G, log = loader(filepath)

        edge_count    = G.number_of_edges()
        export_format = "json" if edge_count < SMALL_GRAPH_THRESHOLD else "csv"
        export_data   = self._to_json(G) if export_format == "json" \
                        else self._to_csv(G)

        return {
            "graph":         G,
            "log":           log,
            "source_format": fmt,
            "export_format": export_format,
            "export_data":   export_data,
        }

    # ── individual loaders ──────────────────────────────────

    def _load_xes(self, path):
        if not PM4PY_AVAILABLE:
            raise ImportError("pm4py is not installed. Run: pip install pm4py")
        import pm4py

        log = None
        last_err = None

        # Strategy 1: pm4py 3.x public API — returns a DataFrame directly
        try:
            log = pm4py.read_xes(path)
        except Exception as e:
            last_err = e

        # Strategy 2: pm4py 3.x with legacy EventLog object (needed by some miners)
        if log is None:
            try:
                log = pm4py.read_xes(path, return_legacy_log_object=True)
            except Exception as e:
                last_err = e

        # Strategy 3: low-level importer (pm4py 2.x)
        if log is None:
            try:
                log = xes_importer.apply(path)
            except Exception as e:
                last_err = e

        if log is None:
            raise ValueError(f"Could not parse XES file: {last_err}")

        # Convert to DataFrame for graph building
        df = None
        try:
            df = pm4py.convert_to_dataframe(log)
        except Exception:
            pass

        if df is None and log_converter is not None:
            try:
                df = log_converter.apply(log, variant=log_converter.Variants.TO_DATA_FRAME)
            except Exception:
                pass

        if df is None:
            # log may already be a DataFrame
            import pandas as pd
            if isinstance(log, pd.DataFrame):
                df = log
            else:
                raise ValueError("Could not convert XES EventLog to DataFrame.")

        G = self._df_to_graph(df)
        return G, log

    def _load_yaml(self, path):
        with open(path) as f:
            data = yaml.safe_load(f)
        G = self._dict_to_graph(data)
        return G, None

    def _load_json(self, path):
        with open(path) as f:
            data = json.load(f)
        # Support node-link format (networkx default) or {nodes, edges}
        if "links" in data or "edges" in data:
            G = nx.node_link_graph(data) if "links" in data \
                else self._dict_to_graph(data)
        else:
            G = self._dict_to_graph(data)
        return G, None

    def _load_csv(self, path):
        df = pd.read_csv(path)
        if "source" not in df.columns or "target" not in df.columns:
            raise ValueError("CSV must have 'source' and 'target' columns.")
        extra = [c for c in df.columns if c not in ("source", "target")]
        # nx.from_pandas_edgelist crashes with edge_attr=True when there are
        # no extra columns — only pass edge_attr when columns actually exist
        edge_attr = extra if extra else None
        G = nx.from_pandas_edgelist(df, source="source", target="target",
                                    edge_attr=edge_attr,
                                    create_using=nx.DiGraph())
        return G, None

    def _load_edgelist(self, path):
        G = nx.read_edgelist(path, create_using=nx.DiGraph())
        return G, None

    def _load_adjlist(self, path):
        G = nx.read_adjlist(path, create_using=nx.DiGraph())
        return G, None

    def _load_gml(self, path):
        G = nx.read_gml(path)
        return nx.DiGraph(G), None

    def _load_graphml(self, path):
        G = nx.read_graphml(path)
        return nx.DiGraph(G), None

    def _load_gexf(self, path):
        G = nx.read_gexf(path)
        return nx.DiGraph(G), None

    def _load_pajek(self, path):
        G = nx.read_pajek(path)
        return nx.DiGraph(G), None

    # ── helpers ─────────────────────────────────────────────

    def _dict_to_graph(self, data: dict) -> nx.DiGraph:
        """Convert {nodes: [...], edges: [...]} dict to DiGraph."""
        G = nx.DiGraph()
        nodes = data.get("nodes", [])
        edges = data.get("edges", data.get("links", []))
        for n in nodes:
            if isinstance(n, dict):
                G.add_node(n.get("id", n.get("name")), **{k: v for k, v in n.items()
                           if k not in ("id", "name")})
            else:
                G.add_node(n)
        for e in edges:
            if isinstance(e, dict):
                G.add_edge(e["source"], e["target"],
                           **{k: v for k, v in e.items()
                              if k not in ("source", "target")})
            elif len(e) >= 2:
                G.add_edge(e[0], e[1])
        return G

    def _df_to_graph(self, df: pd.DataFrame) -> nx.DiGraph:
        """
        Build a DFG-style graph from a pm4py DataFrame.
        Tolerates both 'concept:name'/'case:concept:name' and
        simplified 'activity'/'case:id' column names.
        """
        # Normalise column names across pm4py versions
        act_col  = next((c for c in ["concept:name", "activity", "Activity"]
                         if c in df.columns), None)
        case_col = next((c for c in ["case:concept:name", "case:id", "case_id", "Case ID"]
                         if c in df.columns), None)
        ts_col   = next((c for c in ["time:timestamp", "timestamp", "Timestamp"]
                         if c in df.columns), None)

        if act_col is None or case_col is None:
            # Cannot build a DFG; return an empty graph rather than crashing
            return nx.DiGraph()

        if ts_col:
            try:
                df = df.sort_values([case_col, ts_col])
            except Exception:
                pass

        G = nx.DiGraph()
        for _case_id, group in df.groupby(case_col):
            acts = group[act_col].tolist()
            for a, b in zip(acts, acts[1:]):
                if G.has_edge(a, b):
                    G[a][b]["frequency"] = G[a][b].get("frequency", 1) + 1
                else:
                    G.add_edge(a, b, frequency=1)
        return G

    def _to_json(self, G: nx.DiGraph) -> str:
        return json.dumps(nx.node_link_data(G), indent=2)

    def _to_csv(self, G: nx.DiGraph) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["source", "target"] +
                        list(next(iter(G.edges(data=True)), (None, None, {}))[2].keys()))
        for u, v, data in G.edges(data=True):
            writer.writerow([u, v] + list(data.values()))
        return buf.getvalue()
