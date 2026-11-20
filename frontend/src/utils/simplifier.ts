import {
  BPMNGraph,
  DFGGraph,
  EventTrace,
  GraphObject,
  GraphStats,
  PetriNetGraph,
  ProcessTreeGraph,
  ProcessTreeNode,
  SimplificationAlgorithm,
} from '../types/processMining';

export interface GraphFilterOptions {
  edgeFrequencyPct: number; // 0..0.95
  minNodeFrequency: number; // 0+
  attributeMode: 'include' | 'exclude';
  selectedActivities: string[];
  selectedLanes: string[];
  includeSilent: boolean;
}

export function applyGraphFilters(
  graph: GraphObject,
  filters: GraphFilterOptions
): GraphObject {
  const selectedSet = new Set(filters.selectedActivities);
  const hasActivityFilter = selectedSet.size > 0;
  const matchesActivity = (label: string) => {
    if (!hasActivityFilter) return true;
    return filters.attributeMode === 'include'
      ? selectedSet.has(label)
      : !selectedSet.has(label);
  };

  if (graph.kind === 'dfg') {
    const maxEdgeCount = Math.max(...graph.edges.map((e) => e.count), 1);
    const minEdgeCount = Math.floor(maxEdgeCount * filters.edgeFrequencyPct);

    // 1. Attribute & node-frequency filter on activities
    const eligibleActivities = graph.activities.filter(
      (a) => a.count >= filters.minNodeFrequency && matchesActivity(a.label)
    );
    const eligibleIds = new Set(eligibleActivities.map((a) => a.id));

    // 2. Edge frequency filter
    const keptEdges = graph.edges.filter(
      (e) =>
        eligibleIds.has(e.source) &&
        eligibleIds.has(e.target) &&
        e.count >= minEdgeCount
    );

    // 3. Prune isolated nodes if edge frequency threshold pruned edges
    const connected = new Set<string>();
    keptEdges.forEach((e) => {
      connected.add(e.source);
      connected.add(e.target);
    });

    const keptActivities =
      filters.edgeFrequencyPct > 0
        ? eligibleActivities.filter((a) => connected.has(a.id))
        : eligibleActivities;

    const keptIds = new Set(keptActivities.map((a) => a.id));
    const incoming = new Set(keptEdges.map((e) => e.target));
    const outgoing = new Set(keptEdges.map((e) => e.source));

    const startActivities: Record<string, number> = {};
    const endActivities: Record<string, number> = {};
    keptActivities.forEach((a) => {
      if (graph.startActivities[a.id] && keptIds.has(a.id)) {
        startActivities[a.id] = graph.startActivities[a.id];
      } else if (!incoming.has(a.id) && keptEdges.length > 0) {
        startActivities[a.id] = a.count;
      }
      if (graph.endActivities[a.id] && keptIds.has(a.id)) {
        endActivities[a.id] = graph.endActivities[a.id];
      } else if (!outgoing.has(a.id) && keptEdges.length > 0) {
        endActivities[a.id] = a.count;
      }
    });

    return {
      ...graph,
      activities: keptActivities,
      edges: keptEdges,
      startActivities,
      endActivities,
    };
  }

  if (graph.kind === 'petri_net') {
    const keptTransitions = graph.transitions.filter((t) => {
      if (t.silent && !filters.includeSilent) return false;
      if (!t.silent && !matchesActivity(t.label)) return false;
      if (t.frequency !== undefined && t.frequency !== null && t.frequency < filters.minNodeFrequency) {
        return false;
      }
      return true;
    });
    const transIds = new Set(keptTransitions.map((t) => t.id));
    const keptArcs = graph.arcs.filter(
      (a) => transIds.has(a.source) || transIds.has(a.target)
    );
    const connectedPlaceIds = new Set<string>();
    keptArcs.forEach((a) => {
      if (!transIds.has(a.source)) connectedPlaceIds.add(a.source);
      if (!transIds.has(a.target)) connectedPlaceIds.add(a.target);
    });
    const keptPlaces = graph.places.filter(
      (p) => connectedPlaceIds.has(p.id) || p.initialTokens > 0 || p.isFinal
    );
    const placeIds = new Set(keptPlaces.map((p) => p.id));
    const validArcs = keptArcs.filter(
      (a) =>
        (transIds.has(a.source) && placeIds.has(a.target)) ||
        (placeIds.has(a.source) && transIds.has(a.target))
    );

    const out: PetriNetGraph = {
      ...graph,
      places: keptPlaces,
      transitions: keptTransitions,
      arcs: validArcs,
    };
    return out;
  }

  if (graph.kind === 'process_tree') {
    const pruneTree = (node: ProcessTreeNode): ProcessTreeNode | null => {
      if (node.type === 'tau') {
        if (!filters.includeSilent) return null;
        if (node.frequency !== undefined && node.frequency !== null && node.frequency < filters.minNodeFrequency) {
          return null;
        }
        return node;
      }
      if (node.type === 'activity') {
        if (!matchesActivity(node.label || node.id)) return null;
        if (node.frequency !== undefined && node.frequency !== null && node.frequency < filters.minNodeFrequency) {
          return null;
        }
        return node;
      }
      const nextChildren = node.children
        .map(pruneTree)
        .filter((c): c is ProcessTreeNode => c !== null);
      if (nextChildren.length === 0) return null;
      if (nextChildren.length === 1) return nextChildren[0];
      return { ...node, children: nextChildren };
    };

    const nextRoot = pruneTree(graph.root) || graph.root;
    const out: ProcessTreeGraph = {
      ...graph,
      root: nextRoot,
    };
    return out;
  }

  // BPMN
  const laneSet = new Set(filters.selectedLanes);
  const hasLaneFilter = laneSet.size > 0;
  const keptNodes = graph.nodes.filter((n) => {
    if (hasLaneFilter && n.laneId && !laneSet.has(n.laneId)) return false;
    if (n.type === 'task' && !matchesActivity(n.label || n.id)) return false;
    return true;
  });
  const keptNodeIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = graph.edges.filter(
    (e) => keptNodeIds.has(e.source) && keptNodeIds.has(e.target)
  );
  const activeLaneIds = new Set(keptNodes.map((n) => n.laneId).filter(Boolean));
  const keptLanes = graph.lanes.filter((l) => activeLaneIds.has(l.id));

  const out: BPMNGraph = {
    ...graph,
    nodes: keptNodes,
    edges: keptEdges,
    lanes: keptLanes,
  };
  return out;
}

