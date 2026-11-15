"""
Library Benchmarking Module
============================
Catalogue of functions across pm4py, bupaR, bpmn-js and mp4js.
Each entry includes:
  - description
  - category
  - callable flag  (True = we can actually call it here)
  - implementation (Python function or R subprocess call)

FEASIBILITY NOTES:
  pm4py   → fully callable from Python ✅
  bupaR   → callable via R subprocess if R + bupaR are installed ⚠️
  bpmn-js → JS-only browser library; cannot call server-side ❌
            (displayed with descriptions; "native viz" = iframe embed)
  mp4js   → JS-only browser library; same constraint as bpmn-js ❌
"""

import subprocess
import json
import tempfile
import os
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────
#  FUNCTION CATALOGUE
# ─────────────────────────────────────────────────────────────
LIBRARY_CATALOGUE = {
    "pm4py": [
        {
            "id":          "pm4py_alpha_miner",
            "name":        "alpha_miner.apply",
            "category":    "Discovery",
            "description": "Alpha Miner — discovers a Petri net from an event log using the Alpha algorithm.",
            "callable":    True,
            "params":      [{"name": "log", "type": "EventLog", "source": "current_log"}],
            "returns":     "Petri net (net, initial_marking, final_marking)",
        },
        {
            "id":          "pm4py_inductive_miner",
            "name":        "inductive_miner.apply",
            "category":    "Discovery",
            "description": "Inductive Miner — discovers a process tree; more robust than Alpha for real logs.",
            "callable":    True,
            "params":      [{"name": "log", "type": "EventLog", "source": "current_log"}],
            "returns":     "ProcessTree",
        },
        {
            "id":          "pm4py_dfg",
            "name":        "dfg_algorithm.apply",
            "category":    "Discovery",
            "description": "Directly-Follows Graph — counts how often activity B follows activity A.",
            "callable":    True,
            "params":      [{"name": "log", "type": "EventLog", "source": "current_log"}],
            "returns":     "dict of (activity_a, activity_b) → frequency",
        },
        {
            "id":          "pm4py_conformance_tbr",
            "name":        "token_based_replay.apply",
            "category":    "Conformance",
            "description": "Token-Based Replay — measures how well the log conforms to a Petri net.",
            "callable":    False,
            "params":      [],
            "returns":     "list of replay results per trace",
            "stub_reason": "Requires a discovered Petri net to be loaded first.",
        },
        {
            "id":          "pm4py_stats_case_duration",
            "name":        "get_all_case_durations",
            "category":    "Statistics",
            "description": "Returns the duration of each case (trace) in the event log.",
            "callable":    True,
            "params":      [{"name": "log", "type": "EventLog", "source": "current_log"}],
            "returns":     "dict case_id → duration (seconds)",
        },
        {
            "id":          "pm4py_filter_variants",
            "name":        "filter_log_variants_top_k",
            "category":    "Filtering",
            "description": "Keep only the top-K most frequent variants in the event log.",
            "callable":    True,
            "params":      [
                {"name": "log", "type": "EventLog",  "source": "current_log"},
                {"name": "k",   "type": "int",        "default": 10},
            ],
            "returns":     "Filtered EventLog",
        },
    ],

    "bupar": [
        {
            "id":          "bupar_process_map",
            "name":        "process_map()",
            "category":    "Visualisation",
            "description": "Renders an interactive process map with performance overlays in R.",
            "callable":    True,   # via R subprocess
            "r_code":      "library(bupaR); library(processmapR); {log} %>% process_map()",
            "params":      [{"name": "log_path", "type": "file", "source": "current_xes"}],
            "returns":     "HTML widget (saved to file)",
        },
        {
            "id":          "bupar_trace_explorer",
            "name":        "trace_explorer()",
            "category":    "Exploration",
            "description": "Shows all unique trace variants with their frequency.",
            "callable":    True,
            "r_code":      "library(bupaR); {log} %>% trace_explorer()",
            "params":      [{"name": "log_path", "type": "file", "source": "current_xes"}],
            "returns":     "HTML widget",
        },
        {
            "id":          "bupar_dotted_chart",
            "name":        "dotted_chart()",
            "category":    "Visualisation",
            "description": "Dotted chart showing case timelines. Reveals batching and parallel behaviour.",
            "callable":    True,
            "r_code":      "library(bupaR); {log} %>% dotted_chart(x='relative')",
            "params":      [{"name": "log_path", "type": "file", "source": "current_xes"}],
            "returns":     "HTML widget",
        },
        {
            "id":          "bupar_activity_frequency",
            "name":        "activity_frequency()",
            "category":    "Statistics",
            "description": "Counts relative and absolute frequency of each activity.",
            "callable":    True,
            "r_code":      "library(bupaR); {log} %>% activity_frequency('activity')",
            "params":      [{"name": "log_path", "type": "file", "source": "current_xes"}],
            "returns":     "data.frame",
        },
    ],

    "bpmn-js": [
        {
            "id":          "bpmnjs_import_definition",
            "name":        "BpmnJS.importXML()",
            "category":    "Import",
            "description": "Parse and render a BPMN 2.0 XML definition in the browser canvas.",
            "callable":    False,
            "js_snippet":  "const bpmnModeler = new BpmnJS({ container: '#canvas' });\nawait bpmnModeler.importXML(bpmnXML);",
            "stub_reason": "JS-only; runs in browser. Use 'Native View' to open an iframe embed.",
        },
        {
            "id":          "bpmnjs_export_svg",
            "name":        "BpmnJS.saveSVG()",
            "category":    "Export",
            "description": "Export the current diagram as an SVG string.",
            "callable":    False,
            "js_snippet":  "const { svg } = await bpmnModeler.saveSVG();",
            "stub_reason": "JS-only browser API.",
        },
        {
            "id":          "bpmnjs_add_overlay",
            "name":        "overlays.add()",
            "category":    "Interaction",
            "description": "Attach custom HTML overlays (e.g. KPIs, heatmaps) to BPMN elements.",
            "callable":    False,
            "js_snippet":  "bpmnModeler.get('overlays').add('Task_1', { position: {bottom:0,right:0}, html: '<div>KPI</div>' });",
            "stub_reason": "JS-only browser API.",
        },
    ],

    "mp4js": [
        {
            "id":          "mp4js_discover",
            "name":        "mpm.discover()",
            "category":    "Discovery",
            "description": "Discover a process model directly from a CSV event log in the browser.",
            "callable":    False,
            "js_snippet":  "const model = await mpm.discover(eventLog, { algorithm: 'alpha' });",
            "stub_reason": "JS-only library; runs in browser.",
        },
        {
            "id":          "mp4js_animate",
            "name":        "mpm.animate()",
            "category":    "Visualisation",
            "description": "Animate token replay over a discovered process model in the browser.",
            "callable":    False,
            "js_snippet":  "mpm.animate(model, eventLog, { speed: 1.0 });",
            "stub_reason": "JS-only browser API.",
        },
    ],
}


