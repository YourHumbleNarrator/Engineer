import { PMLibraryFunction } from '../types/processMining';

export const PM_LIBRARY_CATALOG: PMLibraryFunction[] = [
  // ── pm4py (synced with YourHumbleNarrator/Engineer pm_registry.py) ───────────
  {
    name: 'discover_dfg',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a Directly-Follows Graph (DFG) from an event log. Returns (dfg_dict, start_activities, end_activities) mapping activity pairs to occurrence counts.',
    params: { log: 'EventLog | DataFrame' },
    returns: 'tuple[dict, dict, dict]',
    pm4py_function: 'pm4py.discover_dfg',
    executable: true,
  },
  {
    name: 'discover_performance_dfg',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a performance DFG annotated with mean, median, min, and max sojourn times (in seconds) between consecutive activities.',
    params: { log: 'EventLog | DataFrame' },
    returns: 'tuple[dict, dict, dict]',
    pm4py_function: 'pm4py.discover_performance_dfg',
    executable: true,
  },
  {
    name: 'discover_petri_net_alpha',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a Petri net using the Alpha Miner algorithm. Best suited for structured, noise-free event logs without complex loops.',
    params: { log: 'EventLog | DataFrame' },
    returns: 'tuple[PetriNet, Marking, Marking]',
    pm4py_function: 'pm4py.discover_petri_net_alpha',
    executable: true,
  },
  {
    name: 'discover_petri_net_inductive',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a sound (deadlock-free) Petri net using the Inductive Miner algorithm. Supports noise_threshold (0-1) to filter infrequent variants.',
    params: { log: 'EventLog | DataFrame', noise_threshold: 'float (0-1, default 0.0)' },
    returns: 'tuple[PetriNet, Marking, Marking]',
    pm4py_function: 'pm4py.discover_petri_net_inductive',
    executable: true,
  },
  {
    name: 'discover_petri_net_heuristics',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a Petri net using the Heuristics Miner. Robust to real-world noise with frequency-based dependency thresholds.',
    params: {
      log: 'EventLog | DataFrame',
      dependency_threshold: 'float (default 0.5)',
      and_threshold: 'float (default 0.65)',
    },
    returns: 'tuple[PetriNet, Marking, Marking]',
    pm4py_function: 'pm4py.discover_petri_net_heuristics',
    executable: true,
  },
  {
    name: 'discover_process_tree_inductive',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a hierarchical Process Tree using the Inductive Miner with SEQ (→), XOR (×), AND (∧), and LOOP (↺) operators.',
    params: { log: 'EventLog | DataFrame', noise_threshold: 'float (default 0.0)' },
    returns: 'ProcessTree',
    pm4py_function: 'pm4py.discover_process_tree_inductive',
    executable: true,
  },
  {
    name: 'discover_bpmn_inductive',
    module: 'pm4py',
    category: 'discovery',
    description:
      'Discover a BPMN 2.0 model using the Inductive Miner by first constructing a Process Tree and converting it to BPMN notation.',
    params: { log: 'EventLog | DataFrame', noise_threshold: 'float (default 0.0)' },
    returns: 'BPMN',
    pm4py_function: 'pm4py.discover_bpmn_inductive',
    executable: true,
  },
  {
    name: 'get_variants',
    module: 'pm4py',
    category: 'statistics',
    description:
      'Extract all unique trace variants from the event log, returning a mapping of activity sequence tuples to case counts.',
    params: { log: 'EventLog' },
    returns: 'dict[tuple, list[Trace]]',
    pm4py_function: 'pm4py.get_variants',
    executable: true,
  },
  {
    name: 'get_start_activities',
    module: 'pm4py',
    category: 'statistics',
    description: 'Count activities appearing as the first event in a process case.',
    params: { log: 'EventLog | DataFrame' },
    returns: 'dict[str, int]',
    pm4py_function: 'pm4py.get_start_activities',
    executable: true,
  },
  {
    name: 'get_end_activities',
    module: 'pm4py',
    category: 'statistics',
    description: 'Count activities appearing as the final event in a process case.',
    params: { log: 'EventLog | DataFrame' },
    returns: 'dict[str, int]',
    pm4py_function: 'pm4py.get_end_activities',
    executable: true,
  },
  {
    name: 'conformance_diagnostics_token_based_replay',
    module: 'pm4py',
    category: 'conformance',
    description:
      'Replay each event log trace on a Petri net to measure missing/remaining tokens and per-trace fitness.',
    params: { log: 'EventLog', petri_net: 'PetriNet', im: 'Marking', fm: 'Marking' },
    returns: 'list[dict]',
    pm4py_function: 'pm4py.conformance_diagnostics_token_based_replay',
    executable: false,
  },
  {
    name: 'filter_variants_top_k',
    module: 'pm4py',
    category: 'filtering',
    description: 'Keep only the top-K most frequent trace variants in the event log.',
    params: { log: 'EventLog', k: 'int' },
    returns: 'EventLog',
    pm4py_function: 'pm4py.filter_variants_top_k',
    executable: false,
  },
  {
    name: 'view_dfg',
    module: 'pm4py',
    category: 'visualization',
    description: "Render a Directly-Follows Graph using pm4py's native Graphviz renderer.",
    params: { dfg: 'dict', start_activities: 'dict', end_activities: 'dict' },
    returns: 'PNG Image',
    pm4py_function: 'pm4py.view_dfg',
    executable: true,
  },

  // ── pm4js ────────────────────────────────────────────────────────────────────
  {
    name: 'DFGDiscovery.apply',
    module: 'pm4js',
    category: 'discovery',
    description:
      'Browser-native JavaScript DFG discovery from parsed XES/CSV event logs. Computes frequency & performance edges directly in client memory.',
    params: { eventLog: 'EventLog', classifier: 'string' },
    returns: 'DirectlyFollowsGraph',
    pm4py_function: 'pm4js.DFGDiscovery.apply',
    executable: true,
  },
  {
    name: 'InductiveMiner.apply',
    module: 'pm4js',
    category: 'discovery',
    description:
      'Client-side Inductive Miner in TypeScript/JS producing a sound Process Tree and Accepting Petri Net without server round-trips.',
    params: { eventLog: 'EventLog', noiseThreshold: 'number (0-1)' },
    returns: 'ProcessTree',
    pm4py_function: 'pm4js.InductiveMiner.apply',
    executable: true,
  },
  {
    name: 'AlphaMiner.apply',
    module: 'pm4js',
    category: 'discovery',
    description:
      'Classic Alpha footprint discovery in JS extracting causal, parallel, and choice relations into a Petri net.',
    params: { eventLog: 'EventLog' },
    returns: 'AcceptingPetriNet',
    pm4py_function: 'pm4js.AlphaMiner.apply',
    executable: true,
  },
  {
    name: 'TokenBasedReplay.apply',
    module: 'pm4js',
    category: 'conformance',
    description:
      'Fast in-browser token replay evaluating trace fitness against the active Petri net marking.',
    params: { eventLog: 'EventLog', acceptingPetriNet: 'AcceptingPetriNet' },
    returns: 'ConformanceReport',
    pm4py_function: 'pm4js.TokenBasedReplay.apply',
    executable: true,
  },

  // ── bupaR (via Engineer R bridge) ───────────────────────────────────────────
  {
    name: 'process_map',
    module: 'bupar',
    category: 'visualization',
    description:
      'Generate a processmapR frequency or performance DFG via the Engineer R bridge (requires R_ENABLED=true on backend).',
    params: { eventlog: 'eventlog', type: "frequency('absolute') | performance(mean)" },
    returns: 'DFGGraph JSON / DiagrammeR',
    pm4py_function: 'processmapR::process_map',
    executable: true,
  },
  {
    name: 'precedence_matrix',
    module: 'bupar',
    category: 'statistics',
    description:
      'Compute a two-dimensional antecedent-consequent matrix of activity transitions across all traces in R.',
    params: { eventlog: 'eventlog', type: "'absolute' | 'relative'" },
    returns: 'Matrix',
    pm4py_function: 'processmapR::precedence_matrix',
    executable: true,
  },
  {
    name: 'trace_explorer',
    module: 'bupar',
    category: 'statistics',
    description:
      'Rank and inspect the most common process execution sequences and coverage percentages using edeaR.',
    params: { eventlog: 'eventlog', coverage: 'numeric (0-1)' },
    returns: 'TraceCoverageTable',
    pm4py_function: 'processmapR::trace_explorer',
    executable: false,
  },
  {
    name: 'throughput_time',
    module: 'bupar',
    category: 'statistics',
    description:
      'Calculate end-to-end case cycle times (min, median, mean, IQR, max) in bupaR / edeaR.',
    params: { eventlog: 'eventlog', level: "'log' | 'case'", units: "'hours' | 'days'" },
    returns: 'SummaryStats',
    pm4py_function: 'edeaR::throughput_time',
    executable: false,
  },

  // ── bpmn-js ──────────────────────────────────────────────────────────────────
  {
    name: 'BpmnModeler.importXML',
    module: 'bpmn-js',
    category: 'io',
    description:
      'Parse BPMN 2.0 XML definitions into the semantic element registry and render BPMN shapes and sequence flows.',
    params: { xml: 'string (BPMN 2.0 XML)' },
    returns: 'Promise<ImportXMLResult>',
    pm4py_function: 'bpmnJS.importXML',
    executable: true,
  },
  {
    name: 'BpmnModeler.saveXML',
    module: 'bpmn-js',
    category: 'io',
    description:
      'Serialize the active BPMN graph (with swimlanes, gateways, and DI coordinates) to standard BPMN 2.0 XML.',
    params: { format: 'boolean (pretty-print)' },
    returns: 'string (BPMN 2.0 XML)',
    pm4py_function: 'bpmnJS.saveXML',
    executable: true,
  },
  {
    name: 'BpmnModeler.saveSVG',
    module: 'bpmn-js',
    category: 'visualization',
    description:
      'Export the BPMN diagram canvas as a clean, scalable vector SVG document ready for publication.',
    params: { graph: 'BPMNGraph' },
    returns: 'string (SVG)',
    pm4py_function: 'bpmnJS.saveSVG',
    executable: true,
  },
  {
    name: 'ElementRegistry.validateFlows',
    module: 'bpmn-js',
    category: 'conformance',
    description:
      'Inspect BPMN node connectivity for disconnected tasks, missing start/end events, or unbalanced gateways.',
    params: { bpmnGraph: 'BPMNGraph' },
    returns: 'ValidationReport',
    pm4py_function: 'bpmnJS.validateFlows',
    executable: true,
  },
];
