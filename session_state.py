"""
session_state.py
================
Single source of truth for in-memory session state.
Imported by both graph_routes and upload_routes so they
share the SAME dict object (no circular import).

Replace with Redis / SQLAlchemy for multi-worker deployments.
"""

state = {
    "graph":         None,   # nx.DiGraph currently loaded
    "log":           None,   # pm4py EventLog (only from .xes)
    "last_svg":      None,   # base64 SVG from last discovery
    "export_data":   None,   # JSON or CSV string
    "export_format": None,   # "json" | "csv"
    "filepath":      None,   # absolute path to the uploaded file
}


def set_graph_state(graph, log, export_data, export_format, filepath=None):
    state["graph"]         = graph
    state["log"]           = log
    state["export_data"]   = export_data
    state["export_format"] = export_format
    state["last_svg"]      = None
    state["filepath"]      = filepath
