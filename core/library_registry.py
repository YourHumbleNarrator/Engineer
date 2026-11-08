"""
Registry of process-mining library functions with metadata for the benchmark panel.

Each entry describes a function's signature, purpose, what it needs as input,
whether it can be executed within this application (Python/JS), and optional
inline parameters the user can tweak before running.

Data type tags used in ``needs`` / ``returns``:
  "log"          – a pm4py EventLog is loaded in the session
  "petri_net"    – a Petri net was discovered / loaded
  "bpmn_xml"     – BPMN XML is available server-side
  "process_tree" – a process tree is available
  "bpmn_loaded"  – the bpmn-js viewer already has a diagram open (client only)
  "pm4js_log"    – pm4js EventLog is in browser memory (client only)
  "pm4js_petri"  – pm4js PetriNet is in browser memory (client only)
"""
from __future__ import annotations
import importlib


def _importable(module: str) -> bool:
    try:
        importlib.import_module(module)
        return True
    except ImportError:
        return False


LIBRARIES: list[dict] = [

    # =========================================================================
    # pm4py  –  Python
    # =========================================================================
    {
        "id": "pm4py",
        "label": "pm4py",
        "language": "python",
        "description": (
            "Python framework for process mining. Covers event-log import "
            "(XES, CSV), process discovery (Alpha, Inductive, Heuristics), "
            "conformance checking (token replay, alignments), filtering, "
            "and Graphviz-based native visualisation."
        ),
        "homepage": "https://pm4py.fit.fraunhofer.de/",
        "available": _importable("pm4py"),
        "native_view": "pm4py",
        "categories": [
            {
                "name": "Discovery",
                "functions": [
                    {
                        "id": "pm4py.discover_dfg",
                        "name": "discover_dfg",
                        "signature": "pm4py.discover_dfg(log)",
                        "description": (
                            "Discover a Directly-Follows Graph. Returns a dict of "
                            "(activity_a, activity_b) → frequency together with "
                            "start- and end-activity counts."
                        ),
                        "needs": ["log"],
                        "returns": "dfg",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.discover_petri_net_alpha",
                        "name": "discover_petri_net_alpha",
                        "signature": "pm4py.discover_petri_net_alpha(log)",
                        "description": (
                            "Alpha Miner: derive a Petri net from activity ordering "
                            "relations. Fast, but sensitive to noise and loops."
                        ),
                        "needs": ["log"],
                        "returns": "petri_net",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.discover_petri_net_inductive",
                        "name": "discover_petri_net_inductive",
                        "signature": "pm4py.discover_petri_net_inductive(log)",
                        "description": (
                            "Inductive Miner: recursively splits the log into sublogs. "
                            "Guarantees perfect fitness. Best choice for noisy real-world logs."
                        ),
                        "needs": ["log"],
                        "returns": "petri_net",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.discover_petri_net_heuristics",
                        "name": "discover_petri_net_heuristics",
                        "signature": "pm4py.discover_petri_net_heuristics(log)",
                        "description": (
                            "Heuristics Miner: weights edges by dependency measure. "
                            "Noise-tolerant; exposes infrequent relations as a "
                            "configurable threshold."
                        ),
                        "needs": ["log"],
                        "returns": "petri_net",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.discover_bpmn_inductive",
                        "name": "discover_bpmn_inductive",
                        "signature": "pm4py.discover_bpmn_inductive(log)",
                        "description": (
                            "Discover a process model via the Inductive Miner and "
                            "serialise it as a BPMN 2.0 XML string — ready for "
                            "the bpmn-js native viewer."
                        ),
                        "needs": ["log"],
                        "returns": "bpmn_xml",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.discover_process_tree_inductive",
                        "name": "discover_process_tree_inductive",
                        "signature": "pm4py.discover_process_tree_inductive(log)",
                        "description": (
                            "Discover a block-structured process tree. Trees are always "
                            "sound and can be converted to Petri nets / BPMN without loss."
                        ),
                        "needs": ["log"],
                        "returns": "process_tree",
                        "executable": True,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Conformance",
                "functions": [
                    {
                        "id": "pm4py.fitness_token_based_replay",
                        "name": "fitness_token_based_replay",
                        "signature": "pm4py.fitness_token_based_replay(log, net, im, fm)",
                        "description": (
                            "Replay the log on the Petri net using token-based simulation. "
                            "Returns a fitness score in [0, 1] — how well the model "
                            "reproduces observed traces."
                        ),
                        "needs": ["log", "petri_net"],
                        "returns": "float",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.precision_token_based_replay",
                        "name": "precision_token_based_replay",
                        "signature": "pm4py.precision_token_based_replay(log, net, im, fm)",
                        "description": (
                            "ETC precision: fraction of model behaviour actually observed in "
                            "the log. High precision means the model does not over-generalise."
                        ),
                        "needs": ["log", "petri_net"],
                        "returns": "float",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.conformance_diagnostics_token_based_replay",
                        "name": "conformance_diagnostics_token_based_replay",
                        "signature": "pm4py.conformance_diagnostics_token_based_replay(log, net, im, fm)",
                        "description": (
                            "Per-trace token-replay diagnostics: missing and remaining tokens, "
                            "is-fit flag, and produced/consumed token counts for each case."
                        ),
                        "needs": ["log", "petri_net"],
                        "returns": "list[dict]",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.conformance_diagnostics_alignments",
                        "name": "conformance_diagnostics_alignments",
                        "signature": "pm4py.conformance_diagnostics_alignments(log, net, im, fm)",
                        "description": (
                            "Per-trace optimal-alignment diagnostics. Finds the minimum-cost "
                            "sequence of model/log moves. Exact but computationally expensive "
                            "on large logs."
                        ),
                        "needs": ["log", "petri_net"],
                        "returns": "list[dict]",
                        "executable": True,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Statistics",
                "functions": [
                    {
                        "id": "pm4py.get_start_activities",
                        "name": "get_start_activities",
                        "signature": "pm4py.get_start_activities(log)",
                        "description": "Return {activity: count} for every activity that starts at least one case.",
                        "needs": ["log"],
                        "returns": "dict",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.get_end_activities",
                        "name": "get_end_activities",
                        "signature": "pm4py.get_end_activities(log)",
                        "description": "Return {activity: count} for every activity that ends at least one case.",
                        "needs": ["log"],
                        "returns": "dict",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.get_variants",
                        "name": "get_variants",
                        "signature": "pm4py.get_variants(log)",
                        "description": (
                            "Return all unique trace variants (activity sequences) with their "
                            "case counts, sorted by frequency descending."
                        ),
                        "needs": ["log"],
                        "returns": "dict",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.get_event_attributes",
                        "name": "get_event_attributes",
                        "signature": "pm4py.get_event_attributes(log)",
                        "description": "Return the set of attribute keys that appear in event-level data across the log.",
                        "needs": ["log"],
                        "returns": "set",
                        "executable": True,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Filtering",
                "functions": [
                    {
                        "id": "pm4py.filter_variants_top_k",
                        "name": "filter_variants_top_k",
                        "signature": "pm4py.filter_variants_top_k(log, k=5)",
                        "description": (
                            "Keep only the k most-frequent trace variants. "
                            "Useful for isolating the happy path before discovery."
                        ),
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "k", "type": "int", "default": 5,
                                "label": "Top k variants", "min": 1, "max": 50,
                            }
                        ],
                        "returns": "filtered_log",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.filter_case_performance",
                        "name": "filter_case_performance",
                        "signature": "pm4py.filter_case_performance(log, min_perf, max_perf)",
                        "description": (
                            "Keep cases whose throughput time (seconds) falls within "
                            "[min_perf, max_perf]. Removes outlier slow/fast cases."
                        ),
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "min_perf", "type": "float", "default": 0,
                                "label": "Min seconds", "min": 0,
                            },
                            {
                                "name": "max_perf", "type": "float", "default": 86400,
                                "label": "Max seconds", "min": 0,
                            },
                        ],
                        "returns": "filtered_log",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.filter_activities_rework",
                        "name": "filter_activities_rework",
                        "signature": "pm4py.filter_activities_rework(log)",
                        "description": (
                            "Remove events where the same activity recurs within a case "
                            "(rework / loops). Returns a simplified log."
                        ),
                        "needs": ["log"],
                        "returns": "filtered_log",
                        "executable": True,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Visualisation (Native)",
                "functions": [
                    {
                        "id": "pm4py.view_dfg",
                        "name": "view_dfg",
                        "signature": "pm4py.view_dfg(dfg, start_activities, end_activities)",
                        "description": (
                            "Render a Directly-Follows Graph using pm4py's Graphviz backend "
                            "and display the PNG inline."
                        ),
                        "needs": ["log"],
                        "returns": "image_png",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.view_petri_net",
                        "name": "view_petri_net",
                        "signature": "pm4py.view_petri_net(net, im, fm)",
                        "description": "Render the last discovered Petri net with its markings via Graphviz.",
                        "needs": ["petri_net"],
                        "returns": "image_png",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.view_process_tree",
                        "name": "view_process_tree",
                        "signature": "pm4py.view_process_tree(tree)",
                        "description": "Render the last discovered process tree as a Graphviz PNG.",
                        "needs": ["process_tree"],
                        "returns": "image_png",
                        "executable": True,
                        "client_side": False,
                    },
                    {
                        "id": "pm4py.view_bpmn",
                        "name": "view_bpmn",
                        "signature": "pm4py.view_bpmn(bpmn_model)",
                        "description": "Render the last discovered BPMN model using Graphviz (server-side PNG).",
                        "needs": ["bpmn_xml"],
                        "returns": "image_png",
                        "executable": True,
                        "client_side": False,
                    },
                ],
            },
        ],
    },

    # =========================================================================
    # pm4js  –  JavaScript (client-side)
    # =========================================================================
    {
        "id": "pm4js",
        "label": "pm4js",
        "language": "javascript",
        "description": (
            "JavaScript port of pm4py. Runs entirely in the browser with no "
            "server round-trip. Covers DFG and Petri-net discovery, variant "
            "extraction, and token-based conformance checking."
        ),
        "homepage": "https://github.com/pm4py/pm4js-core",
        "available": True,          # resolved at runtime in the browser
        "native_view": "pm4js",
        "categories": [
            {
                "name": "Event Log",
                "functions": [
                    {
                        "id": "pm4js.import_xes_string",
                        "name": "importXesString",
                        "signature": "pm4js.importXesString(xmlString)",
                        "description": (
                            "Parse a raw XES XML string in the browser and return a pm4js "
                            "EventLog object held in memory. Fetches the XES from the server "
                            "automatically."
                        ),
                        "needs": ["log"],
                        "returns": "EventLog",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "pm4js.get_variants",
                        "name": "getVariants",
                        "signature": "pm4js.getVariants(log)",
                        "description": "Return all unique activity-sequence variants with case counts as a plain JS object.",
                        "needs": ["pm4js_log"],
                        "returns": "object",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "pm4js.get_start_activities",
                        "name": "getStartActivities",
                        "signature": "pm4js.getStartActivities(log)",
                        "description": "Return {activity → count} for all case-starting activities.",
                        "needs": ["pm4js_log"],
                        "returns": "object",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "pm4js.get_end_activities",
                        "name": "getEndActivities",
                        "signature": "pm4js.getEndActivities(log)",
                        "description": "Return {activity → count} for all case-ending activities.",
                        "needs": ["pm4js_log"],
                        "returns": "object",
                        "executable": True,
                        "client_side": True,
                    },
                ],
            },
            {
                "name": "Discovery",
                "functions": [
                    {
                        "id": "pm4js.discover_dfg",
                        "name": "discoverDfgFromLog",
                        "signature": "pm4js.discoverDfgFromLog(log)",
                        "description": (
                            "Discover a DFG entirely in the browser. Returns a plain JS object "
                            "that can be fed directly into the main Cytoscape/D3 canvas."
                        ),
                        "needs": ["pm4js_log"],
                        "returns": "DFG",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "pm4js.discover_petri_net_alpha",
                        "name": "discoverPetriNetAlpha",
                        "signature": "pm4js.discoverPetriNetAlpha(log)",
                        "description": "Apply the Alpha Miner in the browser and return a PetriNet object.",
                        "needs": ["pm4js_log"],
                        "returns": "PetriNet",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "pm4js.discover_petri_net_inductive",
                        "name": "discoverPetriNetInductive",
                        "signature": "pm4js.discoverPetriNetInductive(log)",
                        "description": "Apply the Inductive Miner in the browser. Returns a PetriNet with initial/final markings.",
                        "needs": ["pm4js_log"],
                        "returns": "PetriNet",
                        "executable": True,
                        "client_side": True,
                    },
                ],
            },
            {
                "name": "Conformance",
                "functions": [
                    {
                        "id": "pm4js.replay_fitness_token_based",
                        "name": "replayFitnessTokenBased",
                        "signature": "pm4js.replayFitnessTokenBased(log, petriNet)",
                        "description": "Token-based replay fitness computed in the browser. Returns a fitness value in [0, 1].",
                        "needs": ["pm4js_log", "pm4js_petri"],
                        "returns": "float",
                        "executable": True,
                        "client_side": True,
                    },
                ],
            },
        ],
    },

    # =========================================================================
    # bpmn-js  –  JavaScript (client-side)
    # =========================================================================
    {
        "id": "bpmn_js",
        "label": "bpmn-js",
        "language": "javascript",
        "description": (
            "BPMN 2.0 rendering toolkit by Camunda. Renders, navigates, "
            "and exports BPMN process diagrams using an SVG-based canvas "
            "entirely in the browser. Zero server round-trips after loading."
        ),
        "homepage": "https://bpmn.io/toolkit/bpmn-js/",
        "available": True,
        "native_view": "bpmn_js",
        "categories": [
            {
                "name": "Viewer",
                "functions": [
                    {
                        "id": "bpmnjs.importXML",
                        "name": "importXML",
                        "signature": "viewer.importXML(xml: string): Promise<{ warnings }>",
                        "description": (
                            "Load and render a BPMN 2.0 XML string on the canvas. "
                            "Automatically discovers BPMN via pm4py if no XML is loaded yet."
                        ),
                        "needs": ["log"],
                        "returns": "Promise<void>",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.saveXML",
                        "name": "saveXML",
                        "signature": "viewer.saveXML({ format: true }): Promise<{ xml }>",
                        "description": "Serialise the currently displayed diagram back to a formatted BPMN 2.0 XML string.",
                        "needs": ["bpmn_loaded"],
                        "returns": "Promise<string>",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.saveSVG",
                        "name": "saveSVG",
                        "signature": "viewer.saveSVG(): Promise<{ svg }>",
                        "description": "Export the current diagram as a raw SVG string — suitable for download or embedding.",
                        "needs": ["bpmn_loaded"],
                        "returns": "Promise<string>",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.zoom_fit",
                        "name": "canvas.zoom('fit-viewport')",
                        "signature": "viewer.get('canvas').zoom('fit-viewport')",
                        "description": "Fit the entire diagram within the current viewport.",
                        "needs": ["bpmn_loaded"],
                        "returns": "number",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.zoom_in",
                        "name": "canvas.zoom (in)",
                        "signature": "canvas.zoom(canvas.zoom() * 1.3)",
                        "description": "Zoom in by 30 % on the diagram centre.",
                        "needs": ["bpmn_loaded"],
                        "returns": "number",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.zoom_out",
                        "name": "canvas.zoom (out)",
                        "signature": "canvas.zoom(canvas.zoom() / 1.3)",
                        "description": "Zoom out by 30 % on the diagram centre.",
                        "needs": ["bpmn_loaded"],
                        "returns": "number",
                        "executable": True,
                        "client_side": True,
                    },
                ],
            },
            {
                "name": "Element Inspection",
                "functions": [
                    {
                        "id": "bpmnjs.getAll",
                        "name": "elementRegistry.getAll",
                        "signature": "viewer.get('elementRegistry').getAll()",
                        "description": "Return all shape and connection objects currently on the canvas as an array.",
                        "needs": ["bpmn_loaded"],
                        "returns": "Element[]",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.count_tasks",
                        "name": "count Tasks",
                        "signature": "elementRegistry.filter(e => e.type === 'bpmn:Task').length",
                        "description": "Count Task (bpmn:Task) elements in the diagram.",
                        "needs": ["bpmn_loaded"],
                        "returns": "number",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.count_gateways",
                        "name": "count Gateways",
                        "signature": "elementRegistry.filter(e => /Gateway/.test(e.type)).length",
                        "description": "Count all gateway elements (XOR, AND, OR, Complex, Event-Based) in the diagram.",
                        "needs": ["bpmn_loaded"],
                        "returns": "number",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.list_lanes",
                        "name": "list Lanes / Pools",
                        "signature": "elementRegistry.filter(e => /Lane|Participant/.test(e.type))",
                        "description": "List all Lane and Participant (pool) elements, returning their IDs and labels.",
                        "needs": ["bpmn_loaded"],
                        "returns": "Element[]",
                        "executable": True,
                        "client_side": True,
                    },
                    {
                        "id": "bpmnjs.highlight_element",
                        "name": "canvas.addMarker (highlight)",
                        "signature": "canvas.addMarker(elementId, 'lib-highlight')",
                        "description": "Add a CSS highlight marker to a specific element. Enter its ID from the registry output.",
                        "needs": ["bpmn_loaded"],
                        "params": [
                            {
                                "name": "elementId", "type": "string",
                                "default": "", "label": "Element ID",
                            }
                        ],
                        "returns": "void",
                        "executable": True,
                        "client_side": True,
                    },
                ],
            },
        ],
    },

    # =========================================================================
    # bupaR  –  R (reference only — runtime not available)
    # =========================================================================
    {
        "id": "bupar",
        "label": "bupaR",
        "language": "R",
        "description": (
            "Business Process Analysis in R. A suite of R packages (bupaR, "
            "processmapR, edeaR, eventdataR) for event-log import, process "
            "mapping, performance analysis, and filtering. Shown here as "
            "reference documentation — R is not available in this environment."
        ),
        "homepage": "https://bupar.net/",
        "available": False,
        "native_view": None,
        "categories": [
            {
                "name": "Event Log",
                "functions": [
                    {
                        "id": "bupar.eventlog",
                        "name": "eventlog",
                        "signature": (
                            "eventlog(data, case_id, activity_id, "
                            "activity_instance_id, lifecycle_id, timestamp, resource_id)"
                        ),
                        "description": (
                            "Construct a bupaR event log from a data frame. "
                            "All subsequent pipeline operations require this object."
                        ),
                        "needs": [],
                        "returns": "eventlog",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.n_cases",
                        "name": "n_cases",
                        "signature": "n_cases(log)",
                        "description": "Return the number of distinct cases (process instances) in the log.",
                        "needs": ["log"],
                        "returns": "integer",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.n_activities",
                        "name": "n_activities",
                        "signature": "n_activities(log)",
                        "description": "Return the count of distinct activity labels.",
                        "needs": ["log"],
                        "returns": "integer",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.n_traces",
                        "name": "n_traces",
                        "signature": "n_traces(log)",
                        "description": "Return the number of unique trace variants (activity-sequence patterns).",
                        "needs": ["log"],
                        "returns": "integer",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.activities",
                        "name": "activities",
                        "signature": "activities(log)",
                        "description": "List all activities with absolute and relative frequencies.",
                        "needs": ["log"],
                        "returns": "data.frame",
                        "executable": False,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Process Maps",
                "functions": [
                    {
                        "id": "bupar.process_map",
                        "name": "process_map",
                        "signature": "process_map(log, type = frequency('absolute'))",
                        "description": (
                            "Discover and render a process map (DFG variant) using processmapR. "
                            "Supports frequency, relative frequency, and performance metrics."
                        ),
                        "needs": ["log"],
                        "returns": "htmlwidget",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.precedence_matrix",
                        "name": "precedence_matrix",
                        "signature": "precedence_matrix(log, type = 'absolute')",
                        "description": "Compute a matrix showing how often each activity directly or eventually precedes another.",
                        "needs": ["log"],
                        "returns": "matrix",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.dotted_chart",
                        "name": "dotted_chart",
                        "signature": "dotted_chart(log, x = 'absolute', sort = 'start')",
                        "description": (
                            "Render a dotted-chart timeline view: one dot per event, "
                            "cases on the y-axis, time on the x-axis."
                        ),
                        "needs": ["log"],
                        "returns": "htmlwidget",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.trace_explorer",
                        "name": "trace_explorer",
                        "signature": "trace_explorer(log, coverage = 0.75)",
                        "description": (
                            "Browse trace variants ranked by frequency. Shows top variants "
                            "that together account for the given fraction of all cases."
                        ),
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "coverage", "type": "float", "default": 0.75,
                                "label": "Coverage %", "min": 0.0, "max": 1.0, "step": 0.05,
                            }
                        ],
                        "returns": "htmlwidget",
                        "executable": False,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Performance",
                "functions": [
                    {
                        "id": "bupar.throughput_time",
                        "name": "throughput_time",
                        "signature": "throughput_time(log, units = 'days')",
                        "description": "Compute throughput-time statistics (min, mean, median, max) for all cases.",
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "units", "type": "select",
                                "options": ["secs", "mins", "hours", "days", "weeks"],
                                "default": "days", "label": "Units",
                            }
                        ],
                        "returns": "summary",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.idle_time",
                        "name": "idle_time",
                        "signature": "idle_time(log, units = 'hours')",
                        "description": "Measure idle time (waiting between consecutive activities) per case.",
                        "needs": ["log"],
                        "returns": "summary",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.processing_time",
                        "name": "processing_time",
                        "signature": "processing_time(log, units = 'hours')",
                        "description": (
                            "Measure active processing time per case. "
                            "Requires start and complete lifecycle transitions."
                        ),
                        "needs": ["log"],
                        "returns": "summary",
                        "executable": False,
                        "client_side": False,
                    },
                ],
            },
            {
                "name": "Filtering",
                "functions": [
                    {
                        "id": "bupar.filter_activity_frequency",
                        "name": "filter_activity_frequency",
                        "signature": "filter_activity_frequency(log, percentage = 0.8)",
                        "description": "Remove activities that appear in fewer than `percentage` of all cases.",
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "percentage", "type": "float", "default": 0.8,
                                "label": "Min % of cases", "min": 0.0, "max": 1.0, "step": 0.05,
                            }
                        ],
                        "returns": "eventlog",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.filter_trace_frequency",
                        "name": "filter_trace_frequency",
                        "signature": "filter_trace_frequency(log, percentage = 0.8)",
                        "description": "Keep the most frequent trace variants that together cover `percentage` of all cases.",
                        "needs": ["log"],
                        "params": [
                            {
                                "name": "percentage", "type": "float", "default": 0.8,
                                "label": "Coverage %", "min": 0.0, "max": 1.0, "step": 0.05,
                            }
                        ],
                        "returns": "eventlog",
                        "executable": False,
                        "client_side": False,
                    },
                    {
                        "id": "bupar.filter_endpoints",
                        "name": "filter_endpoints",
                        "signature": "filter_endpoints(log, start_activities, end_activities)",
                        "description": "Keep only cases that start and end with the specified activity labels.",
                        "needs": ["log"],
                        "returns": "eventlog",
                        "executable": False,
                        "client_side": False,
                    },
                ],
            },
        ],
    },
]