class BenchmarkRunner:

    def get_catalogue(self) -> dict:
        return LIBRARY_CATALOGUE

    def call_function(self, library: str, func_id: str,
                      params: dict, log_path: Optional[str] = None) -> dict:
        """
        Attempt to call a catalogued function.
        Returns {"result": ..., "error": None} or {"result": None, "error": "..."}.
        """
        entry = self._find(library, func_id)
        if entry is None:
            return {"result": None, "error": f"Function '{func_id}' not found in '{library}'"}
        if not entry.get("callable", False):
            return {"result": None, "error": entry.get("stub_reason", "Not callable server-side")}

        if library == "pm4py":
            return self._call_pm4py(entry, params, log_path)
        elif library == "bupar":
            return self._call_bupar(entry, params, log_path)
        else:
            return {"result": None, "error": f"Library '{library}' cannot be called server-side."}

    # ── pm4py dispatcher ────────────────────────────────────

    def _call_pm4py(self, entry: dict, params: dict, log_path: Optional[str]) -> dict:
        import pm4py
        from pm4py.objects.log.importer.xes import importer as xes_importer

        func_id = entry["id"]

        try:
            log = None
            if log_path and log_path.endswith(".xes"):
                log = xes_importer.apply(log_path)

            if func_id == "pm4py_alpha_miner":
                from pm4py.algo.discovery.alpha import algorithm as alpha
                net, im, fm = alpha.apply(log)
                return {"result": {"places": len(net.places),
                                   "transitions": len(net.transitions),
                                   "arcs": len(net.arcs)}, "error": None}

            elif func_id == "pm4py_inductive_miner":
                from pm4py.algo.discovery.inductive import algorithm as inductive
                tree = inductive.apply(log)
                return {"result": str(tree), "error": None}

            elif func_id == "pm4py_dfg":
                from pm4py.algo.discovery.dfg import algorithm as dfg_alg
                dfg, _, _ = dfg_alg.apply(log)
                return {"result": {f"{a}→{b}": c for (a, b), c in list(dfg.items())[:20]},
                        "error": None}

            elif func_id == "pm4py_stats_case_duration":
                durations = pm4py.get_all_case_durations(log)
                return {"result": {"count": len(durations),
                                   "avg_seconds": round(sum(durations)/len(durations), 2)
                                   if durations else 0}, "error": None}

            elif func_id == "pm4py_filter_variants":
                k = int(params.get("k", 10))
                filtered = pm4py.filter_log_variants_top_k(log, k)
                return {"result": {"cases_before": len(log),
                                   "cases_after":  len(filtered)}, "error": None}

            else:
                return {"result": None, "error": f"Handler not implemented for {func_id}"}

        except Exception as ex:
            return {"result": None, "error": str(ex)}

    # ── bupaR dispatcher (R subprocess) ─────────────────────

    def _call_bupar(self, entry: dict, params: dict, log_path: Optional[str]) -> dict:
        """
        Runs R code via subprocess.
        Requires: R, bupaR, processmapR installed on the system.
        """
        if not log_path:
            return {"result": None, "error": "log_path required for bupaR calls"}

        r_template = entry.get("r_code", "")
        with tempfile.NamedTemporaryFile(suffix=".xes", delete=False) as tf:
            xes_tmp = tf.name

        output_html = xes_tmp.replace(".xes", "_out.html")
        r_script = f"""
library(bupaR)
library(processmapR)
library(eventdataR)
library(htmlwidgets)

log <- read_xes('{log_path}')
result <- log %>% {entry['id'].replace('bupar_', '').replace('_', '(')}
if (inherits(result, 'htmlwidget')) {{
  saveWidget(result, '{output_html}', selfcontained=TRUE)
  cat('SAVED:', '{output_html}')
}} else {{
  print(result)
}}
"""
        with tempfile.NamedTemporaryFile(suffix=".R", mode="w", delete=False) as rf:
            rf.write(r_script)
            r_path = rf.name

        try:
            proc = subprocess.run(["Rscript", r_path],
                                  capture_output=True, text=True, timeout=60)
            if proc.returncode != 0:
                return {"result": None, "error": proc.stderr[:500]}
            if os.path.exists(output_html):
                with open(output_html) as f:
                    html = f.read()
                return {"result": {"html": html[:2000] + "..."}, "error": None}
            return {"result": {"stdout": proc.stdout[:1000]}, "error": None}
        except FileNotFoundError:
            return {"result": None, "error": "R not found. Install R and bupaR to use this feature."}
        except subprocess.TimeoutExpired:
            return {"result": None, "error": "R subprocess timed out (60s)."}
        finally:
            for f in [r_path, xes_tmp, output_html]:
                if os.path.exists(f):
                    os.unlink(f)

    # ── helpers ─────────────────────────────────────────────

    def _find(self, library: str, func_id: str) -> Optional[dict]:
        for entry in LIBRARY_CATALOGUE.get(library, []):
            if entry["id"] == func_id:
                return entry
        return None
