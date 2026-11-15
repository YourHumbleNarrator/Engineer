"""
Graph Stats & Tabular Display
==============================
Computes basic graph metrics and generates tabular representations.
"""

import math
import networkx as nx
from typing import Union


class GraphStats:

    def compute(self, G: Union[nx.Graph, nx.DiGraph]) -> dict:
        """
        Returns a dict of basic graph statistics.
        """
        n = G.number_of_nodes()
        e = G.number_of_edges()

        if n == 0:
            return {"nodes": 0, "edges": 0, "density": 0,
                    "avg_degree": 0, "is_directed": G.is_directed(),
                    "is_dag": False, "components": 0,
                    "avg_clustering": 0, "diameter": None}

        density = nx.density(G)

        # Degree (use in-degree + out-degree for directed)
        if G.is_directed():
            degrees = [d for _, d in G.degree()]
        else:
            degrees = [d for _, d in G.degree()]
        avg_degree = sum(degrees) / n if n else 0

        is_dag = nx.is_directed_acyclic_graph(G) if G.is_directed() else False

        # Connected components
        try:
            if G.is_directed():
                components = nx.number_weakly_connected_components(G)
            else:
                components = nx.number_connected_components(G)
        except Exception:
            components = None

        # Clustering (skip for large graphs)
        try:
            avg_clustering = nx.average_clustering(G) if n <= 5000 else None
        except Exception:
            avg_clustering = None

        # Diameter (only for connected, skip large)
        diameter = None
        if n <= 1000:
            try:
                ug = G.to_undirected()
                if nx.is_connected(ug):
                    diameter = nx.diameter(ug)
            except Exception:
                pass

        return {
            "nodes":           n,
            "edges":           e,
            "density":         round(density, 4),
            "avg_degree":      round(avg_degree, 2),
            "max_degree":      max(degrees) if degrees else 0,
            "min_degree":      min(degrees) if degrees else 0,
            "is_directed":     G.is_directed(),
            "is_dag":          is_dag,
            "components":      components,
            "avg_clustering":  round(avg_clustering, 4) if avg_clustering is not None else None,
            "diameter":        diameter,
            "self_loops":      nx.number_of_selfloops(G),
        }

    def to_node_table(self, G: nx.Graph) -> dict:
        """
        Returns node table as {columns: [...], rows: [...]}.
        Collects all node attribute keys dynamically.
        """
        attr_keys = set()
        for _, data in G.nodes(data=True):
            attr_keys.update(data.keys())
        attr_keys = sorted(attr_keys)

        columns = ["id", "degree"] + (["in_degree", "out_degree"] if G.is_directed() else []) + attr_keys
        rows = []
        for node, data in G.nodes(data=True):
            row = {
                "id":     str(node),
                "degree": G.degree(node),
            }
            if G.is_directed():
                row["in_degree"]  = G.in_degree(node)
                row["out_degree"] = G.out_degree(node)
            for k in attr_keys:
                row[k] = data.get(k, "")
            rows.append(row)

        return {"columns": columns, "rows": rows}

    def to_edge_table(self, G: nx.Graph) -> dict:
        """
        Returns edge table as {columns: [...], rows: [...]}.
        """
        attr_keys = set()
        for _, _, data in G.edges(data=True):
            attr_keys.update(data.keys())
        attr_keys = sorted(attr_keys)

        columns = ["source", "target"] + attr_keys
        rows = []
        for u, v, data in G.edges(data=True):
            row = {"source": str(u), "target": str(v)}
            for k in attr_keys:
                row[k] = data.get(k, "")
            rows.append(row)

        return {"columns": columns, "rows": rows}
