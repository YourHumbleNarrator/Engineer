// Mirrors app/models/graph.py & app/models/requests.py in YourHumbleNarrator/Engineer

export type GraphKind = 'dfg' | 'petri_net' | 'process_tree' | 'bpmn';

export type InteractionMode = 'static' | 'inspect' | 'edit';

export type LayoutOrientation = 'auto' | 'LR' | 'TB';

export type LayoutAlgorithm =
  | 'auto'
  | 'sugiyama'
  | 'backbone_spine'
  | 'stress_majorization'
  | 'tree_hierarchy';

export type EdgeRoutingStyle = 'auto' | 'curved' | 'orthogonal' | 'bundled';

export type CrossingMinLevel = 'auto' | 'standard' | 'intensive';

export interface LayoutConfig {
  algorithm: LayoutAlgorithm;
  orientation: LayoutOrientation;
  edgeRouting: EdgeRoutingStyle;
  crossingMin: CrossingMinLevel;
  spacingScale: number | null; // null = auto-selected based on graph density
  highlightBackbone: boolean | null; // null = auto-selected based on edge volume & skew
  forcePlanar?: boolean; // when graph is planar, forces a 0-crossing planar visualization
  chunkLongGraph?: boolean; // divides very long graphs into compact rows/columns to fit in one view
}

export type PlanarityStatus = 'planar_verified' | 'near_planar' | 'non_planar_euler';

export interface Activity {
  id: string;
  label: string;
  count: number;
  meanDurationSec?: number | null;
}

export interface DFGEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  meanDurationSec?: number | null;
}

export interface DFGGraph {
  kind: 'dfg';
  id: string;
  name: string;
  activities: Activity[];
  startActivities: Record<string, number>;
  endActivities: Record<string, number>;
  edges: DFGEdge[];
}

export interface Place {
  id: string;
  label: string;
  initialTokens: number;
  isFinal: boolean;
}

export interface Transition {
  id: string;
  label: string;
  silent: boolean;
  frequency?: number | null;
}

export interface Arc {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface PetriNetGraph {
  kind: 'petri_net';
  id: string;
  name: string;
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
}

export type ProcessTreeOperator = 'seq' | 'xor' | 'and' | 'loop' | 'or';

export interface ProcessTreeNode {
  id: string;
  type: 'operator' | 'activity' | 'tau';
  label?: string | null;
  operator?: ProcessTreeOperator | null;
  children: ProcessTreeNode[];
  frequency?: number | null;
}

export interface ProcessTreeGraph {
  kind: 'process_tree';
  id: string;
  name: string;
  root: ProcessTreeNode;
}

export type BPMNNodeType =
  | 'startEvent'
  | 'endEvent'
  | 'intermediateEvent'
  | 'task'
  | 'xorGateway'
  | 'andGateway'
  | 'orGateway';

export interface BPMNNode {
  id: string;
  type: BPMNNodeType;
  label?: string | null;
  laneId?: string | null;
}

export interface BPMNEdge {
  id: string;
  source: string;
  target: string;
  label?: string | null;
}

export interface BPMNLane {
  id: string;
  label: string;
}

export interface BPMNGraph {
  kind: 'bpmn';
  id: string;
  name: string;
  nodes: BPMNNode[];
  edges: BPMNEdge[];
  lanes: BPMNLane[];
}

export type GraphObject = DFGGraph | PetriNetGraph | ProcessTreeGraph | BPMNGraph;

export interface DiscoverRequest {
  algorithm: 'alpha' | 'inductive' | 'heuristics';
  output: GraphKind;
  graph_id?: string | null;
  graph_name?: string | null;
  case_id_col: string;
  activity_col: string;
  timestamp_col: string;
  use_r: boolean;
}

export type SimplificationAlgorithm = 'filter_dfg' | 'abstraction' | 'merge_parallel';

export interface SimplifyRequest {
  graph_id: string;
  algorithm: SimplificationAlgorithm;
  threshold: number;
  params: Record<string, unknown>;
}

export interface PMLibraryFunction {
  name: string;
  module: 'pm4py' | 'pm4js' | 'bupar' | 'bpmn-js';
  category: 'discovery' | 'conformance' | 'filtering' | 'statistics' | 'visualization' | 'io';
  description: string;
  params: Record<string, string>;
  returns: string;
  pm4py_function: string;
  executable?: boolean;
}

export interface PMFunctionExecutionResult {
  functionName: string;
  module: string;
  timestamp: string;
  image_format?: string;
  image_base64?: string;
  svg_markup?: string;
  result?: unknown;
  message?: string;
}

export interface LayoutRuleSummary {
  resolvedAlgorithm: Exclude<LayoutAlgorithm, 'auto'>;
  resolvedOrientation: 'LR' | 'TB';
  resolvedRouting: Exclude<EdgeRoutingStyle, 'auto'>;
  resolvedCrossingMin: Exclude<CrossingMinLevel, 'auto'>;
  resolvedSpacingScale: number;
  resolvedHighlightBackbone: boolean;
  defaultSpacingScale: number;
  defaultHighlightBackbone: boolean;
  forcePlanarActive?: boolean;
  chunkLongGraphActive?: boolean;
  orientationApplicable: boolean;
  crossingApplicable: boolean;
  availableAlgorithms: Array<Exclude<LayoutAlgorithm, 'auto'>>;
  availableRoutings: Array<Exclude<EdgeRoutingStyle, 'auto'>>;
  autoReasons: {
    algorithm: string;
    orientation: string;
    routing: string;
    crossingMin: string;
    backbone: string;
    spacing: string;
  };
  densityClass: 'sparse' | 'small_dense' | 'balanced' | 'large_dense';
  planarityStatus: PlanarityStatus;
  planarityReason: string;
  undirectedEdgeCount: number;
  maxPlanarEdges: number;
  isBipartite: boolean;
  avgDegree: number;
  rankCount: number;
  maxRankBreadth: number;
  backEdgeCount: number;
  selfLoopCount: number;
  bidirectionalPairs: number;
  crossingEstimate: number;
  appliedRules: Array<{ rule: string; reason: string; worksFor: string }>;
}

export interface GraphStats {
  kind: GraphKind;
  nodeCount: number;
  edgeCount: number;
  density: number;
  details: Array<{ label: string; value: string | number }>;
}

export interface SelectedElement {
  kind: 'node' | 'edge';
  id: string;
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string | number }>;
  incoming?: string[];
  outgoing?: string[];
}

export interface EventTrace {
  caseId: string;
  events: Array<{
    activity: string;
    timestamp: string;
    resource?: string;
  }>;
}

export interface SampleDataset {
  id: string;
  name: string;
  description: string;
  profileTag: string;
  tracesCount: number;
  eventsCount: number;
  traces: EventTrace[];
  graphs: Partial<Record<GraphKind, GraphObject>>;
}