export function simplifyGraphClient(
  graph: GraphObject,
  algorithm: SimplificationAlgorithm,
  threshold: number,
  params: Record<string, unknown> = {}
): GraphObject {
  if (algorithm === 'filter_dfg') {
    if (graph.kind !== 'dfg') return graph;
    return filterDfg(graph, threshold, params);
  }
  if (algorithm === 'abstraction') {
    return abstractLowFreqActivities(graph, threshold, params);
  }
  if (algorithm === 'merge_parallel') {
    if (graph.kind !== 'dfg') return graph;
    return mergeParallelDfg(graph, threshold, params);
  }
  return graph;
}

function filterDfg(
  graph: DFGGraph,
  threshold: number,
  params: Record<string, unknown>
): DFGGraph {
  if (graph.edges.length === 0) return graph;
  const maxCount = Math.max(...graph.edges.map((e) => e.count), 1);
  const absRaw = params.absolute_threshold;
  const minCount =
    typeof absRaw === 'number' && !Number.isNaN(absRaw) && absRaw > 0
      ? absRaw
      : Math.floor(maxCount * threshold);

  const keptEdges = graph.edges.filter((e) => e.count >= minCount);
  const connected = new Set<string>();
  keptEdges.forEach((e) => {
    connected.add(e.source);
    connected.add(e.target);
  });

  const keptActivities =
    threshold === 0 && !absRaw
      ? graph.activities
      : graph.activities.filter((a) => connected.has(a.id));

  const keptIds = new Set(keptActivities.map((a) => a.id));
  const incoming = new Set(keptEdges.map((e) => e.target));
  const outgoing = new Set(keptEdges.map((e) => e.source));

  const startActivities: Record<string, number> = {};
  const endActivities: Record<string, number> = {};
  keptActivities.forEach((a) => {
    if (graph.startActivities[a.id] && keptIds.has(a.id)) {
      startActivities[a.id] = graph.startActivities[a.id];
    } else if (!incoming.has(a.id) && keptEdges.length > 0) {
      startActivities[a.id] = a.count;
    }
    if (graph.endActivities[a.id] && keptIds.has(a.id)) {
      endActivities[a.id] = graph.endActivities[a.id];
    } else if (!outgoing.has(a.id) && keptEdges.length > 0) {
      endActivities[a.id] = a.count;
    }
  });

  return {
    ...graph,
    activities: keptActivities,
    edges: keptEdges,
    startActivities,
    endActivities,
  };
}

