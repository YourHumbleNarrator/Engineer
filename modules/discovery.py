"""
Discovery Module
================
Produces DFG, Petri Net, Process Tree and BPMN models from a pm4py EventLog.
Falls back gracefully when no EventLog is available (uses raw NetworkX graph).

Miners:
  - Alpha Miner  (Petri Net)
  - Inductive Miner (Process Tree → Petri Net)
  - BPMN Miner (via pm4py)
"""

import base64
import io
import tempfile
import os
from typing import Optional

import networkx as nx

# pm4py imports — each guarded so missing sub-packages don't crash the app
try:
    from pm4py.algo.discovery.alpha import algorithm as alpha_miner
    from pm4py.algo.discovery.inductive import algorithm as inductive_miner
    from pm4py.objects.conversion.process_tree import converter as pt_converter
    from pm4py.objects.conversion.bpmn import converter as bpmn_converter
    from pm4py.visualization.petri_net import visualizer as pn_viz
    from pm4py.visualization.process_tree import visualizer as pt_viz
    from pm4py.visualization.bpmn import visualizer as bpmn_viz
    from pm4py.visualization.dfg import visualizer as dfg_viz
    from pm4py.algo.discovery.dfg import algorithm as dfg_algorithm
    PM4PY_AVAILABLE = True
except ImportError:
    PM4PY_AVAILABLE = False


