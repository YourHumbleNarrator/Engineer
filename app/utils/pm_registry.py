"""Registry of pm4py functions with descriptions, parameters, and categories."""
from typing import Any, Dict, List

FUNCTION_REGISTRY: List[Dict[str, Any]] = [
    # ── Discovery ────────────────────────────────────────────────────────────
    {
        "name": "discover_dfg",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a Directly-Follows Graph (DFG) from an event log. "
            "Returns (dfg_dict, start_activities, end_activities) where dfg_dict maps "
            "(activity_a, activity_b) → occurrence_count."
        ),
        "params": {"log": "EventLog | DataFrame"},
        "returns": "tuple[dict, dict, dict]",
        "pm4py_function": "pm4py.discover_dfg",
    },
    {
        "name": "discover_performance_dfg",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a performance DFG annotated with mean/median/min/max sojourn times "
            "(in seconds) between consecutive activities."
        ),
        "params": {"log": "EventLog | DataFrame"},
        "returns": "tuple[dict, dict, dict]",
        "pm4py_function": "pm4py.discover_performance_dfg",
    },
    {
        "name": "discover_petri_net_alpha",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a Petri net using the Alpha Miner algorithm. "
            "Works best on simple, noise-free, structured event logs. "
            "Cannot handle loops or invisible tasks well."
        ),
        "params": {"log": "EventLog | DataFrame"},
        "returns": "tuple[PetriNet, Marking, Marking]",
        "pm4py_function": "pm4py.discover_petri_net_alpha",
    },
    {
        "name": "discover_petri_net_inductive",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a Petri net using the Inductive Miner algorithm. "
            "Guarantees sound (deadlock-free) models. "
            "Accepts a noise_threshold (0–1) to skip infrequent variants."
        ),
        "params": {
            "log": "EventLog | DataFrame",
            "noise_threshold": "float (0–1, default 0.0)",
        },
        "returns": "tuple[PetriNet, Marking, Marking]",
        "pm4py_function": "pm4py.discover_petri_net_inductive",
    },
    {
        "name": "discover_petri_net_heuristics",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a Petri net using the Heuristics Miner. "
            "Robust to noise; allows frequency-based dependency thresholds. "
            "Good for real-world messy logs."
        ),
        "params": {
            "log": "EventLog | DataFrame",
            "dependency_threshold": "float (default 0.5)",
            "and_threshold": "float (default 0.65)",
            "loop_two_threshold": "float (default 0.5)",
        },
        "returns": "tuple[PetriNet, Marking, Marking]",
        "pm4py_function": "pm4py.discover_petri_net_heuristics",
    },
    {
        "name": "discover_process_tree_inductive",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a hierarchical process tree using the Inductive Miner. "
            "The tree uses SEQ (→), XOR (×), AND (∧), LOOP (↺) operators. "
            "Can be converted to Petri net or BPMN."
        ),
        "params": {
            "log": "EventLog | DataFrame",
            "noise_threshold": "float (default 0.0)",
        },
        "returns": "ProcessTree",
        "pm4py_function": "pm4py.discover_process_tree_inductive",
    },
    {
        "name": "discover_bpmn_inductive",
        "module": "pm4py",
        "category": "discovery",
        "description": (
            "Discover a BPMN 2.0 model using the Inductive Miner. "
            "Internally discovers a process tree and converts it to BPMN notation."
        ),
        "params": {
            "log": "EventLog | DataFrame",
            "noise_threshold": "float (default 0.0)",
        },
        "returns": "BPMN",
        "pm4py_function": "pm4py.discover_bpmn_inductive",
    },
    # ── Conformance ──────────────────────────────────────────────────────────
    {
        "name": "conformance_diagnostics_token_based_replay",
        "module": "pm4py",
        "category": "conformance",
        "description": (
            "Token-based replay conformance checking. "
            "Replays each trace on the Petri net and reports missing/remaining tokens, "
            "per-trace fitness, and activated/completed transitions."
        ),
        "params": {
            "log": "EventLog",
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
        },
        "returns": "list[dict] — one diagnostics dict per trace",
        "pm4py_function": "pm4py.conformance_diagnostics_token_based_replay",
    },
    {
        "name": "conformance_diagnostics_alignments",
        "module": "pm4py",
        "category": "conformance",
        "description": (
            "Alignment-based conformance checking. "
            "Finds the optimal alignment between each trace and the model "
            "using A* search. More precise but computationally heavier than token replay."
        ),
        "params": {
            "log": "EventLog",
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
        },
        "returns": "list[dict] — one alignment dict per trace",
        "pm4py_function": "pm4py.conformance_diagnostics_alignments",
    },
    {
        "name": "fitness_token_based_replay",
        "module": "pm4py",
        "category": "conformance",
        "description": (
            "Compute overall fitness score using token-based replay. "
            "Returns a dict with 'average_trace_fitness' and 'log_fitness' (0 = no fit, 1 = perfect)."
        ),
        "params": {
            "log": "EventLog",
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
        },
        "returns": "dict with 'average_trace_fitness', 'log_fitness', 'perc_fit_traces'",
        "pm4py_function": "pm4py.fitness_token_based_replay",
    },
    {
        "name": "precision_token_based_replay",
        "module": "pm4py",
        "category": "conformance",
        "description": (
            "Compute precision using token-based replay. "
            "Measures how much of the model's allowed behaviour is actually observed in the log. "
            "High precision means the model is specific."
        ),
        "params": {
            "log": "EventLog",
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
        },
        "returns": "float",
        "pm4py_function": "pm4py.precision_token_based_replay",
    },
    # ── Filtering ────────────────────────────────────────────────────────────
    {
        "name": "filter_log_relative_occurrence_event_attribute",
        "module": "pm4py",
        "category": "filtering",
        "description": (
            "Filter the log by minimum relative frequency of an event attribute value. "
            "For example, keep only activities that account for ≥ 5 % of events."
        ),
        "params": {
            "log": "EventLog",
            "min_relative_stake": "float (0–1)",
        },
        "returns": "EventLog",
        "pm4py_function": "pm4py.filter_log_relative_occurrence_event_attribute",
    },
    {
        "name": "filter_variants_top_k",
        "module": "pm4py",
        "category": "filtering",
        "description": (
            "Keep only the top-k most frequent trace variants in the log. "
            "Useful for focusing analysis on the happy path."
        ),
        "params": {
            "log": "EventLog",
            "k": "int — number of variants to keep",
        },
        "returns": "EventLog",
        "pm4py_function": "pm4py.filter_variants_top_k",
    },
    {
        "name": "filter_dfg_on_activities_percentage",
        "module": "pm4py",
        "category": "filtering",
        "description": (
            "Filter a DFG to keep only activities that account for at least a given percentage "
            "of events. Automatically adjusts edges and start/end sets."
        ),
        "params": {
            "dfg": "dict",
            "start_activities": "dict",
            "end_activities": "dict",
            "perc_activities": "float (0–1)",
        },
        "returns": "tuple[dict, dict, dict]",
        "pm4py_function": "pm4py.filter_dfg_on_activities_percentage",
    },
    {
        "name": "filter_between",
        "module": "pm4py",
        "category": "filtering",
        "description": (
            "Filter the log to keep only events that occur between two specified activities, "
            "including the activities themselves."
        ),
        "params": {
            "log": "EventLog",
            "activity_a": "str — first activity",
            "activity_b": "str — last activity",
        },
        "returns": "EventLog",
        "pm4py_function": "pm4py.filter_between",
    },
    # ── Statistics ───────────────────────────────────────────────────────────
    {
        "name": "get_variants",
        "module": "pm4py",
        "category": "statistics",
        "description": (
            "Get all trace variants from the event log. "
            "Returns a dict mapping variant tuples (activity sequences) to lists of traces."
        ),
        "params": {"log": "EventLog"},
        "returns": "dict[tuple, list[Trace]]",
        "pm4py_function": "pm4py.get_variants",
    },
    {
        "name": "get_start_activities",
        "module": "pm4py",
        "category": "statistics",
        "description": "Get the activities that appear as the first event in a case, with their occurrence counts.",
        "params": {"log": "EventLog | DataFrame"},
        "returns": "dict[str, int]",
        "pm4py_function": "pm4py.get_start_activities",
    },
    {
        "name": "get_end_activities",
        "module": "pm4py",
        "category": "statistics",
        "description": "Get the activities that appear as the last event in a case, with their occurrence counts.",
        "params": {"log": "EventLog | DataFrame"},
        "returns": "dict[str, int]",
        "pm4py_function": "pm4py.get_end_activities",
    },
    {
        "name": "get_event_attribute_values",
        "module": "pm4py",
        "category": "statistics",
        "description": "Count the occurrences of each value of a specified event attribute (e.g. activity, resource, org:group).",
        "params": {
            "log": "EventLog",
            "attribute": "str — attribute key (e.g. 'concept:name')",
        },
        "returns": "dict[str, int]",
        "pm4py_function": "pm4py.get_event_attribute_values",
    },
    {
        "name": "get_case_attribute_values",
        "module": "pm4py",
        "category": "statistics",
        "description": "Count the occurrences of each value of a case-level attribute (e.g. a customer segment field).",
        "params": {
            "log": "EventLog",
            "attribute": "str — case attribute key",
        },
        "returns": "dict[str, int]",
        "pm4py_function": "pm4py.get_case_attribute_values",
    },
    # ── Visualization ────────────────────────────────────────────────────────
    {
        "name": "view_dfg",
        "module": "pm4py",
        "category": "visualization",
        "description": (
            "Render and display a DFG using pm4py's built-in Graphviz visualizer. "
            "Opens an image viewer or saves a PNG depending on the environment."
        ),
        "params": {
            "dfg": "dict",
            "start_activities": "dict",
            "end_activities": "dict",
        },
        "returns": "None (side-effect: opens viewer or saves file)",
        "pm4py_function": "pm4py.view_dfg",
    },
    {
        "name": "view_petri_net",
        "module": "pm4py",
        "category": "visualization",
        "description": "Render and display a Petri net with its initial and final markings via Graphviz.",
        "params": {
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
        },
        "returns": "None (side-effect: opens viewer)",
        "pm4py_function": "pm4py.view_petri_net",
    },
    {
        "name": "view_process_tree",
        "module": "pm4py",
        "category": "visualization",
        "description": "Render and display a process tree as a hierarchical diagram via Graphviz.",
        "params": {"tree": "ProcessTree"},
        "returns": "None (side-effect: opens viewer)",
        "pm4py_function": "pm4py.view_process_tree",
    },
    {
        "name": "view_bpmn",
        "module": "pm4py",
        "category": "visualization",
        "description": "Render and display a BPMN 2.0 model using pm4py's Graphviz visualizer.",
        "params": {"bpmn_graph": "BPMN"},
        "returns": "None (side-effect: opens viewer)",
        "pm4py_function": "pm4py.view_bpmn",
    },
    {
        "name": "save_vis_dfg",
        "module": "pm4py",
        "category": "visualization",
        "description": "Save a DFG visualization to a PNG file without opening a viewer window.",
        "params": {
            "dfg": "dict",
            "start_activities": "dict",
            "end_activities": "dict",
            "file_path": "str — output .png path",
        },
        "returns": "None",
        "pm4py_function": "pm4py.save_vis_dfg",
    },
    # ── IO ───────────────────────────────────────────────────────────────────
    {
        "name": "read_xes",
        "module": "pm4py",
        "category": "io",
        "description": "Read a .xes event log file (IEEE XES standard) and return a pm4py EventLog object.",
        "params": {"file_path": "str"},
        "returns": "EventLog",
        "pm4py_function": "pm4py.read_xes",
    },
    {
        "name": "write_xes",
        "module": "pm4py",
        "category": "io",
        "description": "Write a pm4py EventLog to a .xes file following the IEEE XES standard.",
        "params": {
            "log": "EventLog",
            "file_path": "str",
        },
        "returns": "None",
        "pm4py_function": "pm4py.write_xes",
    },
    {
        "name": "read_pnml",
        "module": "pm4py",
        "category": "io",
        "description": "Read a .pnml Petri Net Markup Language file and return (PetriNet, initial_marking, final_marking).",
        "params": {"file_path": "str"},
        "returns": "tuple[PetriNet, Marking, Marking]",
        "pm4py_function": "pm4py.read_pnml",
    },
    {
        "name": "write_pnml",
        "module": "pm4py",
        "category": "io",
        "description": "Write a Petri net with its markings to a .pnml file.",
        "params": {
            "petri_net": "PetriNet",
            "initial_marking": "Marking",
            "final_marking": "Marking",
            "file_path": "str",
        },
        "returns": "None",
        "pm4py_function": "pm4py.write_pnml",
    },
    {
        "name": "read_bpmn",
        "module": "pm4py",
        "category": "io",
        "description": "Read a BPMN 2.0 XML file and return a pm4py BPMN object.",
        "params": {"file_path": "str"},
        "returns": "BPMN",
        "pm4py_function": "pm4py.read_bpmn",
    },
    {
        "name": "write_bpmn",
        "module": "pm4py",
        "category": "io",
        "description": "Write a pm4py BPMN model to a BPMN 2.0 XML file.",
        "params": {
            "bpmn_graph": "BPMN",
            "file_path": "str",
        },
        "returns": "None",
        "pm4py_function": "pm4py.write_bpmn",
    },
    {
        "name": "convert_to_event_log",
        "module": "pm4py",
        "category": "io",
        "description": "Convert a pandas DataFrame (formatted with format_dataframe) to a pm4py EventLog object.",
        "params": {"df": "pandas.DataFrame (pre-formatted)"},
        "returns": "EventLog",
        "pm4py_function": "pm4py.convert_to_event_log",
    },
    {
        "name": "format_dataframe",
        "module": "pm4py",
        "category": "io",
        "description": (
            "Annotate a pandas DataFrame with pm4py metadata so it can be used as an event log. "
            "Maps column names for case_id, activity_key, and timestamp_key."
        ),
        "params": {
            "df": "pandas.DataFrame",
            "case_id": "str — column for case identifier",
            "activity_key": "str — column for activity names",
            "timestamp_key": "str — column for timestamps",
        },
        "returns": "pandas.DataFrame (annotated)",
        "pm4py_function": "pm4py.format_dataframe",
    },
]

FUNCTION_MAP: Dict[str, Dict[str, Any]] = {f["name"]: f for f in FUNCTION_REGISTRY}
CATEGORIES: List[str] = sorted({f["category"] for f in FUNCTION_REGISTRY})
