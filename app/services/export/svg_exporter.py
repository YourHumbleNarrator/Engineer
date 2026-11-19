"""
Export graph JSON to SVG using matplotlib + networkx.
Supports all four graph kinds: dfg, petri_net, process_tree, bpmn.
"""
import io
from typing import Any, Dict

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import networkx as nx


def export_graph_to_svg(
    graph_json: Dict[str, Any],
    width: int = 1200,
    height: int = 800,
    theme: str = "light",
) -> str:
    """
    Render a graph JSON dict to an SVG string.

    Args:
        graph_json: A dict matching one of DFGGraph, PetriNetGraph,
                    ProcessTreeGraph, or BPMNGraph schemas.
        width: Output width in pixels (converted to inches at 100 dpi).
        height: Output height in pixels.
        theme: "light" or "dark".

    Returns:
        SVG string.
    """
    kind = graph_json.get("kind", "dfg")
    bg = "white" if theme == "light" else "#1e1e2e"
    fg = "black" if theme == "light" else "#cdd6f4"
    node_color = "#4A90D9" if theme == "light" else "#89b4fa"
    edge_color = "#555555" if theme == "light" else "#6c7086"

    fig, ax = plt.subplots(figsize=(width / 100, height / 100))
    fig.patch.set_facecolor(bg)
    ax.set_facecolor(bg)

    if kind == "dfg":
        _draw_dfg(ax, graph_json, fg, node_color, edge_color)
    elif kind == "petri_net":
        _draw_petri_net(ax, graph_json, fg, node_color, edge_color)
    elif kind == "process_tree":
        _draw_process_tree(ax, graph_json, fg, node_color, edge_color)
    elif kind == "bpmn":
        _draw_bpmn(ax, graph_json, fg, node_color, edge_color)
    else:
        ax.text(0.5, 0.5, f"Unknown graph kind: {kind}", ha="center", va="center", color=fg)

    ax.axis("off")
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", facecolor=bg)
    plt.close(fig)
    buf.seek(0)
    return buf.read().decode("utf-8")


# ── DFG ───────────────────────────────────────────────────────────────────────

def _draw_dfg(ax, graph: dict, fg: str, node_color: str, edge_color: str):
    G = nx.DiGraph()
    activities = {a["id"]: a["label"] for a in graph.get("activities", [])}
    for act in graph.get("activities", []):
        G.add_node(act["id"], label=act["label"], count=act.get("count", 0))
    for edge in graph.get("edges", []):
        G.add_edge(edge["source"], edge["target"], count=edge.get("count", 1))

    if len(G.nodes) == 0:
        ax.text(0.5, 0.5, "Empty DFG", ha="center", va="center", color=fg)
        return

    pos = nx.spring_layout(G, seed=42, k=2.0)
    labels = {n: data.get("label", n) for n, data in G.nodes(data=True)}
    edge_labels = {(u, v): d["count"] for u, v, d in G.edges(data=True)}

    # Highlight start/end activities
    start_ids = set(graph.get("startActivities", {}).keys())
    end_ids = set(graph.get("endActivities", {}).keys())
    node_colors = []
    for n in G.nodes():
        if n in start_ids:
            node_colors.append("#2ecc71" if fg == "black" else "#a6e3a1")
        elif n in end_ids:
            node_colors.append("#e74c3c" if fg == "black" else "#f38ba8")
        else:
            node_colors.append(node_color)

    nx.draw_networkx_nodes(G, pos, ax=ax, node_color=node_colors, node_size=1200, alpha=0.9)
    nx.draw_networkx_labels(G, pos, labels, ax=ax, font_size=7, font_color=fg)
    nx.draw_networkx_edges(
        G, pos, ax=ax, edge_color=edge_color, arrows=True,
        arrowsize=15, connectionstyle="arc3,rad=0.1", width=1.5,
    )
    nx.draw_networkx_edge_labels(G, pos, edge_labels, ax=ax, font_size=6, font_color=fg)

    legend_patches = [
        mpatches.Patch(color="#2ecc71" if fg == "black" else "#a6e3a1", label="Start"),
        mpatches.Patch(color="#e74c3c" if fg == "black" else "#f38ba8", label="End"),
        mpatches.Patch(color=node_color, label="Activity"),
    ]
    ax.legend(handles=legend_patches, loc="upper left", fontsize=7, facecolor="none",
              labelcolor=fg, edgecolor=fg)
    ax.set_title(graph.get("name", "DFG"), color=fg, fontsize=10, pad=10)


# ── Petri Net ─────────────────────────────────────────────────────────────────