class DiscoveryEngine:

    # ── public API ──────────────────────────────────────────

    def discover(self, log, graph_type: str, miner: str = "alpha") -> dict:
        """
        Parameters
        ----------
        log        : pm4py EventLog  (None → stub mode from NetworkX)
        graph_type : "dfg" | "petri_net" | "process_tree" | "bpmn"
        miner      : "alpha" | "inductive"

        Returns
        -------
        {
          "svg":   base64-encoded SVG string,
          "model": serialisable dict describing the model,
          "type":  graph_type,
        }
        """
        if not PM4PY_AVAILABLE:
            return self._stub(graph_type, "pm4py not installed — run: pip install pm4py")
        if log is None:
            return self._stub(graph_type, "No EventLog — load a .xes file for discovery")

        # pm4py ≥3.x read_xes() returns a DataFrame; mining functions need an EventLog
        log = self._ensure_event_log(log)

        handlers = {
            "dfg":          self._dfg,
            "petri_net":    self._petri_net,
            "process_tree": self._process_tree,
            "bpmn":         self._bpmn,
        }
        handler = handlers.get(graph_type)
        if handler is None:
            return self._stub(graph_type, f"Unknown graph type: {graph_type}")

        try:
            return handler(log, miner)
        except Exception as e:
            return self._stub(graph_type, f"Discovery error ({type(e).__name__}): {e}")

    # ── DFG ─────────────────────────────────────────────────

    def _dfg(self, log, miner):
        import pm4py

        # pm4py public API — stable across 2.x and 3.x
        dfg, start, end = pm4py.discover_dfg(log)

        # Visualiser parameters differ slightly across versions; try both
        try:
            params = {dfg_viz.Variants.FREQUENCY.value.Parameters.FORMAT: "svg"}
            gviz = dfg_viz.apply(dfg, log=log, parameters=params)
        except Exception:
            gviz = dfg_viz.apply(dfg, log=log,
                                 parameters={"format": "svg"})

        svg = self._gviz_to_b64(gviz)
        model = {
            "edges": [{"source": a, "target": b, "freq": c}
                      for (a, b), c in dfg.items()],
            "start": {k: int(v) for k, v in start.items()},
            "end":   {k: int(v) for k, v in end.items()},
        }
        return {"svg": svg, "model": model, "type": "dfg"}

    # ── Petri Net ───────────────────────────────────────────

    def _petri_net(self, log, miner):
        import pm4py

        if miner == "alpha":
            net, im, fm = pm4py.discover_petri_net_alpha(log)
        else:
            net, im, fm = pm4py.discover_petri_net_inductive(log)

        try:
            params = {
                pn_viz.Variants.WO_DECORATION.value.Parameters.FORMAT: "svg"}
            gviz = pn_viz.apply(net, im, fm, parameters=params)
        except Exception:
            gviz = pn_viz.apply(net, im, fm, parameters={"format": "svg"})

        svg = self._gviz_to_b64(gviz)
        model = self._petri_net_to_dict(net, im, fm)
        return {"svg": svg, "model": model, "type": "petri_net", "miner": miner}

    # ── Process Tree ────────────────────────────────────────

    def _process_tree(self, log, miner):
        import pm4py

        tree = pm4py.discover_process_tree_inductive(log)

        try:
            params = {
                pt_viz.Variants.WO_DECORATION.value.Parameters.FORMAT: "svg"}
            gviz = pt_viz.apply(tree, parameters=params)
        except Exception:
            gviz = pt_viz.apply(tree, parameters={"format": "svg"})

        svg = self._gviz_to_b64(gviz)
        model = {"tree": str(tree)}
        return {"svg": svg, "model": model, "type": "process_tree"}

    # ── BPMN ────────────────────────────────────────────────

    def _bpmn(self, log, miner):
        import pm4py

        bpmn = pm4py.discover_bpmn_inductive(log)

        try:
            params = {bpmn_viz.Variants.CLASSIC.value.Parameters.FORMAT: "svg"}
            gviz = bpmn_viz.apply(bpmn, parameters=params)
        except Exception:
            gviz = bpmn_viz.apply(bpmn, parameters={"format": "svg"})

        svg = self._gviz_to_b64(gviz)
        model = self._bpmn_to_dict(bpmn)
        return {"svg": svg, "model": model, "type": "bpmn"}

    # ── helpers ─────────────────────────────────────────────

    def _gviz_to_b64(self, gviz) -> str:
        """Render Graphviz object to SVG and return as base64 string."""
        with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as f:
            tmp = f.name
        try:
            gviz.render(tmp, cleanup=True)
            svg_path = tmp + ".svg" if not tmp.endswith(".svg") else tmp
            # pm4py saves as <tmp> directly when format=svg
            candidates = [tmp, tmp + ".svg", tmp.replace(".svg", "") + ".svg"]
            for c in candidates:
                if os.path.exists(c):
                    with open(c, "rb") as f:
                        return base64.b64encode(f.read()).decode()
        finally:
            for c in [tmp, tmp + ".svg"]:
                if os.path.exists(c):
                    os.unlink(c)
        return ""

    def _petri_net_to_dict(self, net, im, fm) -> dict:
        places = [{"id": str(p), "name": p.name} for p in net.places]
        transitions = [{"id": str(t), "label": t.label}
                       for t in net.transitions]
        arcs = [{"source": str(a.source), "target": str(a.target)}
                for a in net.arcs]
        return {"places": places, "transitions": transitions, "arcs": arcs,
                "initial_marking": {str(p): c for p, c in im.items()},
                "final_marking":   {str(p): c for p, c in fm.items()}}

    def _bpmn_to_dict(self, bpmn) -> dict:
        nodes = [{"id": str(n), "type": type(n).__name__,
                  "name": getattr(n, "name", "")} for n in bpmn.get_nodes()]
        flows = [{"source": str(f.get_source()), "target": str(f.get_target())}
                 for f in bpmn.get_flows()]
        return {"nodes": nodes, "flows": flows}

    def _ensure_event_log(self, log):
        """
        pm4py ≥3.x returns a DataFrame from read_xes().
        Alpha/inductive miners need an EventLog object.
        Convert if necessary.
        """
        import pandas as pd
        if isinstance(log, pd.DataFrame):
            try:
                import pm4py
                return pm4py.convert_to_event_log(log)
            except Exception:
                try:
                    from pm4py.objects.conversion.log import converter as lc
                    return lc.apply(log)
                except Exception:
                    return log   # pass it through; miner will raise a clear error
        return log

    def _stub(self, graph_type: str, reason: str) -> dict:
        return {
            "svg":    "",
            "model":  {},
            "type":   graph_type,
            "stub":   True,
            "reason": reason,
        }
