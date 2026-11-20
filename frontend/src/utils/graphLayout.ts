import {
  BPMNGraph,
  DFGGraph,
  GraphObject,
  LayoutOrientation,
  LayoutRuleSummary,
  PetriNetGraph,
  ProcessTreeGraph,
  ProcessTreeNode,
  ProcessTreeOperator,
} from '../types/processMining';

export interface LayoutNode {
  id: string;
  label: string;
  sublabel?: string;
  durationText?: string;
  x: number; // center x
  y: number; // center y
  width: number;
  height: number;
  shape:
    | 'activity'
    | 'startTerminal'
    | 'endTerminal'
    | 'place'
    | 'transition'
    | 'silentTransition'
    | 'ptOperator'
    | 'ptActivity'
    | 'ptTau'
    | 'bpmnStart'
    | 'bpmnEnd'
    | 'bpmnIntermediate'
    | 'bpmnTask'
    | 'bpmnGateway';
  count?: number;
  heatRatio?: number; // 0-1 frequency heat
  isStart?: boolean;
  isEnd?: boolean;
  initialTokens?: number;
  isFinal?: boolean;
  silent?: boolean;
  operator?: ProcessTreeOperator | null;
  gatewayType?: 'xor' | 'and' | 'or';
  laneId?: string | null;
  rank: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sublabel?: string;
  count?: number;
  weightRatio: number; // 0-1 stroke thickness weight
  isStartArc?: boolean;
  isEndArc?: boolean;
  isSelfLoop?: boolean;
  isBackEdge?: boolean;
  isBidirectional?: boolean;
  curveOffset: number;
}

export interface LayoutLane {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  lanes: LayoutLane[];
  width: number;
  height: number;
  summary: LayoutRuleSummary;
}