function abstractLowFreqActivities(
  graph: GraphObject,
  threshold: number,
  params: Record<string, unknown>
): GraphObject {
  if (graph.kind !== 'dfg') return graph;
  const label = typeof params.label === 'string' && params.label.trim() ? params.label.trim() : 'OTHER';
  const strategy = params.strategy === 'remove' ? 'remove' : 'merge';

  const counts = graph.activities.map((a) => a.count).sort((a, b) => a - b);
  if (counts.length === 0 || threshold <= 0) return graph;
  const cutoffIdx = Math.min(counts.length - 1, Math.floor(counts.length * threshold));
  const cutoffVal = counts[cutoffIdx];

  const rareIds = new Set(graph.activities.filter((a) => a.count <= cutoffVal).map((a) => a.id));
  if (rareIds.size === 0 || rareIds.size === graph.activities.length) return graph;

  if (strategy === 'remove') {
    const activities = graph.activities.filter((a) => !rareIds.has(a.id));
    const edges = graph.edges.filter((e) => !rareIds.has(e.source) && !rareIds.has(e.target));
    const startActivities = Object.fromEntries(
      Object.entries(graph.startActivities).filter(([k]) => !rareIds.has(k))
    );
    const endActivities = Object.fromEntries(
      Object.entries(graph.endActivities).filter(([k]) => !rareIds.has(k))
    );
    return {
      ...graph,
      activities,
      edges,
      startActivities,
      endActivities,
    };
  }

  const abstractId = '__abstract_other__';
  const rareCount = graph.activities
    .filter((a) => rareIds.has(a.id))
    .reduce((acc, a) => acc + a.count, 0);

  const activities = [
    ...graph.activities.filter((a) => !rareIds.has(a.id)),
    { id: abstractId, label: `${label} (${rareIds.size})`, count: rareCount },
  ];

  const mergedEdges = new Map<string, DFGGraph['edges'][number]>();
  for (const edge of graph.edges) {
    const src = rareIds.has(edge.source) ? abstractId : edge.source;
    const tgt = rareIds.has(edge.target) ? abstractId : edge.target;
    if (src === abstractId && tgt === abstractId) continue;
    const key = `${src}|||${tgt}`;
    const existing = mergedEdges.get(key);
    if (existing) {
      existing.count += edge.count;
    } else {
      mergedEdges.set(key, {
        id: `abs_${mergedEdges.size}`,
        source: src,
        target: tgt,
        count: edge.count,
        meanDurationSec: edge.meanDurationSec,
      });
    }
  }

  const startActivities: Record<string, number> = {};
  Object.entries(graph.startActivities).forEach(([k, v]) => {
    const key = rareIds.has(k) ? abstractId : k;
    startActivities[key] = (startActivities[key] || 0) + v;
  });

  const endActivities: Record<string, number> = {};
  Object.entries(graph.endActivities).forEach(([k, v]) => {
    const key = rareIds.has(k) ? abstractId : k;
    endActivities[key] = (endActivities[key] || 0) + v;
  });

  return {
    ...graph,
    activities,
    edges: Array.from(mergedEdges.values()),
    startActivities,
    endActivities,
  };
}