def _draw_petri_net(ax, graph: dict, fg: str, node_color: str, edge_color: str):
    G = nx.DiGraph()
    places = {p["id"]: p for p in graph.get("places", [])}
    transitions = {t["id"]: t for t in graph.get("transitions", [])}

    for pid, p in places.items():
        G.add_node(pid, kind="place", label=p.get("label", pid))
    for tid, t in transitions.items():
        label = t.get("label", "") if not t.get("silent", False) else "τ"
        G.add_node(tid, kind="transition", label=label)
    for arc in graph.get("arcs", []):
        G.add_edge(arc["source"], arc["target"])

    if len(G.nodes) == 0:
        ax.text(0.5, 0.5, "Empty Petri Net", ha="center", va="center", color=fg)
        return

    pos = nx.spring_layout(G, seed=42, k=2.0)
    place_nodes = [n for n, d in G.nodes(data=True) if d.get("kind") == "place"]
    trans_nodes = [n for n, d in G.nodes(data=True) if d.get("kind") == "transition"]
    labels = {n: d.get("label", n) for n, d in G.nodes(data=True)}

    # Places as circles, transitions as squares (approximated with rectangles)
    nx.draw_networkx_nodes(G, pos, nodelist=place_nodes, ax=ax,
                           node_shape="o", node_color="#3498db", node_size=800, alpha=0.9)
    nx.draw_networkx_nodes(G, pos, nodelist=trans_nodes, ax=ax,
                           node_shape="s", node_color="#e67e22", node_size=800, alpha=0.9)
    nx.draw_networkx_labels(G, pos, labels, ax=ax, font_size=6, font_color=fg)
    nx.draw_networkx_edges(G, pos, ax=ax, edge_color=edge_color, arrows=True, arrowsize=15)

    legend_patches = [
        mpatches.Patch(color="#3498db", label="Place"),
        mpatches.Patch(color="#e67e22", label="Transition"),
    ]
    ax.legend(handles=legend_patches, loc="upper left", fontsize=7, facecolor="none",
              labelcolor=fg, edgecolor=fg)
    ax.set_title(graph.get("name", "Petri Net"), color=fg, fontsize=10, pad=10)


# ── Process Tree ──────────────────────────────────────────────────────────────

def _draw_process_tree(ax, graph: dict, fg: str, node_color: str, edge_color: str):
    G = nx.DiGraph()
    root = graph.get("root")
    if root is None:
        ax.text(0.5, 0.5, "Empty Process Tree", ha="center", va="center", color=fg)
        return

    _add_tree_nodes(G, root)
    if len(G.nodes) == 0:
        return

    # Hierarchical layout using graphviz if available, else spring
    try:
        pos = nx.nx_agraph.graphviz_layout(G, prog="dot")
    except Exception:
        pos = nx.spring_layout(G, seed=42)

    labels = {n: d.get("label", n) for n, d in G.nodes(data=True)}
    op_nodes = [n for n, d in G.nodes(data=True) if d.get("type") == "operator"]
    act_nodes = [n for n, d in G.nodes(data=True) if d.get("type") == "activity"]
    tau_nodes = [n for n, d in G.nodes(data=True) if d.get("type") == "tau"]

    if op_nodes:
        nx.draw_networkx_nodes(G, pos, nodelist=op_nodes, ax=ax,
                               node_color="#9b59b6", node_size=1000, alpha=0.9)
    if act_nodes:
        nx.draw_networkx_nodes(G, pos, nodelist=act_nodes, ax=ax,
                               node_color=node_color, node_size=1000, alpha=0.9)
    if tau_nodes:
        nx.draw_networkx_nodes(G, pos, nodelist=tau_nodes, ax=ax,
                               node_color="#95a5a6", node_size=600, alpha=0.9)

    nx.draw_networkx_labels(G, pos, labels, ax=ax, font_size=6, font_color=fg)
    nx.draw_networkx_edges(G, pos, ax=ax, edge_color=edge_color, arrows=True, arrowsize=12)
    ax.set_title(graph.get("name", "Process Tree"), color=fg, fontsize=10, pad=10)


def _add_tree_nodes(G: nx.DiGraph, node: dict):
    nid = node["id"]
    ntype = node.get("type", "activity")
    if ntype == "operator":
        label = node.get("operator", "?").upper()
    elif ntype == "activity":
        label = node.get("label", nid)
    else:
        label = "τ"
    G.add_node(nid, label=label, type=ntype)
    for child in node.get("children", []):
        G.add_edge(nid, child["id"])
        _add_tree_nodes(G, child)


# ── BPMN ──────────────────────────────────────────────────────────────────────

def _draw_bpmn(ax, graph: dict, fg: str, node_color: str, edge_color: str):
    G = nx.DiGraph()
    type_colors = {
        "startEvent": "#2ecc71",
        "endEvent": "#e74c3c",
        "task": node_color,
        "xorGateway": "#f39c12",
        "andGateway": "#3498db",
        "orGateway": "#9b59b6",
        "intermediateEvent": "#1abc9c",
    }

    for node in graph.get("nodes", []):
        G.add_node(node["id"], label=node.get("label", "") or node["id"],
                   ntype=node.get("type", "task"))
    for edge in graph.get("edges", []):
        G.add_edge(edge["source"], edge["target"])

    if len(G.nodes) == 0:
        ax.text(0.5, 0.5, "Empty BPMN", ha="center", va="center", color=fg)
        return

    pos = nx.spring_layout(G, seed=42, k=2.0)
    labels = {n: d.get("label", n) for n, d in G.nodes(data=True)}
    colors = [type_colors.get(d.get("ntype", "task"), node_color)
              for n, d in G.nodes(data=True)]

    nx.draw_networkx_nodes(G, pos, ax=ax, node_color=colors, node_size=1000, alpha=0.9)
    nx.draw_networkx_labels(G, pos, labels, ax=ax, font_size=6, font_color=fg)
    nx.draw_networkx_edges(G, pos, ax=ax, edge_color=edge_color, arrows=True,
                           arrowsize=15, connectionstyle="arc3,rad=0.05")
    ax.set_title(graph.get("name", "BPMN"), color=fg, fontsize=10, pad=10)