export function formatDuration(sec?: number | null): string {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return '';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export function computeAdaptiveLayout(
  graph: GraphObject,
  requestedOrientation: LayoutOrientation = 'auto',
  spacingScale = 1.0
): ComputedLayout {
  if (graph.kind === 'process_tree') {
    return layoutProcessTree(graph, requestedOrientation, spacingScale);
  }
  return layoutDirectedGraph(graph, requestedOrientation, spacingScale);
}

// ── Hierarchical Layout for Process Trees ────────────────────────────────────
function layoutProcessTree(
  graph: ProcessTreeGraph,
  requestedOrientation: LayoutOrientation,
  spacingScale: number
): ComputedLayout {
  const orientation: 'LR' | 'TB' = requestedOrientation === 'auto' ? 'TB' : requestedOrientation;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  // Measure subtree leaf spans
  const leafSpan = new Map<string, number>();
  let totalNodes = 0;
  let maxDepth = 0;

  const measure = (node: ProcessTreeNode, depth: number): number => {
    totalNodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (!node.children || node.children.length === 0) {
      leafSpan.set(node.id, 1);
      return 1;
    }
    const sum = node.children.reduce((acc, c) => acc + measure(c, depth + 1), 0);
    leafSpan.set(node.id, sum);
    return sum;
  };
  const totalLeaves = measure(graph.root, 0);

  const densityClass: LayoutRuleSummary['densityClass'] =
    totalNodes > 22 ? 'dense' : totalNodes > 10 ? 'balanced' : 'sparse';

  const unitSpan = (orientation === 'TB' ? 185 : 88) * spacingScale;
  const levelGap = (orientation === 'TB' ? 128 : 220) * spacingScale;
  const margin = 80;

  const placeNode = (
    node: ProcessTreeNode,
    depth: number,
    spanStart: number,
    parentId?: string
  ) => {
    const span = leafSpan.get(node.id) || 1;
    const centerSpan = (spanStart + span / 2) * unitSpan;
    const levelCoord = margin + depth * levelGap;

    const isOp = node.type === 'operator';
    const isTau = node.type === 'tau';
    const width = isOp ? 54 : isTau ? 48 : Math.max(138, Math.min(200, (node.label?.length || 8) * 8 + 34));
    const height = isOp ? 54 : isTau ? 40 : 54;

    const x = orientation === 'TB' ? margin + centerSpan : levelCoord + width / 2;
    const y = orientation === 'TB' ? levelCoord : margin + centerSpan;

    const opNames: Record<ProcessTreeOperator, string> = {
      seq: 'SEQ',
      xor: 'XOR',
      and: 'AND',
      loop: 'LOOP',
      or: 'OR',
    };

    nodes.push({
      id: node.id,
      label: isOp ? opNames[node.operator || 'seq'] : isTau ? 'τ' : node.label || node.id,
      sublabel: node.frequency ? `${node.frequency.toLocaleString()} cases` : undefined,
      x,
      y,
      width,
      height,
      shape: isOp ? 'ptOperator' : isTau ? 'ptTau' : 'ptActivity',
      operator: node.operator,
      count: node.frequency ?? undefined,
      rank: depth,
    });

    if (parentId) {
      edges.push({
        id: `pte_${parentId}_${node.id}`,
        source: parentId,
        target: node.id,
        weightRatio: 0.45,
        curveOffset: 0,
      });
    }

    let cursor = spanStart;
    (node.children || []).forEach((child) => {
      const cSpan = leafSpan.get(child.id) || 1;
      placeNode(child, depth + 1, cursor, node.id);
      cursor += cSpan;
    });
  };

  placeNode(graph.root, 0, 0);

  const maxX = Math.max(...nodes.map((n) => n.x + n.width / 2), 600) + margin;
  const maxY = Math.max(...nodes.map((n) => n.y + n.height / 2), 450) + margin;

  const rules = [
    `Tree-Depth Orientation: ${orientation === 'TB' ? 'Top-Down Hierarchy' : 'Left-to-Right Hierarchy'}`,
    `Proportional Subtree Span (${totalLeaves} leaf slots)`,
    'Operator & τ-Leaf Visual Differentiation',
  ];

  return {
    nodes,
    edges,
    lanes: [],
    width: maxX,
    height: maxY,
    summary: {
      resolvedOrientation: orientation,
      densityClass,
      rankCount: maxDepth + 1,
      maxRankBreadth: totalLeaves,
      backEdgeCount: 0,
      selfLoopCount: 0,
      bidirectionalPairs: 0,
      crossingEstimate: 0,
      appliedRules: rules,
    },
  };
}

// ── Topological Layered Sugiyama-Style Layout for DFG, Petri Net, BPMN ───────
function layoutDirectedGraph(
  graph: DFGGraph | PetriNetGraph | BPMNGraph,
  requestedOrientation: LayoutOrientation,
  spacingScale: number
): ComputedLayout {
  const rawNodes: Omit<LayoutNode, 'x' | 'y' | 'rank'>[] = [];
  const rawEdges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    sublabel?: string;
    count?: number;
    weightRatio: number;
    isStartArc?: boolean;
    isEndArc?: boolean;
  }> = [];

  if (graph.kind === 'dfg') {
    const maxAct = Math.max(...graph.activities.map((a) => a.count), 1);
    const maxEdge = Math.max(...graph.edges.map((e) => e.count), 1);
    const hasStarts = Object.keys(graph.startActivities).length > 0;
    const hasEnds = Object.keys(graph.endActivities).length > 0;

    if (hasStarts) {
      rawNodes.push({
        id: '__start__',
        label: 'START',
        width: 56,
        height: 56,
        shape: 'startTerminal',
        isStart: true,
      });
    }

    graph.activities.forEach((a) => {
      const w = Math.max(152, Math.min(220, a.label.length * 8.2 + 44));
      const dur = formatDuration(a.meanDurationSec);
      rawNodes.push({
        id: a.id,
        label: a.label,
        sublabel: `${a.count.toLocaleString()}${dur ? ` · ${dur}` : ''}`,
        durationText: dur || undefined,
        width: w,
        height: 58,
        shape: 'activity',
        count: a.count,
        heatRatio: a.count / maxAct,
        isStart: Boolean(graph.startActivities[a.id]),
        isEnd: Boolean(graph.endActivities[a.id]),
      });
    });

    if (hasEnds) {
      rawNodes.push({
        id: '__end__',
        label: 'END',
        width: 56,
        height: 56,
        shape: 'endTerminal',
        isEnd: true,
      });
    }

    Object.entries(graph.startActivities).forEach(([actId, cnt], i) => {
      if (!graph.activities.some((a) => a.id === actId)) return;
      rawEdges.push({
        id: `__start_arc_${i}`,
        source: '__start__',
        target: actId,
        label: `${cnt}`,
        count: cnt,
        weightRatio: Math.max(0.2, cnt / maxEdge),
        isStartArc: true,
      });
    });

    graph.edges.forEach((e) => {
      const dur = formatDuration(e.meanDurationSec);
      rawEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.count.toLocaleString()}`,
        sublabel: dur || undefined,
        count: e.count,
        weightRatio: Math.max(0.15, e.count / maxEdge),
      });
    });

    Object.entries(graph.endActivities).forEach(([actId, cnt], i) => {
      if (!graph.activities.some((a) => a.id === actId)) return;
      rawEdges.push({
        id: `__end_arc_${i}`,
        source: actId,
        target: '__end__',
        label: `${cnt}`,
        count: cnt,
        weightRatio: Math.max(0.2, cnt / maxEdge),
        isEndArc: true,
      });
    });
  } else if (graph.kind === 'petri_net') {
    const maxFreq = Math.max(...graph.transitions.map((t) => t.frequency || 0), 1);
    graph.places.forEach((p) => {
      rawNodes.push({
        id: p.id,
        label: p.label,
        width: 46,
        height: 46,
        shape: 'place',
        initialTokens: p.initialTokens,
        isFinal: p.isFinal,
      });
    });
    graph.transitions.forEach((t) => {
      if (t.silent) {
        rawNodes.push({
          id: t.id,
          label: t.label || 'τ',
          width: 18,
          height: 54,
          shape: 'silentTransition',
          silent: true,
          count: t.frequency ?? undefined,
        });
      } else {
        const w = Math.max(136, Math.min(200, t.label.length * 8 + 36));
        rawNodes.push({
          id: t.id,
          label: t.label,
          sublabel: t.frequency ? `${t.frequency.toLocaleString()}` : undefined,
          width: w,
          height: 52,
          shape: 'transition',
          silent: false,
          count: t.frequency ?? undefined,
          heatRatio: t.frequency ? t.frequency / maxFreq : 0.3,
        });
      }
    });
    graph.arcs.forEach((a) => {
      rawEdges.push({
        id: a.id,
        source: a.source,
        target: a.target,
        label: a.weight > 1 ? `×${a.weight}` : undefined,
        weightRatio: 0.45,
      });
    });
  } else if (graph.kind === 'bpmn') {
    graph.nodes.forEach((n) => {
      if (n.type === 'startEvent' || n.type === 'endEvent' || n.type === 'intermediateEvent') {
        rawNodes.push({
          id: n.id,
          label: n.label || (n.type === 'startEvent' ? 'Start' : 'End'),
          width: 44,
          height: 44,
          shape:
            n.type === 'startEvent'
              ? 'bpmnStart'
              : n.type === 'endEvent'
              ? 'bpmnEnd'
              : 'bpmnIntermediate',
          laneId: n.laneId,
        });
      } else if (n.type.endsWith('Gateway')) {
        const gType = n.type === 'andGateway' ? 'and' : n.type === 'orGateway' ? 'or' : 'xor';
        rawNodes.push({
          id: n.id,
          label: n.label || '',
          width: 52,
          height: 52,
          shape: 'bpmnGateway',
          gatewayType: gType,
          laneId: n.laneId,
        });
      } else {
        const lbl = n.label || n.id;
        rawNodes.push({
          id: n.id,
          label: lbl,
          width: Math.max(146, Math.min(210, lbl.length * 8 + 38)),
          height: 56,
          shape: 'bpmnTask',
          laneId: n.laneId,
        });
      }
    });
    graph.edges.forEach((e) => {
      rawEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || undefined,
        weightRatio: 0.45,
      });
    });
  }

  // ── Step 1: Cycle-breaking DFS (detect back-edges & self-loops) ────────────
  const adj = new Map<string, string[]>();
  rawNodes.forEach((n) => adj.set(n.id, []));
  rawEdges.forEach((e) => {
    if (e.source !== e.target) {
      adj.get(e.source)?.push(e.target);
    }
  });

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const backEdgeIds = new Set<string>();

  // Prioritize root/start nodes first for deterministic topological spine
  const inDegree = new Map<string, number>();
  rawNodes.forEach((n) => inDegree.set(n.id, 0));
  rawEdges.forEach((e) => {
    if (e.source !== e.target) {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
  });

  const orderedSeeds = [...rawNodes].sort((a, b) => {
    if (a.isStart && !b.isStart) return -1;
    if (!a.isStart && b.isStart) return 1;
    return (inDegree.get(a.id) || 0) - (inDegree.get(b.id) || 0);
  });

  const dfs = (u: string) => {
    visited.add(u);
    onStack.add(u);
    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        dfs(v);
      } else if (onStack.has(v)) {
        // Any edge u -> v where v is an ancestor on recursion stack is a feedback edge
        rawEdges.forEach((e) => {
          if (e.source === u && e.target === v) backEdgeIds.add(e.id);
        });
      }
    }
    onStack.delete(u);
  };

  orderedSeeds.forEach((n) => {
    if (!visited.has(n.id)) dfs(n.id);
  });

  // ── Step 2: Longest-path topological rank assignment on acyclic DAG ────────
  const dagAdj = new Map<string, string[]>();
  const dagIn = new Map<string, number>();
  rawNodes.forEach((n) => {
    dagAdj.set(n.id, []);
    dagIn.set(n.id, 0);
  });
  rawEdges.forEach((e) => {
    if (e.source === e.target || backEdgeIds.has(e.id)) return;
    dagAdj.get(e.source)?.push(e.target);
    dagIn.set(e.target, (dagIn.get(e.target) || 0) + 1);
  });

  const rankMap = new Map<string, number>();
  const queue: string[] = [];
  rawNodes.forEach((n) => {
    if ((dagIn.get(n.id) || 0) === 0) {
      rankMap.set(n.id, 0);
      queue.push(n.id);
    }
  });

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const uRank = rankMap.get(u) || 0;
    for (const v of dagAdj.get(u) || []) {
      rankMap.set(v, Math.max(rankMap.get(v) || 0, uRank + 1));
      const rem = (dagIn.get(v) || 1) - 1;
      dagIn.set(v, rem);
      if (rem === 0) queue.push(v);
    }
  }
  rawNodes.forEach((n) => {
    if (!rankMap.has(n.id)) rankMap.set(n.id, 0);
  });

  // Force __end__ terminal to strictly sit at maxRank + 1 if present
  const hasEndNode = rawNodes.some((n) => n.id === '__end__');
  if (hasEndNode) {
    const maxNonEnd = Math.max(
      ...rawNodes.filter((n) => n.id !== '__end__').map((n) => rankMap.get(n.id) || 0),
      0
    );
    rankMap.set('__end__', maxNonEnd + 1);
  }

  // Group nodes by rank
  const maxRank = Math.max(...Array.from(rankMap.values()), 0);
  const layers: Array<typeof rawNodes> = Array.from({ length: maxRank + 1 }, () => []);
  rawNodes.forEach((n) => {
    const r = rankMap.get(n.id) || 0;
    layers[r].push(n);
  });

  // ── Step 3: Barycenter Crossing Minimization (4 passes) ────────────────────
  const nodePosInLayer = new Map<string, number>();
  const refreshPositions = () => {
    layers.forEach((layer) => layer.forEach((n, idx) => nodePosInLayer.set(n.id, idx)));
  };
  refreshPositions();

  const parentsMap = new Map<string, string[]>();
  const childrenMap = new Map<string, string[]>();
  rawNodes.forEach((n) => {
    parentsMap.set(n.id, []);
    childrenMap.set(n.id, []);
  });
  rawEdges.forEach((e) => {
    if (e.source === e.target || backEdgeIds.has(e.id)) return;
    childrenMap.get(e.source)?.push(e.target);
    parentsMap.get(e.target)?.push(e.source);
  });

  for (let pass = 0; pass < 4; pass++) {
    // Forward sweep
    for (let r = 1; r < layers.length; r++) {
      layers[r].sort((a, b) => {
        const pa = parentsMap.get(a.id) || [];
        const pb = parentsMap.get(b.id) || [];
        const ba =
          pa.length > 0
            ? pa.reduce((s, p) => s + (nodePosInLayer.get(p) ?? 0), 0) / pa.length
            : nodePosInLayer.get(a.id) ?? 0;
        const bb =
          pb.length > 0
            ? pb.reduce((s, p) => s + (nodePosInLayer.get(p) ?? 0), 0) / pb.length
            : nodePosInLayer.get(b.id) ?? 0;
        return ba - bb;
      });
      refreshPositions();
    }
    // Backward sweep
    for (let r = layers.length - 2; r >= 0; r--) {
      layers[r].sort((a, b) => {
        const ca = childrenMap.get(a.id) || [];
        const cb = childrenMap.get(b.id) || [];
        const ba =
          ca.length > 0
            ? ca.reduce((s, c) => s + (nodePosInLayer.get(c) ?? 0), 0) / ca.length
            : nodePosInLayer.get(a.id) ?? 0;
        const bb =
          cb.length > 0
            ? cb.reduce((s, c) => s + (nodePosInLayer.get(c) ?? 0), 0) / cb.length
            : nodePosInLayer.get(b.id) ?? 0;
        return ba - bb;
      });
      refreshPositions();
    }
  }

  // ── Step 4: Structure-Adaptive Orientation & Spacing Rules ─────────────────
  const maxRankBreadth = Math.max(...layers.map((l) => l.length), 1);
  const avgDegree = rawNodes.length > 0 ? rawEdges.length / rawNodes.length : 0;
  const densityClass: LayoutRuleSummary['densityClass'] =
    avgDegree > 2.2 || rawNodes.length > 18
      ? 'dense'
      : avgDegree > 1.3 || rawNodes.length > 8
      ? 'balanced'
      : 'sparse';

  const orientation: 'LR' | 'TB' =
    requestedOrientation !== 'auto'
      ? requestedOrientation
      : graph.kind === 'bpmn' && (graph.lanes?.length || 0) > 0
      ? 'LR'
      : maxRank >= 3
      ? 'LR'
      : 'TB';

  const densityMultiplier =
    densityClass === 'dense' ? 1.25 : densityClass === 'balanced' ? 1.08 : 0.96;

  const rankGap = (orientation === 'LR' ? 245 : 145) * densityMultiplier * spacingScale;
  const nodeGap = (orientation === 'LR' ? 108 : 215) * densityMultiplier * spacingScale;
  const margin = 90;

  // ── Step 5: Compute Coordinates (with BPMN Swimlane support) ───────────────
  const layoutNodes: LayoutNode[] = [];
  const layoutLanes: LayoutLane[] = [];
  const hasBpmnLanes = graph.kind === 'bpmn' && graph.lanes.length > 0 && orientation === 'LR';

  if (hasBpmnLanes && graph.kind === 'bpmn') {
    const laneHeaderWidth = 56;
    const lanePaddingY = 34;
    const laneRowHeight = 138 * spacingScale;
    let currentY = margin;

    const laneIndexMap = new Map<string, number>();
    graph.lanes.forEach((l, idx) => laneIndexMap.set(l.id, idx));

    const maxXExtent = margin + laneHeaderWidth + 70 + maxRank * rankGap + 180;

    graph.lanes.forEach((lane) => {
      // Count max stack within same rank in this lane
      const rankCounts = new Map<number, number>();
      rawNodes.forEach((n) => {
        if (n.laneId === lane.id) {
          const r = rankMap.get(n.id) || 0;
          rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
        }
      });
      const maxInLane = Math.max(...Array.from(rankCounts.values()), 1);
      const laneHeight = Math.max(laneRowHeight, maxInLane * 84 + lanePaddingY * 2);

      layoutLanes.push({
        id: lane.id,
        label: lane.label,
        x: 32,
        y: currentY,
        width: maxXExtent - 32,
        height: laneHeight,
      });

      const laneRankCursor = new Map<number, number>();
      layers.forEach((layer, rIdx) => {
        const nodesHere = layer.filter((n) => n.laneId === lane.id);
        nodesHere.forEach((n, idx) => {
          const totalHere = nodesHere.length;
          const slotOffset = (idx - (totalHere - 1) / 2) * 86;
          layoutNodes.push({
            ...n,
            rank: rIdx,
            x: margin + laneHeaderWidth + 80 + rIdx * rankGap,
            y: currentY + laneHeight / 2 + slotOffset,
          });
          laneRankCursor.set(rIdx, (laneRankCursor.get(rIdx) || 0) + 1);
        });
      });

      currentY += laneHeight;
    });

    // Any unassigned nodes
    rawNodes.forEach((n) => {
      if (!layoutNodes.some((ln) => ln.id === n.id)) {
        const rIdx = rankMap.get(n.id) || 0;
        layoutNodes.push({
          ...n,
          rank: rIdx,
          x: margin + laneHeaderWidth + 80 + rIdx * rankGap,
          y: currentY + 60,
        });
      }
    });
  } else {
    layers.forEach((layer, rIdx) => {
      const span = (layer.length - 1) * nodeGap;
      const centerOffset = ((maxRankBreadth - 1) * nodeGap) / 2;
      layer.forEach((n, idx) => {
        const crossCoord = margin + centerOffset - span / 2 + idx * nodeGap;
        const mainCoord = margin + 70 + rIdx * rankGap;
        layoutNodes.push({
          ...n,
          rank: rIdx,
          x: orientation === 'LR' ? mainCoord : crossCoord,
          y: orientation === 'LR' ? crossCoord : mainCoord,
        });
      });
    });
  }

  // ── Step 6: Edge Routing Metadata (Bidirectional, Back-Edges, Self-Loops) ──
  const edgePairSet = new Set(rawEdges.map((e) => `${e.source}|||${e.target}`));
  let selfLoopCount = 0;
  let bidirectionalCount = 0;
  let finalBackEdges = 0;

  const layoutEdges: LayoutEdge[] = rawEdges.map((e) => {
    const isSelfLoop = e.source === e.target;
    const sRank = rankMap.get(e.source) ?? 0;
    const tRank = rankMap.get(e.target) ?? 0;
    const isBackEdge = !isSelfLoop && (backEdgeIds.has(e.id) || tRank < sRank);
    const hasReverse = !isSelfLoop && edgePairSet.has(`${e.target}|||${e.source}`);

    if (isSelfLoop) selfLoopCount += 1;
    if (isBackEdge) finalBackEdges += 1;
    if (hasReverse) bidirectionalCount += 1;

    let curveOffset = 0;
    if (isBackEdge) {
      curveOffset = 78 + (sRank - tRank) * 18;
    } else if (hasReverse) {
      curveOffset = 28;
    } else if (Math.abs(tRank - sRank) > 1) {
      // Long-span edge gently bows to avoid passing through intermediate rank nodes
      curveOffset = 34;
    }

    return {
      ...e,
      isSelfLoop,
      isBackEdge,
      isBidirectional: hasReverse,
      curveOffset,
    };
  });

  // Estimate edge crossings across adjacent ranks
  let crossingEstimate = 0;
  for (let r = 0; r < layers.length - 1; r++) {
    const edgesInSlice = layoutEdges.filter(
      (e) => rankMap.get(e.source) === r && rankMap.get(e.target) === r + 1
    );
    for (let i = 0; i < edgesInSlice.length; i++) {
      for (let j = i + 1; j < edgesInSlice.length; j++) {
        const a1 = nodePosInLayer.get(edgesInSlice[i].source) ?? 0;
        const a2 = nodePosInLayer.get(edgesInSlice[i].target) ?? 0;
        const b1 = nodePosInLayer.get(edgesInSlice[j].source) ?? 0;
        const b2 = nodePosInLayer.get(edgesInSlice[j].target) ?? 0;
        if ((a1 - b1) * (a2 - b2) < 0) crossingEstimate += 1;
      }
    }
  }

  const maxX =
    Math.max(
      ...layoutNodes.map((n) => n.x + n.width / 2),
      ...layoutLanes.map((l) => l.x + l.width),
      640
    ) + margin;
  const maxY =
    Math.max(
      ...layoutNodes.map((n) => n.y + n.height / 2),
      ...layoutLanes.map((l) => l.y + l.height),
      460
    ) +
    margin +
    (finalBackEdges > 0 ? 48 : 0);

  const appliedRules = [
    `Topological Longest-Path Ranking (${maxRank + 1} layers)`,
    `Barycenter Crossing Minimization (${crossingEstimate} crossings est.)`,
    `Density-Adaptive Spacing (${densityClass}, ×${densityMultiplier.toFixed(2)})`,
  ];
  if (finalBackEdges > 0) {
    appliedRules.push(`Feedback Arc Routing (${finalBackEdges} loop back-edges elevated)`);
  }
  if (bidirectionalCount > 0) {
    appliedRules.push(`Symmetric Reciprocal Offset (${Math.floor(bidirectionalCount / 2)} pairs)`);
  }
  if (hasBpmnLanes) {
    appliedRules.push(`BPMN Swimlane Band Alignment (${layoutLanes.length} lanes)`);
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    lanes: layoutLanes,
    width: maxX,
    height: maxY,
    summary: {
      resolvedOrientation: orientation,
      densityClass,
      rankCount: maxRank + 1,
      maxRankBreadth,
      backEdgeCount: finalBackEdges,
      selfLoopCount,
      bidirectionalPairs: Math.floor(bidirectionalCount / 2),
      crossingEstimate,
      appliedRules,
    },
  };
}