function mergeParallelDfg(
  graph: DFGGraph,
  threshold: number,
  params: Record<string, unknown>
): DFGGraph {
  const edgeLookup = new Map<string, DFGGraph['edges'][number]>();
  graph.edges.forEach((e) => edgeLookup.set(`${e.source}|||${e.target}`, e));

  const maxMergeSize = typeof params.max_merge_size === 'number' ? params.max_merge_size : 3;
  const mergedInto = new Map<string, string>();
  const newActivities = [...graph.activities];

  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    if (mergedInto.has(e.source) || mergedInto.has(e.target)) continue;
    const reverse = edgeLookup.get(`${e.target}|||${e.source}`);
    if (!reverse) continue;

    const minCnt = Math.min(e.count, reverse.count);
    const maxCnt = Math.max(e.count, reverse.count, 1);
    const overlapRatio = minCnt / maxCnt;

    if (overlapRatio >= threshold && maxMergeSize >= 2) {
      const a1 = graph.activities.find((a) => a.id === e.source);
      const a2 = graph.activities.find((a) => a.id === e.target);
      if (!a1 || !a2) continue;

      const blockId = `par_${a1.id}_${a2.id}`;
      mergedInto.set(a1.id, blockId);
      mergedInto.set(a2.id, blockId);
      newActivities.push({
        id: blockId,
        label: `AND(${a1.label} ∧ ${a2.label})`,
        count: Math.round((a1.count + a2.count) / 2),
      });
    }
  }

  if (mergedInto.size === 0) return graph;

  const activities = newActivities.filter((a) => !mergedInto.has(a.id));
  const edgeMap = new Map<string, DFGGraph['edges'][number]>();
  graph.edges.forEach((e) => {
    const s = mergedInto.get(e.source) || e.source;
    const t = mergedInto.get(e.target) || e.target;
    if (s === t) return;
    const key = `${s}|||${t}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += e.count;
    } else {
      edgeMap.set(key, {
        id: `mp_${edgeMap.size}`,
        source: s,
        target: t,
        count: e.count,
        meanDurationSec: e.meanDurationSec,
      });
    }
  });

  return {
    ...graph,
    activities,
    edges: Array.from(edgeMap.values()),
  };
}

export function computeGraphStats(graph: GraphObject): GraphStats {
  if (graph.kind === 'dfg') {
    const n = graph.activities.length;
    const m = graph.edges.length;
    const maxPossible = n > 1 ? n * (n - 1) : 1;
    const maxFreq = Math.max(...graph.edges.map((e) => e.count), 0);
    const totalEvents = graph.activities.reduce((acc, a) => acc + a.count, 0);
    return {
      kind: 'dfg',
      nodeCount: n,
      edgeCount: m,
      density: Number((m / maxPossible).toFixed(3)),
      details: [
        { label: 'Activities', value: n },
        { label: 'Directed Edges', value: m },
        { label: 'Start Activities', value: Object.keys(graph.startActivities).length },
        { label: 'End Activities', value: Object.keys(graph.endActivities).length },
        { label: 'Max Edge Frequency', value: maxFreq },
        { label: 'Total Activity Executions', value: totalEvents },
      ],
    };
  }

  if (graph.kind === 'petri_net') {
    const n = graph.places.length + graph.transitions.length;
    const m = graph.arcs.length;
    const silentCount = graph.transitions.filter((t) => t.silent).length;
    const initialTokens = graph.places.reduce((acc, p) => acc + p.initialTokens, 0);
    const finalPlaces = graph.places.filter((p) => p.isFinal).length;
    return {
      kind: 'petri_net',
      nodeCount: n,
      edgeCount: m,
      density: Number((m / Math.max(1, n * (n - 1))).toFixed(3)),
      details: [
        { label: 'Places', value: graph.places.length },
        { label: 'Observable Transitions', value: graph.transitions.length - silentCount },
        { label: 'Silent Transitions (τ)', value: silentCount },
        { label: 'Arcs', value: m },
        { label: 'Initial Marking Tokens', value: initialTokens },
        { label: 'Final Marking Places', value: finalPlaces },
      ],
    };
  }

  if (graph.kind === 'process_tree') {
    let totalNodes = 0;
    let operators = 0;
    let activities = 0;
    let taus = 0;
    let maxDepth = 0;
    const walk = (node: ProcessTreeNode, depth: number) => {
      totalNodes += 1;
      maxDepth = Math.max(maxDepth, depth);
      if (node.type === 'operator') operators += 1;
      else if (node.type === 'activity') activities += 1;
      else taus += 1;
      node.children.forEach((c) => walk(c, depth + 1));
    };
    walk(graph.root, 1);
    const edges = Math.max(0, totalNodes - 1);
    return {
      kind: 'process_tree',
      nodeCount: totalNodes,
      edgeCount: edges,
      density: Number((edges / Math.max(1, totalNodes * (totalNodes - 1))).toFixed(3)),
      details: [
        { label: 'Total Tree Nodes', value: totalNodes },
        { label: 'Control Operators', value: operators },
        { label: 'Leaf Activities', value: activities },
        { label: 'Silent Leaves (τ)', value: taus },
        { label: 'Tree Depth', value: maxDepth },
        { label: 'Tree Branches', value: edges },
      ],
    };
  }

  const tasks = graph.nodes.filter((n) => n.type === 'task').length;
  const gateways = graph.nodes.filter((n) => n.type.endsWith('Gateway')).length;
  const events = graph.nodes.filter((n) => n.type.endsWith('Event')).length;
  const n = graph.nodes.length;
  const m = graph.edges.length;
  return {
    kind: 'bpmn',
    nodeCount: n,
    edgeCount: m,
    density: Number((m / Math.max(1, n * (n - 1))).toFixed(3)),
    details: [
      { label: 'BPMN Tasks', value: tasks },
      { label: 'Gateways (XOR / AND / OR)', value: gateways },
      { label: 'Events (Start / End / Int)', value: events },
      { label: 'Sequence Flows', value: m },
      { label: 'Swimlanes', value: graph.lanes.length },
      { label: 'Total Elements', value: n },
    ],
  };
}

export function computeLogStatsFromTraces(
  traces: EventTrace[],
  fnName: string
): Record<string, number> {
  if (fnName === 'get_variants') {
    const out: Record<string, number> = {};
    traces.forEach((t) => {
      const key = t.events.map((e) => e.activity).join(' → ');
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  }
  if (fnName === 'get_start_activities') {
    const out: Record<string, number> = {};
    traces.forEach((t) => {
      if (t.events[0]) out[t.events[0].activity] = (out[t.events[0].activity] || 0) + 1;
    });
    return out;
  }
  if (fnName === 'get_end_activities') {
    const out: Record<string, number> = {};
    traces.forEach((t) => {
      const last = t.events[t.events.length - 1];
      if (last) out[last.activity] = (out[last.activity] || 0) + 1;
    });
    return out;
  }
  return {};
}

export function validateBpmnFlows(graph: BPMNGraph) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  graph.nodes.forEach((n) => {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  });
  graph.edges.forEach((e) => {
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
    outgoing.set(e.source, (outgoing.get(e.source) || 0) + 1);
  });

  const issues: string[] = [];
  const startEvents = graph.nodes.filter((n) => n.type === 'startEvent');
  const endEvents = graph.nodes.filter((n) => n.type === 'endEvent');
  if (startEvents.length === 0) issues.push('Missing Start Event.');
  if (endEvents.length === 0) issues.push('Missing End Event.');

  graph.nodes.forEach((n) => {
    const inc = incoming.get(n.id) || 0;
    const out = outgoing.get(n.id) || 0;
    if (n.type !== 'startEvent' && inc === 0) {
      issues.push(`Unreachable element "${n.label || n.id}" (0 incoming flows).`);
    }
    if (n.type !== 'endEvent' && out === 0) {
      issues.push(`Dead-end element "${n.label || n.id}" (0 outgoing flows).`);
    }
  });

  return {
    valid: issues.length === 0,
    totalElements: graph.nodes.length,
    sequenceFlows: graph.edges.length,
    issues,
  };
}

export function exportBpmnToXml(graph: BPMNGraph): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nodeTag = (n: BPMNGraph['nodes'][number]) => {
    const tagMap: Record<string, string> = {
      startEvent: 'bpmn:startEvent',
      endEvent: 'bpmn:endEvent',
      intermediateEvent: 'bpmn:intermediateThrowEvent',
      task: 'bpmn:task',
      xorGateway: 'bpmn:exclusiveGateway',
      andGateway: 'bpmn:parallelGateway',
      orGateway: 'bpmn:inclusiveGateway',
    };
    const tag = tagMap[n.type] || 'bpmn:task';
    return `    <${tag} id="${esc(n.id)}" name="${esc(n.label || '')}" />`;
  };
  const edgeTag = (e: BPMNGraph['edges'][number]) =>
    `    <bpmn:sequenceFlow id="${esc(e.id)}" sourceRef="${esc(e.source)}" targetRef="${esc(e.target)}"${
      e.label ? ` name="${esc(e.label)}"` : ''
    } />`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_${esc(graph.id)}">
  <bpmn:process id="Process_${esc(graph.id)}" name="${esc(graph.name)}" isExecutable="false">
${graph.nodes.map(nodeTag).join('\n')}
${graph.edges.map(edgeTag).join('\n')}
  </bpmn:process>
</bpmn:definitions>`;
}
