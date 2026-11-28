import {
  BPMNGraph,
  CrossingMinLevel,
  DFGGraph,
  EdgeRoutingStyle,
  GraphObject,
  LayoutAlgorithm,
  LayoutConfig,
  LayoutOrientation,
  LayoutRuleSummary,
  PetriNetGraph,
  PlanarityStatus,
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
  heatRatio?: number;
  isStart?: boolean;
  isEnd?: boolean;
  initialTokens?: number;
  isFinal?: boolean;
  silent?: boolean;
  operator?: ProcessTreeOperator | null;
  gatewayType?: 'xor' | 'and' | 'or';
  laneId?: string | null;
  rank: number;
  isSpineNode?: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sublabel?: string;
  count?: number;
  weightRatio: number;
  isStartArc?: boolean;
  isEndArc?: boolean;
  isSelfLoop?: boolean;
  isBackEdge?: boolean;
  isBidirectional?: boolean;
  isBackbone?: boolean;
  bundleOffset?: number;
  curveOffset: number;
  planarControlPoint?: { x: number; y: number };
  pathStyle?: 'curved' | 'orthogonal' | 'bundled';
  opacityHint?: number;
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

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  algorithm: 'auto',
  orientation: 'auto',
  edgeRouting: 'auto',
  crossingMin: 'auto',
  spacingScale: null,
  highlightBackbone: null,
  forcePlanar: false,
  chunkLongGraph: false,
};

export interface LayoutGuideEntry {
  title: string;
  category: 'Rule' | 'Layout Option';
  summary: string;
  worksFor: string;
}

export const LAYOUT_RULES_GUIDE: LayoutGuideEntry[] = [
  {
    title: 'Backbone Spine',
    category: 'Layout Option',
    summary:
      'Extracts the Maximum-Weight Spanning Tree of highest-frequency transitions, anchors stages along the main happy-path spine, and fans variant steps above and below.',
    worksFor: 'Dense and spaghetti DFGs (42N/500E, 58N/780E, 72N/1150E) and cyclic business processes.',
  },
  {
    title: 'Layered Flow',
    category: 'Layout Option',
    summary:
      'Breaks feedback loops temporarily, places milestones in topological layers, and reorders nodes within each stage to minimize crossings.',
    worksFor: 'Sparse-to-medium pipelines (8N/9E, 16N/45E), Petri Nets, and multi-lane BPMN workflows.',
  },
  {
    title: 'Stress Layout',
    category: 'Layout Option',
    summary:
      'Uses weighted stress majorization (Kamada-Kawai style) over inverse-frequency shortest paths to cluster tightly coupled activities and reveal bottlenecks.',
    worksFor: 'Cyclic exploratory DFGs, community-structured sub-processes, and loop-heavy networks.',
  },
  {
    title: 'Tree',
    category: 'Layout Option',
    summary:
      'Allocates proportional horizontal or vertical space to each subtree branch in hierarchical operator trees.',
    worksFor: 'Process Trees with SEQ, XOR, AND, LOOP, or OR operators.',
  },
  {
    title: 'Curved vs. Orthogonal vs. Bundled Edges',
    category: 'Layout Option',
    summary:
      'Curved draws quadratic arcs; Orthogonal draws 90° connectors; Bundled routes non-backbone arcs along shared highway trunk corridors.',
    worksFor: 'Curved for 16N/45E DFGs; Orthogonal for Petri Nets & BPMN; Bundled for 500–1150 edge spaghetti DFGs.',
  },
  {
    title: 'Crossing Pass (Standard vs. Intensive)',
    category: 'Layout Option',
    summary:
      'Standard uses 1 fast forward barycenter pass; Intensive runs 10 median/barycenter passes with 2-opt swaps and greedy node sifting.',
    worksFor: 'Standard for linear or tiny flows; Intensive for multi-branch and dense layered graphs.',
  },
  {
    title: 'Backbone Focus, Divide & Dynamic Spacing',
    category: 'Rule',
    summary:
      'Dims weak long-tail arcs, scales spacing to graph density, keeps Top-Down/Left-Right flows as one continuous line by default, and optionally divides long graphs into the fewest rows or columns needed.',
    worksFor: 'Auto-tunes across all graph scales from 8N/9E up to 72N/1150E.',
  },
];

export function formatDuration(sec?: number | null): string {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return '';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

// ── Circular & 2-Page Planarity Checks (for Euler-eligible graphs) ────────────
function testCircularPlanarity(
  nodeIds: string[],
  undirectedPairs: Array<[string, string]>
): { crossings: number; order: string[] } {
  const n = nodeIds.length;
  if (n <= 3 || undirectedPairs.length === 0) {
    return { crossings: 0, order: [...nodeIds] };
  }

  const adj = new Map<string, string[]>();
  nodeIds.forEach((id) => adj.set(id, []));
  undirectedPairs.forEach(([u, v]) => {
    adj.get(u)?.push(v);
    adj.get(v)?.push(u);
  });

  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (start: string) => {
    const stack = [start];
    while (stack.length > 0) {
      const u = stack.pop()!;
      if (visited.has(u)) continue;
      visited.add(u);
      order.push(u);
      const nbrs = adj.get(u) || [];
      for (let i = nbrs.length - 1; i >= 0; i--) {
        if (!visited.has(nbrs[i])) stack.push(nbrs[i]);
      }
    }
  };
  nodeIds.forEach((id) => {
    if (!visited.has(id)) visit(id);
  });

  const posMap = new Map<string, number>();
  const rebuildPos = (arr: string[]) => arr.forEach((id, i) => posMap.set(id, i));
  rebuildPos(order);

  const indexedEdges = undirectedPairs.filter(([u, v]) => u !== v);
  const countCrossings = (): number => {
    let c = 0;
    const chords = indexedEdges.map(([u, v]) => {
      const pu = posMap.get(u) ?? 0;
      const pv = posMap.get(v) ?? 0;
      return pu < pv ? [pu, pv] : [pv, pu];
    });
    for (let i = 0; i < chords.length; i++) {
      const [a1, a2] = chords[i];
      for (let j = i + 1; j < chords.length; j++) {
        const [b1, b2] = chords[j];
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
        if ((a1 < b1 && b1 < a2 && a2 < b2) || (b1 < a1 && a1 < b2 && b2 < a2)) c++;
      }
    }
    return c;
  };

  let bestCrossings = countCrossings();
  if (bestCrossings === 0 || n > 28) {
    return { crossings: bestCrossings, order };
  }

  for (let pass = 0; pass < 2 && bestCrossings > 0; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        posMap.set(order[i], i);
        posMap.set(order[j], j);
        const cur = countCrossings();
        if (cur < bestCrossings) {
          bestCrossings = cur;
          improved = true;
        } else {
          order[j] = order[i];
          order[i] = tmp;
          posMap.set(order[i], i);
          posMap.set(order[j], j);
        }
        if (bestCrossings === 0) return { crossings: 0, order };
      }
    }
    if (!improved) break;
  }

  if (bestCrossings > 0 && n <= 20) {
    for (let i = 0; i < n && bestCrossings > 0; i++) {
      const item = order[i];
      let bestIdx = i;
      order.splice(i, 1);
      for (let tryIdx = 0; tryIdx <= order.length; tryIdx++) {
        order.splice(tryIdx, 0, item);
        rebuildPos(order);
        const cur = countCrossings();
        if (cur < bestCrossings) {
          bestCrossings = cur;
          bestIdx = tryIdx;
        }
        order.splice(tryIdx, 1);
      }
      order.splice(bestIdx, 0, item);
      rebuildPos(order);
    }
  }

  return { crossings: bestCrossings, order };
}

function findTwoPagePlanarEmbedding(
  order: string[],
  undirectedPairs: Array<[string, string]>
): { order: string[]; edgeSideByKey: Map<string, 1 | -1> } | null {
  const posMap = new Map<string, number>();
  order.forEach((id, i) => posMap.set(id, i));
  const edges = undirectedPairs
    .filter(([u, v]) => u !== v && posMap.has(u) && posMap.has(v))
    .map(([u, v]) => {
      const a = u < v ? u : v;
      const b = u < v ? v : u;
      const p1 = posMap.get(a)!;
      const p2 = posMap.get(b)!;
      return {
        key: `${a}|||${b}`,
        lo: Math.min(p1, p2),
        hi: Math.max(p1, p2),
      };
    });

  const m = edges.length;
  const conflicts: number[][] = Array.from({ length: m }, () => []);
  for (let i = 0; i < m; i++) {
    const e1 = edges[i];
    if (e1.hi - e1.lo <= 1) continue;
    for (let j = i + 1; j < m; j++) {
      const e2 = edges[j];
      if (e2.hi - e2.lo <= 1) continue;
      if (e1.lo === e2.lo || e1.lo === e2.hi || e1.hi === e2.lo || e1.hi === e2.hi) continue;
      if (
        (e1.lo < e2.lo && e2.lo < e1.hi && e1.hi < e2.hi) ||
        (e2.lo < e1.lo && e1.lo < e2.hi && e2.hi < e1.hi)
      ) {
        conflicts[i].push(j);
        conflicts[j].push(i);
      }
    }
  }

  const side = new Int8Array(m);
  for (let i = 0; i < m; i++) {
    if (side[i] !== 0) continue;
    side[i] = 1;
    const queue = [i];
    let qh = 0;
    while (qh < queue.length) {
      const cur = queue[qh++];
      for (const nxt of conflicts[cur]) {
        if (side[nxt] === 0) {
          side[nxt] = (side[cur] === 1 ? -1 : 1) as 1 | -1;
          queue.push(nxt);
        } else if (side[nxt] === side[cur]) {
          return null;
        }
      }
    }
  }

  const edgeSideByKey = new Map<string, 1 | -1>();
  edges.forEach((e, i) => {
    edgeSideByKey.set(e.key, side[i] === -1 ? -1 : 1);
  });
  return { order, edgeSideByKey };
}

function getBoundaryClipPoint(
  node: { x: number; y: number; width: number; height: number; shape: string },
  toward: { x: number; y: number }
): { x: number; y: number } {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: node.x, y: node.y };
  }
  if (
    node.shape === 'place' ||
    node.shape === 'startTerminal' ||
    node.shape === 'endTerminal' ||
    node.shape === 'ptOperator' ||
    node.shape === 'bpmnStart' ||
    node.shape === 'bpmnEnd' ||
    node.shape === 'bpmnIntermediate'
  ) {
    const r = node.width / 2;
    const d = Math.hypot(dx, dy);
    return { x: node.x + (dx / d) * r, y: node.y + (dy / d) * r };
  }
  const hw = node.width / 2;
  const hh = node.height / 2;
  const sx = Math.abs(dx) > 0.0001 ? hw / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0.0001 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return { x: node.x + dx * t, y: node.y + dy * t };
}

function segmentsProperlyIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) - (p2y - p1y) * (p3x - p1x);
  const d1 = ccw(cx, cy, dx, dy, ax, ay);
  const d2 = ccw(cx, cy, dx, dy, bx, by);
  const d3 = ccw(ax, ay, bx, by, cx, cy);
  const d4 = ccw(ax, ay, bx, by, dx, dy);
  return ((d1 > 1e-3 && d2 < -1e-3) || (d1 < -1e-3 && d2 > 1e-3)) &&
    ((d3 > 1e-3 && d4 < -1e-3) || (d3 < -1e-3 && d4 > 1e-3));
}

function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rx: number,
  ry: number,
  hw: number,
  hh: number
): boolean {
  const minX = rx - hw;
  const maxX = rx + hw;
  const minY = ry - hh;
  const maxY = ry + hh;
  if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) {
    return false;
  }
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(ax, ay) || inside(bx, by)) return true;
  return (
    segmentsProperlyIntersect(ax, ay, bx, by, minX, minY, maxX, minY) ||
    segmentsProperlyIntersect(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
    segmentsProperlyIntersect(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
    segmentsProperlyIntersect(ax, ay, bx, by, minX, maxY, minX, minY)
  );
}

function buildEdgeSampleSegments(
  edge: LayoutEdge,
  nodeMap: Map<string, LayoutNode>,
  orientation: 'LR' | 'TB'
): Array<{ ax: number; ay: number; bx: number; by: number }> {
  if (edge.isSelfLoop) return [];
  const sNode = nodeMap.get(edge.source);
  const tNode = nodeMap.get(edge.target);
  if (!sNode || !tNode) return [];

  const mx = (sNode.x + tNode.x) / 2;
  const my = (sNode.y + tNode.y) / 2;
  const dx = tNode.x - sNode.x;
  const dy = tNode.y - sNode.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const cp = edge.planarControlPoint
    ? edge.planarControlPoint
    : edge.isBackEdge
    ? orientation === 'LR'
      ? { x: mx, y: Math.max(sNode.y, tNode.y) + edge.curveOffset }
      : { x: Math.max(sNode.x, tNode.x) + edge.curveOffset, y: my }
    : { x: mx + nx * edge.curveOffset, y: my + ny * edge.curveOffset };

  const startPt = getBoundaryClipPoint(sNode, cp);
  const endPt = getBoundaryClipPoint(tNode, cp);

  if (edge.pathStyle === 'orthogonal' && !edge.isBackEdge && !edge.planarControlPoint) {
    if (orientation === 'LR') {
      const midX = (startPt.x + endPt.x) / 2;
      return [
        { ax: startPt.x, ay: startPt.y, bx: midX, by: startPt.y },
        { ax: midX, ay: startPt.y, bx: midX, by: endPt.y },
        { ax: midX, ay: endPt.y, bx: endPt.x, by: endPt.y },
      ];
    }
    const midY = (startPt.y + endPt.y) / 2;
    return [
      { ax: startPt.x, ay: startPt.y, bx: startPt.x, by: midY },
      { ax: startPt.x, ay: midY, bx: endPt.x, by: midY },
      { ax: endPt.x, ay: midY, bx: endPt.x, by: endPt.y },
    ];
  }

  const pts: Array<{ x: number; y: number }> = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * startPt.x + 2 * mt * t * cp.x + t * t * endPt.x,
      y: mt * mt * startPt.y + 2 * mt * t * cp.y + t * t * endPt.y,
    });
  }
  const segs: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({ ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y });
  }
  return segs;
}

function countPlanarDrawingViolations(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  orientation: 'LR' | 'TB'
): number {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeSegs = edges.map((e) => ({
    edge: e,
    segs: buildEdgeSampleSegments(e, nodeMap, orientation),
  }));

  let violations = 0;
  for (let i = 0; i < edgeSegs.length; i++) {
    const a = edgeSegs[i];
    for (let j = i + 1; j < edgeSegs.length; j++) {
      const b = edgeSegs[j];
      if (
        a.edge.source === b.edge.source ||
        a.edge.source === b.edge.target ||
        a.edge.target === b.edge.source ||
        a.edge.target === b.edge.target
      ) {
        continue;
      }
      let hit = false;
      for (const s1 of a.segs) {
        for (const s2 of b.segs) {
          if (segmentsProperlyIntersect(s1.ax, s1.ay, s1.bx, s1.by, s2.ax, s2.ay, s2.bx, s2.by)) {
            violations++;
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }

    for (const n of nodes) {
      if (n.id === a.edge.source || n.id === a.edge.target) continue;
      for (const s1 of a.segs) {
        if (segmentIntersectsRect(s1.ax, s1.ay, s1.bx, s1.by, n.x, n.y, n.width / 2 + 2, n.height / 2 + 2)) {
          violations++;
          break;
        }
      }
    }
  }
  return violations;
}

// ── Maximum-Weight Spanning Tree (Kruskal) for Process Backbone ──────────────
function extractBackboneMst(
  coreNodeIds: string[],
  rawEdges: Array<{
    id: string;
    source: string;
    target: string;
    weightRatio: number;
    count?: number;
    isStartArc?: boolean;
    isEndArc?: boolean;
  }>
): {
  mstUndirectedKeys: Set<string>;
  mstDirectedIds: Set<string>;
} {
  const pairWeight = new Map<
    string,
    { u: string; v: string; weight: number; bestEdgeId: string; bestEdgeW: number }
  >();

  for (const e of rawEdges) {
    if (e.isStartArc || e.isEndArc || e.source === e.target) continue;
    const w = e.count ?? Math.round(e.weightRatio * 1000);
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    const k = `${a}|||${b}`;
    const existing = pairWeight.get(k);
    if (!existing) {
      pairWeight.set(k, { u: a, v: b, weight: w, bestEdgeId: e.id, bestEdgeW: w });
    } else {
      existing.weight += w;
      if (w > existing.bestEdgeW) {
        existing.bestEdgeW = w;
        existing.bestEdgeId = e.id;
      }
    }
  }

  const parent = new Map<string, string>();
  const rnk = new Map<string, number>();
  coreNodeIds.forEach((id) => {
    parent.set(id, id);
    rnk.set(id, 0);
  });

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      cur = parent.get(cur)!;
    }
    let root = x;
    while (parent.get(root) !== cur) {
      const nxt = parent.get(root)!;
      parent.set(root, cur);
      root = nxt;
    }
    return cur;
  };

  const union = (a: string, b: string): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    const rka = rnk.get(ra) ?? 0;
    const rkb = rnk.get(rb) ?? 0;
    if (rka < rkb) parent.set(ra, rb);
    else if (rka > rkb) parent.set(rb, ra);
    else {
      parent.set(rb, ra);
      rnk.set(ra, rka + 1);
    }
    return true;
  };

  const sortedPairs = Array.from(pairWeight.entries()).sort((a, b) => b[1].weight - a[1].weight);
  const mstUndirectedKeys = new Set<string>();
  const mstDirectedIds = new Set<string>();

  for (const [key, info] of sortedPairs) {
    if (union(info.u, info.v)) {
      mstUndirectedKeys.add(key);
      mstDirectedIds.add(info.bestEdgeId);
    }
  }

  return { mstUndirectedKeys, mstDirectedIds };
}

// ── Bounding-Box Overlap Resolver for Stress Layout ──────────────────────────
function resolveNodeOverlaps(
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  padX: number,
  padY: number
) {
  const n = nodes.length;
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const reqX = (a.width + b.width) / 2 + padX;
        const reqY = (a.height + b.height) / 2 + padY;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (absX < reqX && absY < reqY) {
          moved = true;
          const penX = reqX - absX;
          const penY = reqY - absY;
          if (penX < penY) {
            const sign = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
            const shift = (penX / 2) * 1.04;
            a.x -= sign * shift;
            b.x += sign * shift;
          } else {
            const sign = dy === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dy);
            const shift = (penY / 2) * 1.04;
            a.y -= sign * shift;
            b.y += sign * shift;
          }
        }
      }
    }
    if (!moved) break;
  }
}

// ── Public Entry: Compute Adaptive Layout ────────────────────────────────────
export function computeAdaptiveLayout(
  graph: GraphObject,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): ComputedLayout {
  if (graph.kind === 'process_tree') {
    if (config.algorithm === 'auto' || config.algorithm === 'tree_hierarchy' || config.forcePlanar) {
      return layoutProcessTree(graph, config);
    }
    const treeAsDfg = processTreeToDfg(graph);
    return layoutDirectedGraph(treeAsDfg, config, true);
  }
  return layoutDirectedGraph(graph, config, false);
}

function processTreeToDfg(graph: ProcessTreeGraph): DFGGraph {
  const activities: DFGGraph['activities'] = [];
  const edges: DFGGraph['edges'] = [];
  const walk = (n: ProcessTreeNode, parentId?: string) => {
    const label =
      n.type === 'operator'
        ? (n.operator || 'seq').toUpperCase()
        : n.type === 'tau'
        ? 'τ'
        : n.label || n.id;
    activities.push({ id: n.id, label, count: n.frequency || 1 });
    if (parentId) {
      edges.push({
        id: `pt_${parentId}_${n.id}`,
        source: parentId,
        target: n.id,
        count: n.frequency || 1,
      });
    }
    n.children.forEach((c) => walk(c, n.id));
  };
  walk(graph.root);
  return {
    kind: 'dfg',
    id: graph.id,
    name: graph.name,
    activities,
    startActivities: { [graph.root.id]: graph.root.frequency || 1 },
    endActivities: {},
    edges,
  };
}

// ── 1. Hierarchical Layout for Process Trees ─────────────────────────────────
function layoutProcessTree(
  graph: ProcessTreeGraph,
  config: LayoutConfig
): ComputedLayout {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

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

  const estTbWidth = totalLeaves * 124 + 72;
  const estLrHeight = totalLeaves * 54 + 72;
  const orientation: 'LR' | 'TB' =
    config.orientation !== 'auto'
      ? config.orientation
      : estTbWidth > 900 && estLrHeight <= 720
      ? 'LR'
      : 'TB';

  const densityClass: LayoutRuleSummary['densityClass'] =
    totalNodes > 28 ? 'large_dense' : totalNodes > 16 ? 'balanced' : 'sparse';
  const defaultSpacing = Number(
    Math.min(1.25, Math.max(0.95, 0.94 + Math.min(0.2, totalLeaves / 45))).toFixed(2)
  );
  const spacingScale = config.spacingScale ?? defaultSpacing;
  const availableRoutings: Array<Exclude<EdgeRoutingStyle, 'auto'>> = ['curved', 'orthogonal'];
  const requestedRouting = config.edgeRouting === 'bundled' ? 'curved' : config.edgeRouting;
  const resolvedRouting: Exclude<EdgeRoutingStyle, 'auto'> =
    requestedRouting === 'auto' ? 'curved' : requestedRouting;

  const unitSpan = (orientation === 'TB' ? 124 : 54) * spacingScale;
  const levelGap = (orientation === 'TB' ? 88 : 168) * spacingScale;
  const margin = 32;

  const placeNode = (
    node: ProcessTreeNode,
    depth: number,
    spanStart: number,
    parentId?: string
  ) => {
    const span = leafSpan.get(node.id) || 1;
    const centerSpan = (spanStart + span / 2) * unitSpan;
    const levelCoord = margin + 26 + depth * levelGap;

    const isOp = node.type === 'operator';
    const isTau = node.type === 'tau';
    const width = isOp
      ? 50
      : isTau
      ? 44
      : Math.max(124, Math.min(186, (node.label?.length || 8) * 7.5 + 30));
    const height = isOp ? 50 : isTau ? 38 : 48;

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
        isBackbone: true,
        curveOffset: 0,
        pathStyle: resolvedRouting,
        opacityHint: 0.92,
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

  const maxX = Math.max(...nodes.map((n) => n.x + n.width / 2), 420) + margin;
  const maxY = Math.max(...nodes.map((n) => n.y + n.height / 2), 340) + margin;
  const edgeCount = Math.max(0, totalNodes - 1);
  const maxPlanar = Math.max(0, 3 * totalNodes - 6);
  const availableAlgorithms: Array<Exclude<LayoutAlgorithm, 'auto'>> = [
    'tree_hierarchy',
    'sugiyama',
    'stress_majorization',
  ];

  return {
    nodes,
    edges,
    lanes: [],
    width: maxX,
    height: maxY,
    summary: {
      resolvedAlgorithm: 'tree_hierarchy',
      resolvedOrientation: orientation,
      resolvedRouting,
      resolvedCrossingMin: 'standard',
      resolvedSpacingScale: spacingScale,
      resolvedHighlightBackbone: false,
      defaultSpacingScale: defaultSpacing,
      defaultHighlightBackbone: false,
      chunkLongGraphActive: false,
      orientationApplicable: true,
      crossingApplicable: false,
      availableAlgorithms,
      availableRoutings,
      autoReasons: {
        algorithm: `Tree layout selected across ${maxDepth + 1} operator hierarchy levels.`,
        orientation: `${orientation === 'TB' ? 'Top-Down' : 'Left-Right'} fits ${totalLeaves} branches cleanly on screen.`,
        routing: `${resolvedRouting === 'orthogonal' ? 'Orthogonal' : 'Curved'} branches separate operator children cleanly.`,
        crossingMin: 'Tree order is strictly determined by operator syntax without layer crossings.',
        backbone: 'Backbone dimming is off because every operator branch is structurally required.',
        spacing: `Node spacing auto-tuned to ${spacingScale.toFixed(2)}x for ${totalLeaves} leaf branches.`,
      },
      densityClass,
      planarityStatus: 'planar_verified',
      planarityReason: 'Planar',
      undirectedEdgeCount: edgeCount,
      maxPlanarEdges: maxPlanar,
      isBipartite: true,
      avgDegree: totalNodes > 0 ? Number((edgeCount / totalNodes).toFixed(2)) : 0,
      rankCount: maxDepth + 1,
      maxRankBreadth: totalLeaves,
      backEdgeCount: 0,
      selfLoopCount: 0,
      bidirectionalPairs: 0,
      crossingEstimate: 0,
      appliedRules: [
        {
          rule: 'Tree Layout',
          reason: `Allocates proportional space across ${totalLeaves} leaf branches without overlap.`,
          worksFor: 'Process Trees.',
        },
      ],
    },
  };
}

// ── 2. Structure-Adaptive Directed Graph Layout (DFG, Petri Net, BPMN) ───────
function layoutDirectedGraph(
  graph: DFGGraph | PetriNetGraph | BPMNGraph,
  config: LayoutConfig,
  _fromTreeOverride: boolean
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

  let hasStarts = false;
  let hasEnds = false;

  if (graph.kind === 'dfg') {
    const maxAct = Math.max(...graph.activities.map((a) => a.count), 1);
    const maxEdge = Math.max(...graph.edges.map((e) => e.count), 1);
    hasStarts = Object.keys(graph.startActivities).length > 0;
    hasEnds = Object.keys(graph.endActivities).length > 0;

    if (hasStarts) {
      rawNodes.push({
        id: '__start__',
        label: 'START',
        width: 54,
        height: 54,
        shape: 'startTerminal',
        isStart: true,
      });
    }

    graph.activities.forEach((a) => {
      const w = Math.max(148, Math.min(216, a.label.length * 8 + 40));
      const dur = formatDuration(a.meanDurationSec);
      rawNodes.push({
        id: a.id,
        label: a.label,
        sublabel: `${a.count.toLocaleString()}${dur ? ` · ${dur}` : ''}`,
        durationText: dur || undefined,
        width: w,
        height: 56,
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
        width: 54,
        height: 54,
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
        weightRatio: Math.max(0.25, cnt / maxEdge),
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
        weightRatio: Math.max(0.08, e.count / maxEdge),
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
        weightRatio: Math.max(0.25, cnt / maxEdge),
        isEndArc: true,
      });
    });
  } else if (graph.kind === 'petri_net') {
    const maxFreq = Math.max(...graph.transitions.map((t) => t.frequency || 0), 1);
    graph.places.forEach((p) => {
      rawNodes.push({
        id: p.id,
        label: p.label,
        width: 44,
        height: 44,
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
          height: 52,
          shape: 'silentTransition',
          silent: true,
          count: t.frequency ?? undefined,
        });
      } else {
        const w = Math.max(134, Math.min(196, t.label.length * 7.8 + 34));
        rawNodes.push({
          id: t.id,
          label: t.label,
          sublabel: t.frequency ? `${t.frequency.toLocaleString()}` : undefined,
          width: w,
          height: 50,
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
          width: 50,
          height: 50,
          shape: 'bpmnGateway',
          gatewayType: gType,
          laneId: n.laneId,
        });
      } else {
        const lbl = n.label || n.id;
        rawNodes.push({
          id: n.id,
          label: lbl,
          width: Math.max(144, Math.min(206, lbl.length * 7.8 + 36)),
          height: 54,
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

  // ── Structural Analysis (Counts, Planarity, Density, Pareto Skew) ──────────
  const coreNodes = rawNodes.filter((n) => n.id !== '__start__' && n.id !== '__end__');
  const coreEdges = rawEdges.filter((e) => !e.isStartArc && !e.isEndArc && e.source !== e.target);
  const V = Math.max(coreNodes.length, rawNodes.length);
  const E = Math.max(coreEdges.length, rawEdges.length);

  const undirectedPairKeys = new Set<string>();
  const undirectedPairs: Array<[string, string]> = [];
  coreEdges.forEach((e) => {
    const a = e.source < e.target ? e.source : e.target;
    const b = e.source < e.target ? e.target : e.source;
    const k = `${a}|||${b}`;
    if (!undirectedPairKeys.has(k)) {
      undirectedPairKeys.add(k);
      undirectedPairs.push([a, b]);
    }
  });

  const undirectedCount = undirectedPairs.length;
  const isBipartite = graph.kind === 'petri_net';
  const maxPlanarEdges =
    V >= 3 ? (isBipartite ? 2 * V - 4 : 3 * V - 6) : Math.max(undirectedCount, 1);
  const eulerEligible = V < 3 || undirectedCount <= maxPlanarEdges;

  const avgDegree = V > 0 ? Number((E / V).toFixed(2)) : 0;
  const densityClass: LayoutRuleSummary['densityClass'] =
    E >= 90 || avgDegree >= 3.5 || V >= 28
      ? 'large_dense'
      : V <= 24 && (avgDegree >= 1.8 || E >= 24)
      ? 'small_dense'
      : V > 24 || E > 40
      ? 'balanced'
      : 'sparse';

  // Pareto skew of edge weights (helps tune Backbone Focus automatically)
  const sortedWeights = coreEdges
    .map((e) => e.count ?? e.weightRatio * 1000)
    .sort((a, b) => a - b);
  const medianWeight =
    sortedWeights.length > 0 ? sortedWeights[Math.floor(sortedWeights.length * 0.5)] : 1;
  const p90Weight =
    sortedWeights.length > 0 ? sortedWeights[Math.floor(sortedWeights.length * 0.9)] : 1;
  const paretoSkew = p90Weight / Math.max(medianWeight, 1);

  // ── Extract Maximum-Weight Spanning Tree Backbone ──────────────────────────
  const { mstUndirectedKeys, mstDirectedIds } = extractBackboneMst(
    coreNodes.map((n) => n.id),
    rawEdges
  );

  // Build ordered edge index by weight descending so DFS & backbone ranking prioritize heavy happy paths
  const heavySortedCoreEdges = [...coreEdges].sort(
    (a, b) => (b.count ?? b.weightRatio) - (a.count ?? a.weightRatio)
  );

  // ── Determine Available & Auto-Selected Layout Algorithm ───────────────────
  const baseAlgos: Array<Exclude<LayoutAlgorithm, 'auto'>> =
    V >= 5 ? ['sugiyama', 'backbone_spine', 'stress_majorization'] : ['sugiyama', 'backbone_spine'];
  const availableAlgorithms: Array<Exclude<LayoutAlgorithm, 'auto'>> = _fromTreeOverride
    ? ['tree_hierarchy', ...baseAlgos]
    : baseAlgos;

  const availableRoutings: Array<Exclude<EdgeRoutingStyle, 'auto'>> =
    !_fromTreeOverride && E >= 14 ? ['curved', 'orthogonal', 'bundled'] : ['curved', 'orthogonal'];

  const resolvedAlgorithm: Exclude<LayoutAlgorithm, 'auto'> =
    config.algorithm !== 'auto'
      ? availableAlgorithms.includes(config.algorithm)
        ? config.algorithm
        : 'sugiyama'
      : graph.kind === 'bpmn' && graph.lanes.length > 0
      ? 'sugiyama'
      : graph.kind === 'petri_net'
      ? 'sugiyama'
      : densityClass === 'large_dense'
      ? 'backbone_spine'
      : !hasStarts && !hasEnds && avgDegree >= 2.8 && V >= 8
      ? 'stress_majorization'
      : 'sugiyama';

  // ── Cycle-breaking & Milestone Ranking ─────────────────────────────────────
  // For Backbone Spine (or very dense spaghetti graphs), rank milestones primarily along MST + top 28%
  // dominant flows so low-probability random skip/noise edges never collapse the stage layers!
  const useBackboneAnchoredRanking =
    resolvedAlgorithm === 'backbone_spine' || (densityClass === 'large_dense' && graph.kind === 'dfg');

  const rankingCandidateEdges = useBackboneAnchoredRanking
    ? rawEdges.filter((e, idx) => {
        if (e.isStartArc || e.isEndArc) return true;
        if (e.source === e.target) return false;
        if (mstDirectedIds.has(e.id)) return true;
        const thresholdIdx = Math.max(V * 2, Math.floor(heavySortedCoreEdges.length * 0.25));
        const cutoffWeight =
          heavySortedCoreEdges[Math.min(thresholdIdx, heavySortedCoreEdges.length - 1)]
            ?.weightRatio ?? 0.35;
        return e.weightRatio >= Math.max(cutoffWeight, 0.25) || idx < 0;
      })
    : rawEdges;

  const adj = new Map<string, string[]>();
  rawNodes.forEach((n) => adj.set(n.id, []));
  const rankingEdgesWeighted = [...rankingCandidateEdges].sort(
    (a, b) => (b.count ?? b.weightRatio) - (a.count ?? a.weightRatio)
  );
  rankingEdgesWeighted.forEach((e) => {
    if (e.source !== e.target) adj.get(e.source)?.push(e.target);
  });

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const backEdgeIds = new Set<string>();

  const inDegree = new Map<string, number>();
  rawNodes.forEach((n) => inDegree.set(n.id, 0));
  rankingEdgesWeighted.forEach((e) => {
    if (e.source !== e.target) inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });

  const orderedSeeds = [...rawNodes].sort((a, b) => {
    if (a.id === '__start__') return -1;
    if (b.id === '__start__') return 1;
    if (a.isStart && !b.isStart) return -1;
    if (!a.isStart && b.isStart) return 1;
    const degDiff = (inDegree.get(a.id) || 0) - (inDegree.get(b.id) || 0);
    if (degDiff !== 0) return degDiff;
    return (b.count || 0) - (a.count || 0);
  });

  const dfs = (u: string) => {
    visited.add(u);
    onStack.add(u);
    for (const v of adj.get(u) || []) {
      if (!visited.has(v)) dfs(v);
      else if (onStack.has(v)) {
        rankingEdgesWeighted.forEach((e) => {
          if (e.source === u && e.target === v) backEdgeIds.add(e.id);
        });
      }
    }
    onStack.delete(u);
  };
  orderedSeeds.forEach((n) => {
    if (!visited.has(n.id)) dfs(n.id);
  });

  const dagAdj = new Map<string, string[]>();
  const dagIn = new Map<string, number>();
  rawNodes.forEach((n) => {
    dagAdj.set(n.id, []);
    dagIn.set(n.id, 0);
  });
  rankingEdgesWeighted.forEach((e) => {
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
  let qHead = 0;
  while (qHead < queue.length) {
    const u = queue[qHead++];
    const uRank = rankMap.get(u) || 0;
    for (const v of dagAdj.get(u) || []) {
      rankMap.set(v, Math.max(rankMap.get(v) || 0, uRank + 1));
      const rem = (dagIn.get(v) || 1) - 1;
      dagIn.set(v, rem);
      if (rem === 0) queue.push(v);
    }
  }

  // Fallback for any core nodes missed by trimmed backbone DAG: place via heaviest neighbor rank
  rawNodes.forEach((n) => {
    if (!rankMap.has(n.id)) {
      const incoming = heavySortedCoreEdges.find((e) => e.target === n.id && rankMap.has(e.source));
      if (incoming) {
        rankMap.set(n.id, (rankMap.get(incoming.source) || 0) + 1);
      } else {
        const outgoing = heavySortedCoreEdges.find((e) => e.source === n.id && rankMap.has(e.target));
        rankMap.set(n.id, Math.max(0, (outgoing ? rankMap.get(outgoing.target) || 1 : 1) - 1));
      }
    }
  });

  // Compact overly deep backbone chains on dense DFGs into clean lifecycle milestones (~7-10 stages)
  if (useBackboneAnchoredRanking && rawNodes.length >= 26) {
    const coreRanks = coreNodes.map((n) => rankMap.get(n.id) || 0);
    const maxCoreR = Math.max(...coreRanks, 1);
    const targetStages = Math.max(6, Math.min(10, Math.round(Math.sqrt(coreNodes.length) * 1.1)));
    if (maxCoreR > targetStages + 2) {
      coreNodes.forEach((n) => {
        const r = rankMap.get(n.id) || 0;
        const scaled = 1 + Math.round(((r - (hasStarts ? 1 : 0)) / Math.max(maxCoreR - 1, 1)) * (targetStages - 1));
        rankMap.set(n.id, Math.max(hasStarts ? 1 : 0, scaled));
      });
    }
  }

  if (rawNodes.some((n) => n.id === '__end__')) {
    const maxNonEnd = Math.max(
      ...rawNodes.filter((n) => n.id !== '__end__').map((n) => rankMap.get(n.id) || 0),
      0
    );
    rankMap.set('__end__', maxNonEnd + 1);
  }

  // Identify Primary Spine Path nodes (highest-traffic milestone sequence from start to end)
  const spineNodeIds = new Set<string>();
  const rankGroups = new Map<number, typeof rawNodes>();
  rawNodes.forEach((n) => {
    const r = rankMap.get(n.id) || 0;
    const arr = rankGroups.get(r) || [];
    arr.push(n);
    rankGroups.set(r, arr);
  });
  rankGroups.forEach((arr) => {
    const top = [...arr].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    if (top) spineNodeIds.add(top.id);
  });

  const maxRank = Math.max(...Array.from(rankMap.values()), 0);
  const layers: Array<typeof rawNodes> = Array.from({ length: maxRank + 1 }, () => []);
  rawNodes.forEach((n) => layers[rankMap.get(n.id) || 0].push(n));

  // Establish initial deterministic frequency/backbone order inside each layer
  layers.forEach((layer) => {
    layer.sort((a, b) => {
      const sa = spineNodeIds.has(a.id) ? 1 : 0;
      const sb = spineNodeIds.has(b.id) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (b.count || 0) - (a.count || 0);
    });
  });

  const maxRankBreadth = Math.max(...layers.map((l) => l.length), 1);

  // Circular & 2-Page planarity checks
  const coreCircularPlanar = eulerEligible
    ? testCircularPlanarity(
        coreNodes.map((n) => n.id),
        undirectedPairs
      )
    : { crossings: undirectedCount, order: coreNodes.map((n) => n.id) };
  const circularCrossings = coreCircularPlanar.crossings;
  const twoPageCore =
    eulerEligible && circularCrossings > 0 && V <= 28
      ? findTwoPagePlanarEmbedding(coreCircularPlanar.order, undirectedPairs)
      : null;

  // ── Crossing Minimization (Standard vs. Intensive — genuinely distinct!) ────
  const crossingApplicable =
    (resolvedAlgorithm === 'sugiyama' || resolvedAlgorithm === 'backbone_spine') &&
    maxRankBreadth >= 2;

  const resolvedCrossingMin: Exclude<CrossingMinLevel, 'auto'> =
    config.crossingMin !== 'auto'
      ? config.crossingMin
      : V >= 10 && maxRankBreadth >= 3
      ? 'intensive'
      : E >= 36 && maxRankBreadth >= 2
      ? 'intensive'
      : 'standard';

  const nodePosInLayer = new Map<string, number>();
  const refreshPositions = () => {
    layers.forEach((layer) => layer.forEach((n, idx) => nodePosInLayer.set(n.id, idx)));
  };
  refreshPositions();

  // Weighted adjacency across adjacent/forward edges for barycenter & median heuristics
  const weightedParents = new Map<string, Array<{ id: string; w: number }>>();
  const weightedChildren = new Map<string, Array<{ id: string; w: number }>>();
  rawNodes.forEach((n) => {
    weightedParents.set(n.id, []);
    weightedChildren.set(n.id, []);
  });

  const activeLayerEdges = rawEdges.filter((e) => {
    if (e.source === e.target) return false;
    const sr = rankMap.get(e.source) ?? 0;
    const tr = rankMap.get(e.target) ?? 0;
    return tr > sr;
  });

  activeLayerEdges.forEach((e) => {
    const w = (e.count ?? e.weightRatio * 100) + (mstDirectedIds.has(e.id) ? 200 : 0);
    weightedChildren.get(e.source)?.push({ id: e.target, w });
    weightedParents.get(e.target)?.push({ id: e.source, w });
  });

  const computeWeightedBarycenter = (nbrs: Array<{ id: string; w: number }>, fallback: number): number => {
    if (nbrs.length === 0) return fallback;
    let sumW = 0;
    let sumPos = 0;
    for (const n of nbrs) {
      sumW += n.w;
      sumPos += (nodePosInLayer.get(n.id) ?? 0) * n.w;
    }
    return sumW > 0 ? sumPos / sumW : fallback;
  };

  const computeWeightedMedian = (nbrs: Array<{ id: string; w: number }>, fallback: number): number => {
    if (nbrs.length === 0) return fallback;
    const sorted = [...nbrs]
      .map((n) => ({ pos: nodePosInLayer.get(n.id) ?? 0, w: n.w }))
      .sort((a, b) => a.pos - b.pos);
    const totalW = sorted.reduce((s, item) => s + item.w, 0);
    let acc = 0;
    for (const item of sorted) {
      acc += item.w;
      if (acc >= totalW * 0.5) return item.pos;
    }
    return sorted[sorted.length - 1].pos;
  };

  // Edge crossing counter between layer r and r+1 (using adjacent & skip-1 edges bounded smoothly)
  const sliceEdgeBuckets: Array<typeof activeLayerEdges> = Array.from(
    { length: Math.max(1, layers.length - 1) },
    () => []
  );
  activeLayerEdges.forEach((e) => {
    const sr = rankMap.get(e.source) ?? 0;
    const tr = rankMap.get(e.target) ?? 0;
    if (tr - sr === 1 && sr >= 0 && sr < sliceEdgeBuckets.length) {
      sliceEdgeBuckets[sr].push(e);
    }
  });

  const countSliceCrossings = (r: number): number => {
    if (r < 0 || r >= sliceEdgeBuckets.length) return 0;
    const edgesInSlice = sliceEdgeBuckets[r];
    if (edgesInSlice.length <= 1) return 0;
    let cross = 0;
    const list =
      edgesInSlice.length > 180
        ? [...edgesInSlice].sort((a, b) => b.weightRatio - a.weightRatio).slice(0, 180)
        : edgesInSlice;
    for (let i = 0; i < list.length; i++) {
      const a1 = nodePosInLayer.get(list[i].source) ?? 0;
      const a2 = nodePosInLayer.get(list[i].target) ?? 0;
      for (let j = i + 1; j < list.length; j++) {
        const b1 = nodePosInLayer.get(list[j].source) ?? 0;
        const b2 = nodePosInLayer.get(list[j].target) ?? 0;
        if ((a1 - b1) * (a2 - b2) < 0) cross++;
      }
    }
    return cross;
  };

  const countWeightedSliceCrossings = (r: number): number => {
    if (r < 0 || r >= sliceEdgeBuckets.length) return 0;
    const edgesInSlice = sliceEdgeBuckets[r];
    if (edgesInSlice.length <= 1) return 0;
    let cost = 0;
    const list =
      edgesInSlice.length > 160
        ? [...edgesInSlice].sort((a, b) => b.weightRatio - a.weightRatio).slice(0, 160)
        : edgesInSlice;
    for (let i = 0; i < list.length; i++) {
      const e1 = list[i];
      const a1 = nodePosInLayer.get(e1.source) ?? 0;
      const a2 = nodePosInLayer.get(e1.target) ?? 0;
      const w1 = e1.weightRatio + (mstDirectedIds.has(e1.id) ? 1.5 : 0.05);
      for (let j = i + 1; j < list.length; j++) {
        const e2 = list[j];
        const b1 = nodePosInLayer.get(e2.source) ?? 0;
        const b2 = nodePosInLayer.get(e2.target) ?? 0;
        if ((a1 - b1) * (a2 - b2) < 0) {
          const w2 = e2.weightRatio + (mstDirectedIds.has(e2.id) ? 1.5 : 0.05);
          cost += w1 * w2;
        }
      }
    }
    return cost;
  };

  if (resolvedCrossingMin === 'standard') {
    // STANDARD: 1 fast forward unweighted barycenter sweep preserving initial frequency order
    for (let r = 1; r < layers.length; r++) {
      layers[r].sort((a, b) => {
        const pa = weightedParents.get(a.id) || [];
        const pb = weightedParents.get(b.id) || [];
        const ba =
          pa.length > 0
            ? pa.reduce((s, p) => s + (nodePosInLayer.get(p.id) ?? 0), 0) / pa.length
            : nodePosInLayer.get(a.id) ?? 0;
        const bb =
          pb.length > 0
            ? pb.reduce((s, p) => s + (nodePosInLayer.get(p.id) ?? 0), 0) / pb.length
            : nodePosInLayer.get(b.id) ?? 0;
        if (Math.abs(ba - bb) > 0.25) return ba - bb;
        return (b.count || 0) - (a.count || 0);
      });
      refreshPositions();
    }
  } else {
    // INTENSIVE: 10 alternating sweeps (70% weighted median + 30% weighted barycenter) + weighted 2-opt + sifting
    for (let pass = 0; pass < 10; pass++) {
      for (let r = 1; r < layers.length; r++) {
        layers[r].sort((a, b) => {
          const pa = weightedParents.get(a.id) || [];
          const pb = weightedParents.get(b.id) || [];
          const ma = computeWeightedMedian(pa, nodePosInLayer.get(a.id) ?? 0);
          const ba = computeWeightedBarycenter(pa, nodePosInLayer.get(a.id) ?? 0);
          const mb = computeWeightedMedian(pb, nodePosInLayer.get(b.id) ?? 0);
          const bb = computeWeightedBarycenter(pb, nodePosInLayer.get(b.id) ?? 0);
          return 0.7 * ma + 0.3 * ba - (0.7 * mb + 0.3 * bb);
        });
        refreshPositions();
      }
      for (let r = layers.length - 2; r >= 0; r--) {
        layers[r].sort((a, b) => {
          const ca = weightedChildren.get(a.id) || [];
          const cb = weightedChildren.get(b.id) || [];
          const ma = computeWeightedMedian(ca, nodePosInLayer.get(a.id) ?? 0);
          const ba = computeWeightedBarycenter(ca, nodePosInLayer.get(a.id) ?? 0);
          const mb = computeWeightedMedian(cb, nodePosInLayer.get(b.id) ?? 0);
          const bb = computeWeightedBarycenter(cb, nodePosInLayer.get(b.id) ?? 0);
          return 0.7 * ma + 0.3 * ba - (0.7 * mb + 0.3 * bb);
        });
        refreshPositions();
      }
    }

    // 2-Opt Weighted Adjacent Transpose across ALL graph sizes
    for (let sweep = 0; sweep < 3; sweep++) {
      let improved = false;
      for (let r = 0; r < layers.length; r++) {
        const layer = layers[r];
        if (layer.length <= 1 || layer.length > 36) continue;
        for (let i = 0; i < layer.length - 1; i++) {
          const before =
            (r > 0 ? countWeightedSliceCrossings(r - 1) : 0) +
            (r < layers.length - 1 ? countWeightedSliceCrossings(r) : 0);
          const tmp = layer[i];
          layer[i] = layer[i + 1];
          layer[i + 1] = tmp;
          nodePosInLayer.set(layer[i].id, i);
          nodePosInLayer.set(layer[i + 1].id, i + 1);
          const after =
            (r > 0 ? countWeightedSliceCrossings(r - 1) : 0) +
            (r < layers.length - 1 ? countWeightedSliceCrossings(r) : 0);
          if (after + 1e-6 < before) {
            improved = true;
          } else {
            layer[i + 1] = layer[i];
            layer[i] = tmp;
            nodePosInLayer.set(layer[i].id, i);
            nodePosInLayer.set(layer[i + 1].id, i + 1);
          }
        }
      }
      if (!improved) break;
    }

    // Weighted Node Sifting pass for medium layers
    for (let r = 0; r < layers.length; r++) {
      const layer = layers[r];
      if (layer.length < 3 || layer.length > 18) continue;
      const snapshot = [...layer];
      for (const targetNode of snapshot) {
        const curIdx = layer.indexOf(targetNode);
        if (curIdx < 0) continue;
        let bestIdx = curIdx;
        let bestCost =
          (r > 0 ? countWeightedSliceCrossings(r - 1) : 0) +
          (r < layers.length - 1 ? countWeightedSliceCrossings(r) : 0);

        layer.splice(curIdx, 1);
        for (let tryIdx = 0; tryIdx <= layer.length; tryIdx++) {
          layer.splice(tryIdx, 0, targetNode);
          layer.forEach((item, k) => nodePosInLayer.set(item.id, k));
          const c =
            (r > 0 ? countWeightedSliceCrossings(r - 1) : 0) +
            (r < layers.length - 1 ? countWeightedSliceCrossings(r) : 0);
          if (c + 1e-6 < bestCost) {
            bestCost = c;
            bestIdx = tryIdx;
          }
          layer.splice(tryIdx, 1);
        }
        layer.splice(bestIdx, 0, targetNode);
        layer.forEach((item, k) => nodePosInLayer.set(item.id, k));
      }
    }
  }

  let layeredCrossings = 0;
  for (let r = 0; r < layers.length - 1; r++) {
    layeredCrossings += countSliceCrossings(r);
  }

  const planarByStructure =
    eulerEligible &&
    (circularCrossings === 0 ||
      (layeredCrossings === 0 && backEdgeIds.size === 0) ||
      twoPageCore !== null);

  const planarityStatus: PlanarityStatus = !eulerEligible
    ? 'non_planar_euler'
    : planarByStructure
    ? 'planar_verified'
    : 'near_planar';

  const planarityReason =
    planarityStatus === 'planar_verified'
      ? 'Planar'
      : planarityStatus === 'near_planar'
      ? 'Near-planar'
      : 'Non-planar';

  const planarForcedActive = Boolean(config.forcePlanar) && planarityStatus === 'planar_verified';

  // ── Auto-Tune Orientation, Routing, Spacing, and Backbone Focus ────────────
  const estLrWidth = (maxRank + 1) * 168 + 72;
  const estLrHeight = maxRankBreadth * 74 + 72;
  const estTbWidth = maxRankBreadth * 160 + 72;
  const estTbHeight = (maxRank + 1) * 86 + 72;
  const lrOverflow = Math.max(estLrWidth / 900, estLrHeight / 620);
  const tbOverflow = Math.max(estTbWidth / 900, estTbHeight / 620);

  const resolvedOrientation: 'LR' | 'TB' =
    config.orientation !== 'auto'
      ? config.orientation
      : graph.kind === 'bpmn' && (graph.lanes?.length || 0) > 0
      ? 'LR'
      : resolvedAlgorithm === 'backbone_spine'
      ? 'LR'
      : lrOverflow <= tbOverflow
      ? 'LR'
      : 'TB';

  const orientationApplicable = true;

  const requestedRouting =
    config.edgeRouting !== 'auto' && availableRoutings.includes(config.edgeRouting)
      ? config.edgeRouting
      : 'auto';

  let resolvedRouting: Exclude<EdgeRoutingStyle, 'auto'> =
    requestedRouting !== 'auto'
      ? requestedRouting
      : graph.kind === 'bpmn' || graph.kind === 'petri_net'
      ? 'orthogonal'
      : (resolvedAlgorithm === 'backbone_spine' || E >= 70 || avgDegree >= 3.0) &&
        availableRoutings.includes('bundled')
      ? 'bundled'
      : 'curved';

  if (planarForcedActive && resolvedRouting === 'bundled') {
    resolvedRouting = 'curved';
  }

  // Adaptive Node Spacing scaled cleanly to V, avgDegree, and stage breadth
  const rawDefaultSpacing =
    0.88 +
    Math.min(0.22, avgDegree * 0.017) +
    Math.min(0.18, V / 260) +
    Math.min(0.1, maxRankBreadth * 0.01);
  const defaultSpacingScale = Number(
    (Math.round(Math.min(1.45, Math.max(0.9, rawDefaultSpacing)) * 20) / 20).toFixed(2)
  );
  const resolvedSpacingScale = config.spacingScale ?? defaultSpacingScale;

  // Adaptive Backbone Focus: off on sparse graphs (every edge matters), on for cyclic/spaghetti DFGs
  const autoHighlightBackbone =
    graph.kind === 'dfg' && (E >= 36 || avgDegree >= 2.2 || (E >= 22 && paretoSkew >= 2.2));
  const resolvedHighlightBackbone =
    config.highlightBackbone !== null ? config.highlightBackbone : autoHighlightBackbone;

  // ── Coordinate Placement per Resolved Algorithm ────────────────────────────
  const layoutNodes: LayoutNode[] = [];
  const layoutLanes: LayoutLane[] = [];
  const margin = 36;
  const rankToChunk = new Map<number, number>();
  let chunkLongGraphActive = false;

  const placeLayeredOrSpine = (spineAligned: boolean) => {
    const rankWidths = layers.map((layer) =>
      Math.max(...layer.map((n) => (resolvedOrientation === 'LR' ? n.width : n.height)), 44)
    );
    const maxNodeW = Math.max(...rawNodes.map((n) => n.width), 160);
    const rankFlowGap =
      (spineAligned
        ? resolvedOrientation === 'LR'
          ? 68
          : 48
        : resolvedOrientation === 'LR'
        ? 52
        : 38) * resolvedSpacingScale;
    const nodeGap =
      resolvedOrientation === 'LR'
        ? Math.max(68, 76 * resolvedSpacingScale)
        : Math.max(maxNodeW + 24, (spineAligned ? 198 : 196) * resolvedSpacingScale);

    const totalMainSpan =
      rankWidths.reduce((s, w) => s + w, 0) + Math.max(0, layers.length - 1) * rankFlowGap;
    const chunkTriggerSpan = resolvedOrientation === 'LR' ? 880 : 600;
    const chunkTargetSpan = resolvedOrientation === 'LR' ? 1120 : 820;
    const shouldChunk =
      Boolean(config.chunkLongGraph) &&
      !planarForcedActive &&
      layers.length >= 4 &&
      totalMainSpan > chunkTriggerSpan;

    const chunks: Array<{ startR: number; endR: number }> = [];
    if (shouldChunk) {
      const rawCount = Math.ceil(totalMainSpan / chunkTargetSpan);
      const numChunks = Math.max(2, Math.min(5, Math.floor(layers.length / 2), rawCount));
      const targetPerChunk = totalMainSpan / numChunks;

      let curStart = 0;
      let accSpan = 0;
      for (let rIdx = 0; rIdx < layers.length; rIdx++) {
        const stepSpan = rankWidths[rIdx] + (rIdx > curStart ? rankFlowGap : 0);
        accSpan += stepSpan;
        const chunksCreated = chunks.length;
        const remainingChunks = numChunks - chunksCreated;
        const ranksInCur = rIdx - curStart + 1;
        const remainingRanks = layers.length - (rIdx + 1);
        if (
          remainingChunks > 1 &&
          ranksInCur >= 2 &&
          remainingRanks >= (remainingChunks - 1) * 2 &&
          accSpan >= targetPerChunk * 0.92
        ) {
          chunks.push({ startR: curStart, endR: rIdx + 1 });
          curStart = rIdx + 1;
          accSpan = 0;
        }
      }
      if (curStart < layers.length) {
        chunks.push({ startR: curStart, endR: layers.length });
      }
      chunkLongGraphActive = chunks.length > 1;
    } else {
      chunks.push({ startR: 0, endR: layers.length });
    }

    const chunkGap = (resolvedOrientation === 'LR' ? 54 : 62) * Math.min(1.2, resolvedSpacingScale);
    let crossCursor = margin + 32;

    chunks.forEach((chunk, cIdx) => {
      const rankLocalCross = new Map<number, number[]>();
      let chunkMinCross = Infinity;
      let chunkMaxCross = -Infinity;

      for (let rIdx = chunk.startR; rIdx < chunk.endR; rIdx++) {
        rankToChunk.set(rIdx, cIdx);
        const layer = layers[rIdx];
        if (!layer || layer.length === 0) {
          rankLocalCross.set(rIdx, []);
          continue;
        }

        let offsets: number[];
        if (spineAligned) {
          const spineIdx = layer.findIndex((n) => spineNodeIds.has(n.id));
          const pivotIdx = spineIdx >= 0 ? spineIdx : Math.floor(layer.length / 2);
          offsets = layer.map((_, idx) => (idx - pivotIdx) * nodeGap);
        } else {
          offsets = layer.map((_, idx) => (idx - (layer.length - 1) / 2) * nodeGap);
        }
        rankLocalCross.set(rIdx, offsets);

        layer.forEach((n, idx) => {
          const halfCross = (resolvedOrientation === 'LR' ? n.height : n.width) / 2;
          const c = offsets[idx];
          chunkMinCross = Math.min(chunkMinCross, c - halfCross);
          chunkMaxCross = Math.max(chunkMaxCross, c + halfCross);
        });
      }

      if (!Number.isFinite(chunkMinCross)) {
        chunkMinCross = -30;
        chunkMaxCross = 30;
      }

      const chunkCenterCross = crossCursor - chunkMinCross;
      let mainCursor = margin + 28;

      for (let rIdx = chunk.startR; rIdx < chunk.endR; rIdx++) {
        const layer = layers[rIdx];
        const rSize = rankWidths[rIdx] || 54;
        const mainCoord = mainCursor + rSize / 2;
        const offsets = rankLocalCross.get(rIdx) || [];
        layer.forEach((n, idx) => {
          const crossCoord = chunkCenterCross + (offsets[idx] ?? 0);
          layoutNodes.push({
            ...n,
            rank: rIdx,
            isSpineNode: spineAligned ? spineNodeIds.has(n.id) : undefined,
            x: resolvedOrientation === 'LR' ? mainCoord : crossCoord,
            y: resolvedOrientation === 'LR' ? crossCoord : mainCoord,
          });
        });
        mainCursor += rSize + rankFlowGap;
      }

      crossCursor = chunkCenterCross + chunkMaxCross + chunkGap;
    });
  };

  if (resolvedAlgorithm === 'backbone_spine') {
    placeLayeredOrSpine(true);
  } else if (resolvedAlgorithm === 'stress_majorization') {
    // Weighted Stress Majorization (Kamada-Kawai / ELK Stress) over inverse-log-frequency distances
    const coreIds = coreNodes.map((n) => n.id);
    const idToIdx = new Map<string, number>(coreIds.map((id, i) => [id, i]));
    const nCore = coreIds.length;

    // Build weighted undirected neighbor list (distance shorter for stronger frequency edges)
    const uAdj: Array<Array<{ to: number; len: number }>> = Array.from({ length: nCore }, () => []);
    coreEdges.forEach((e) => {
      const u = idToIdx.get(e.source);
      const v = idToIdx.get(e.target);
      if (u === undefined || v === undefined || u === v) return;
      const rawW = e.count ?? e.weightRatio * 1000;
      const dist = Math.max(0.55, 1.85 / Math.log2(2.5 + rawW * 0.04));
      uAdj[u].push({ to: v, len: dist });
      uAdj[v].push({ to: u, len: dist });
    });

    // All-pairs shortest paths (Dijkstra per node, fast up to ~120 nodes)
    const distMat: number[][] = Array.from({ length: nCore }, () =>
      new Array(nCore).fill(Math.max(4, maxRank + 1))
    );
    for (let src = 0; src < nCore; src++) {
      const d = distMat[src];
      d[src] = 0;
      const done = new Uint8Array(nCore);
      for (let step = 0; step < nCore; step++) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < nCore; i++) {
          if (!done[i] && d[i] < best) {
            best = d[i];
            u = i;
          }
        }
        if (u === -1 || best === Infinity) break;
        done[u] = 1;
        for (const edge of uAdj[u]) {
          const nd = best + edge.len;
          if (nd < d[edge.to]) d[edge.to] = nd;
        }
      }
    }

    const baseStep = (resolvedOrientation === 'LR' ? 148 : 132) * resolvedSpacingScale;
    const anchorX: number[] = new Array(nCore).fill(0);
    const anchorY: number[] = new Array(nCore).fill(0);
    const posX: number[] = new Array(nCore).fill(0);
    const posY: number[] = new Array(nCore).fill(0);

    // Seed initial coords deterministically from crossing-minimized layers along resolvedOrientation
    layers.forEach((layer, rIdx) => {
      const coreInLayer = layer.filter((n) => idToIdx.has(n.id));
      coreInLayer.forEach((n, idx) => {
        const i = idToIdx.get(n.id)!;
        const stageCoord = rIdx * baseStep * 1.15;
        const spreadCoord = (idx - (coreInLayer.length - 1) / 2) * (baseStep * 0.68);
        if (resolvedOrientation === 'LR') {
          anchorX[i] = stageCoord;
          anchorY[i] = spreadCoord;
        } else {
          anchorX[i] = spreadCoord;
          anchorY[i] = stageCoord;
        }
        posX[i] = anchorX[i];
        posY[i] = anchorY[i];
      });
    });

    // Localized Stress Majorization (28 iterations) + gentle orientation-stage anchor
    for (let iter = 0; iter < 28; iter++) {
      for (let i = 0; i < nCore; i++) {
        let wSum = 0.09; // gentle flow-direction anchor prevents arbitrary rotation
        let newX = 0.09 * anchorX[i];
        let newY = 0.09 * anchorY[i];

        for (let j = 0; j < nCore; j++) {
          if (i === j) continue;
          const ideal = Math.max(0.6, distMat[i][j]) * baseStep;
          const wij = 1 / (ideal * ideal);
          const dx = posX[i] - posX[j];
          const dy = posY[i] - posY[j];
          const curDist = Math.hypot(dx, dy) || 1;
          newX += wij * (posX[j] + (ideal * dx) / curDist);
          newY += wij * (posY[j] + (ideal * dy) / curDist);
          wSum += wij;
        }
        posX[i] = newX / wSum;
        posY[i] = newY / wSum;
      }
    }

    const corePlaced = coreNodes.map((n, i) => ({
      ...n,
      rank: rankMap.get(n.id) ?? 0,
      x: posX[i],
      y: posY[i],
    }));

    resolveNodeOverlaps(
      corePlaced,
      26 * resolvedSpacingScale,
      22 * resolvedSpacingScale
    );

    // Normalize bounding box into positive canvas coordinates
    const minCoreX = Math.min(...corePlaced.map((n) => n.x - n.width / 2), 0);
    const maxCoreX = Math.max(...corePlaced.map((n) => n.x + n.width / 2), 200);
    const minCoreY = Math.min(...corePlaced.map((n) => n.y - n.height / 2), 0);
    const maxCoreY = Math.max(...corePlaced.map((n) => n.y + n.height / 2), 200);

    const startNode = rawNodes.find((n) => n.id === '__start__');
    const endNode = rawNodes.find((n) => n.id === '__end__');
    const shiftX =
      margin + (startNode && resolvedOrientation === 'LR' ? 105 : 24) - minCoreX;
    const shiftY =
      margin + (startNode && resolvedOrientation === 'TB' ? 92 : 24) - minCoreY;

    corePlaced.forEach((n) => {
      layoutNodes.push({
        ...n,
        x: n.x + shiftX,
        y: n.y + shiftY,
      });
    });

    const spanCenterX = (minCoreX + maxCoreX) / 2 + shiftX;
    const spanCenterY = (minCoreY + maxCoreY) / 2 + shiftY;

    if (startNode) {
      layoutNodes.push({
        ...startNode,
        rank: 0,
        x: resolvedOrientation === 'LR' ? margin + 28 : spanCenterX,
        y: resolvedOrientation === 'LR' ? spanCenterY : margin + 28,
      });
    }
    if (endNode) {
      layoutNodes.push({
        ...endNode,
        rank: maxRank,
        x:
          resolvedOrientation === 'LR'
            ? maxCoreX + shiftX + 76
            : spanCenterX,
        y:
          resolvedOrientation === 'LR'
            ? spanCenterY
            : maxCoreY + shiftY + 68,
      });
    }
  } else {
    // Sugiyama Layered Layout with optional Chunking (1 continuous TB/LR line by default)
    const hasBpmnLanes =
      graph.kind === 'bpmn' && graph.lanes.length > 0 && resolvedOrientation === 'LR';

    if (hasBpmnLanes && graph.kind === 'bpmn') {
      const rankWidths = layers.map((layer) =>
        Math.max(...layer.map((n) => (resolvedOrientation === 'LR' ? n.width : n.height)), 44)
      );
      const rankFlowGap = (resolvedOrientation === 'LR' ? 52 : 38) * resolvedSpacingScale;

      const rankCenters: number[] = [];
      let cursorX = margin + 52 + 44;
      layers.forEach((_l, rIdx) => {
        const w = rankWidths[rIdx];
        rankCenters.push(cursorX + w / 2);
        cursorX += w + rankFlowGap;
      });
      const maxXExtent = cursorX + 24;

      const lanePaddingY = 22;
      const laneRowHeight = 96 * resolvedSpacingScale;
      let currentY = margin;

      graph.lanes.forEach((lane) => {
        const rankCounts = new Map<number, number>();
        rawNodes.forEach((n) => {
          if (n.laneId === lane.id) {
            const r = rankMap.get(n.id) || 0;
            rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
          }
        });
        const maxInLane = Math.max(...Array.from(rankCounts.values()), 1);
        const laneHeight = Math.max(laneRowHeight, maxInLane * 68 + lanePaddingY * 2);

        layoutLanes.push({
          id: lane.id,
          label: lane.label,
          x: 20,
          y: currentY,
          width: maxXExtent - 20,
          height: laneHeight,
        });

        layers.forEach((layer, rIdx) => {
          const nodesHere = layer.filter((n) => n.laneId === lane.id);
          nodesHere.forEach((n, idx) => {
            const slotOffset = (idx - (nodesHere.length - 1) / 2) * 68;
            layoutNodes.push({
              ...n,
              rank: rIdx,
              x: rankCenters[rIdx],
              y: currentY + laneHeight / 2 + slotOffset,
            });
          });
        });

        currentY += laneHeight;
      });

      rawNodes.forEach((n) => {
        if (!layoutNodes.some((ln) => ln.id === n.id)) {
          const rIdx = rankMap.get(n.id) || 0;
          layoutNodes.push({
            ...n,
            rank: rIdx,
            x: rankCenters[rIdx] ?? margin + 90,
            y: currentY + 42,
          });
        }
      });
    } else {
      placeLayeredOrSpine(false);
    }
  }

  // ── Pull START / END Terminals Right Next to Connected Activities ──────────
  if (layoutNodes.length > 1) {
    const nodeLookup = new Map(layoutNodes.map((n) => [n.id, n]));
    const othersExcept = (skipId: string) => layoutNodes.filter((n) => n.id !== skipId);
    const hasCollision = (
      cx: number,
      cy: number,
      w: number,
      h: number,
      others: LayoutNode[],
      padX = 14,
      padY = 14
    ) =>
      others.some(
        (o) =>
          Math.abs(cx - o.x) < (w + o.width) / 2 + padX &&
          Math.abs(cy - o.y) < (h + o.height) / 2 + padY
      );

    const segmentHitsBox = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      box: { x: number; y: number; width: number; height: number },
      padX = 6,
      padY = 6
    ): boolean => {
      const minX = box.x - box.width / 2 - padX;
      const maxX = box.x + box.width / 2 + padX;
      const minY = box.y - box.height / 2 - padY;
      const maxY = box.y + box.height / 2 + padY;
      const dx = bx - ax;
      const dy = by - ay;
      let t0 = 0;
      let t1 = 1;
      const checks: Array<[number, number]> = [
        [-dx, ax - minX],
        [dx, maxX - ax],
        [-dy, ay - minY],
        [dy, maxY - ay],
      ];
      for (const [p, q] of checks) {
        if (Math.abs(p) < 1e-9) {
          if (q < 0) return false;
        } else {
          const r = q / p;
          if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
          } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
          }
        }
      }
      return t0 <= t1;
    };

    const placeTerminalAdjacent = (
      termNode: LayoutNode,
      connected: Array<{ node: LayoutNode; w: number }>,
      direction: 'upstream' | 'downstream'
    ) => {
      if (connected.length === 0) return;
      const sorted = [...connected].sort((a, b) => b.w - a.w);
      const primary = sorted[0].node;
      const anchorIds = new Set(sorted.map((item) => item.node.id));
      const others = othersExcept(termNode.id);
      const nonAnchorOthers = others.filter((o) => !anchorIds.has(o.id));

      const wSum = sorted.reduce((s, t) => s + Math.max(t.w, 1), 0);
      const avgX = sorted.reduce((s, t) => s + t.node.x * Math.max(t.w, 1), 0) / wSum;
      const avgY = sorted.reduce((s, t) => s + t.node.y * Math.max(t.w, 1), 0) / wSum;

      const scale = Math.min(1.15, resolvedSpacingScale);
      const gapMain = Math.round(46 * scale);
      const gapSide = Math.round(58 * scale);
      const flowDir = direction === 'downstream' ? 1 : -1;

      const peers =
        resolvedOrientation === 'TB'
          ? others.filter((o) => Math.abs(o.y - primary.y) <= 64)
          : others.filter((o) => Math.abs(o.x - primary.x) <= 84);
      const peerMidCross =
        peers.length > 0
          ? resolvedOrientation === 'TB'
            ? (Math.min(...peers.map((o) => o.x)) + Math.max(...peers.map((o) => o.x))) / 2
            : (Math.min(...peers.map((o) => o.y)) + Math.max(...peers.map((o) => o.y))) / 2
          : resolvedOrientation === 'TB'
          ? primary.x
          : primary.y;
      const preferSide: 1 | -1 =
        (resolvedOrientation === 'TB' ? primary.x : primary.y) <= peerMidCross ? -1 : 1;

      const candidates: Array<{ x: number; y: number }> = [];

      if (resolvedOrientation === 'LR') {
        if (sorted.length > 1) {
          const groupMainX =
            direction === 'downstream'
              ? Math.max(...sorted.map((s) => s.node.x + s.node.width / 2)) +
                termNode.width / 2 +
                gapMain
              : Math.min(...sorted.map((s) => s.node.x - s.node.width / 2)) -
                termNode.width / 2 -
                gapMain;
          candidates.push({ x: groupMainX, y: avgY });
        }

        const mainAhead =
          primary.x + flowDir * (primary.width / 2 + gapMain + termNode.width / 2);
        const mainBehind =
          primary.x - flowDir * (primary.width / 2 + gapMain + termNode.width / 2);
        const sidePrefY =
          primary.y + preferSide * (primary.height / 2 + gapSide + termNode.height / 2);
        const sideOppY =
          primary.y - preferSide * (primary.height / 2 + gapSide + termNode.height / 2);
        const diagOffset = flowDir * Math.round(primary.width * 0.3);

        candidates.push(
          { x: mainAhead, y: primary.y },
          { x: primary.x + diagOffset, y: sidePrefY },
          { x: primary.x, y: sidePrefY },
          { x: primary.x + diagOffset, y: sideOppY },
          { x: primary.x, y: sideOppY },
          { x: primary.x + diagOffset, y: sidePrefY + preferSide * 20 },
          { x: primary.x - diagOffset, y: sidePrefY },
          { x: primary.x - diagOffset, y: sideOppY },
          { x: mainBehind, y: primary.y }
        );
      } else {
        if (sorted.length > 1) {
          const groupMainY =
            direction === 'downstream'
              ? Math.max(...sorted.map((s) => s.node.y + s.node.height / 2)) +
                termNode.height / 2 +
                gapMain
              : Math.min(...sorted.map((s) => s.node.y - s.node.height / 2)) -
                termNode.height / 2 -
                gapMain;
          candidates.push({ x: avgX, y: groupMainY });
        }

        const mainAhead =
          primary.y + flowDir * (primary.height / 2 + gapMain + termNode.height / 2);
        const mainBehind =
          primary.y - flowDir * (primary.height / 2 + gapMain + termNode.height / 2);
        const sidePrefX =
          primary.x + preferSide * (primary.width / 2 + gapSide + termNode.width / 2);
        const sideOppX =
          primary.x - preferSide * (primary.width / 2 + gapSide + termNode.width / 2);
        const diagOffset = flowDir * Math.round(primary.height * 0.42);

        candidates.push(
          { x: primary.x, y: mainAhead },
          { x: sidePrefX, y: primary.y + diagOffset },
          { x: sidePrefX, y: primary.y },
          { x: sideOppX, y: primary.y + diagOffset },
          { x: sideOppX, y: primary.y },
          { x: sidePrefX + preferSide * 24, y: primary.y + diagOffset },
          { x: sidePrefX, y: primary.y - diagOffset },
          { x: sideOppX, y: primary.y - diagOffset },
          { x: primary.x, y: mainBehind }
        );
      }

      const chosen = candidates.find(
        (c) =>
          !hasCollision(c.x, c.y, termNode.width, termNode.height, others, 14, 14) &&
          !nonAnchorOthers.some((o) => segmentHitsBox(primary.x, primary.y, c.x, c.y, o, 6, 6))
      );

      if (chosen) {
        termNode.x = chosen.x;
        termNode.y = chosen.y;
        return;
      }

      // Guaranteed adjacency fallback: carve an open side slot next to the primary connected node
      if (resolvedOrientation === 'LR') {
        const shiftAmount = preferSide * (termNode.height + gapSide + 24);
        others.forEach((o) => {
          if (
            Math.abs(o.x - primary.x) <= primary.width + termNode.width &&
            (o.y - primary.y) * preferSide > 0
          ) {
            o.y += shiftAmount;
          }
        });
        termNode.x = primary.x;
        termNode.y =
          primary.y + preferSide * (primary.height / 2 + gapSide + termNode.height / 2);
      } else {
        const shiftAmount = preferSide * (termNode.width + gapSide + 24);
        others.forEach((o) => {
          if (
            Math.abs(o.y - primary.y) <= primary.height + termNode.height &&
            (o.x - primary.x) * preferSide > 0
          ) {
            o.x += shiftAmount;
          }
        });
        termNode.x =
          primary.x + preferSide * (primary.width / 2 + gapSide + termNode.width / 2);
        termNode.y = primary.y;
      }
    };

    const startLn = nodeLookup.get('__start__');
    if (startLn) {
      const startTargets = rawEdges
        .filter((e) => e.isStartArc)
        .map((e) => ({ node: nodeLookup.get(e.target), w: e.count ?? e.weightRatio }))
        .filter((item): item is { node: LayoutNode; w: number } => Boolean(item.node));
      placeTerminalAdjacent(startLn, startTargets, 'upstream');
    }

    const endLn = nodeLookup.get('__end__');
    if (endLn) {
      const endSources = rawEdges
        .filter((e) => e.isEndArc)
        .map((e) => ({ node: nodeLookup.get(e.source), w: e.count ?? e.weightRatio }))
        .filter((item): item is { node: LayoutNode; w: number } => Boolean(item.node));
      placeTerminalAdjacent(endLn, endSources, 'downstream');
    }

    // Keep all coordinates inside margin >= 36
    const minLeft = Math.min(...layoutNodes.map((n) => n.x - n.width / 2));
    const minTop = Math.min(...layoutNodes.map((n) => n.y - n.height / 2));
    const shiftRight = minLeft < margin ? margin - minLeft : 0;
    const shiftDown = minTop < margin ? margin - minTop : 0;
    if (shiftRight > 0 || shiftDown > 0) {
      layoutNodes.forEach((n) => {
        n.x += shiftRight;
        n.y += shiftDown;
      });
      layoutLanes.forEach((l) => {
        l.x += shiftRight;
        l.y += shiftDown;
      });
    }
  }

  // ── Edge Routing, Bundling Corridors & Backbone Opacity Attenuation ────────
  const posById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edgePairSet = new Set(rawEdges.map((e) => `${e.source}|||${e.target}`));
  let selfLoopCount = 0;
  let bidirectionalCount = 0;
  let finalBackEdges = 0;

  // Compute central spine line along cross-axis for Bundled highway corridors
  const crossCoords = layoutNodes.map((n) => (resolvedOrientation === 'LR' ? n.y : n.x));
  const minCrossBound = Math.min(...crossCoords, 100);
  const maxCrossBound = Math.max(...crossCoords, 400);
  const spineCenterCross = (minCrossBound + maxCrossBound) / 2;

  const layoutEdges: LayoutEdge[] = rawEdges.map((e, idx) => {
    const isSelfLoop = e.source === e.target;
    const sRank = rankMap.get(e.source) ?? 0;
    const tRank = rankMap.get(e.target) ?? 0;
    const isBackEdge = !isSelfLoop && (backEdgeIds.has(e.id) || tRank < sRank);
    const hasReverse = !isSelfLoop && edgePairSet.has(`${e.target}|||${e.source}`);

    const aKey = e.source < e.target ? e.source : e.target;
    const bKey = e.source < e.target ? e.target : e.source;
    const isBackbone =
      Boolean(e.isStartArc || e.isEndArc) ||
      mstDirectedIds.has(e.id) ||
      (mstUndirectedKeys.has(`${aKey}|||${bKey}`) && e.weightRatio >= 0.45);

    if (isSelfLoop) selfLoopCount += 1;
    if (isBackEdge) finalBackEdges += 1;
    if (hasReverse) bidirectionalCount += 1;

    const sChunk = rankToChunk.get(sRank) ?? 0;
    const tChunk = rankToChunk.get(tRank) ?? 0;
    const isCrossChunkForward = chunkLongGraphActive && sChunk !== tChunk && tRank > sRank;

    let curveOffset = 0;
    if (resolvedRouting === 'bundled') {
      const sPt = posById.get(e.source);
      const tPt = posById.get(e.target);
      const midCross =
        sPt && tPt
          ? ((resolvedOrientation === 'LR' ? sPt.y + tPt.y : sPt.x + tPt.x) / 2)
          : spineCenterCross;
      const sideSign = midCross <= spineCenterCross ? -1 : 1;
      curveOffset = isBackbone
        ? hasReverse
          ? 16
          : 0
        : isBackEdge
        ? 44 + (idx % 3) * 14
        : sideSign * (24 + (idx % 4) * 10);
    } else if (isBackEdge) {
      curveOffset = 58 + Math.min(54, Math.max(1, sRank - tRank) * 14);
    } else if (hasReverse) {
      curveOffset = 24;
    } else if (isCrossChunkForward) {
      curveOffset = tRank - sRank === 1 ? 0 : (idx % 2 === 0 ? 1 : -1) * 18;
    } else if (Math.abs(tRank - sRank) > 1) {
      curveOffset = (idx % 2 === 0 ? 1 : -1) * 28;
    }

    // Bundling corridor target offset relative to spineCenterCross
    const sPt = posById.get(e.source);
    const tPt = posById.get(e.target);
    const avgCross =
      sPt && tPt
        ? ((resolvedOrientation === 'LR' ? sPt.y + tPt.y : sPt.x + tPt.x) / 2)
        : spineCenterCross;
    const side = avgCross < spineCenterCross ? -1 : 1;
    const bundleOffset = isBackEdge
      ? maxCrossBound + 42 + (idx % 3) * 12
      : spineCenterCross + side * (Math.max(90, (maxCrossBound - minCrossBound) * 0.34) + (idx % 3) * 12);

    let opacityHint = 1;
    if (resolvedHighlightBackbone) {
      if (e.isStartArc || e.isEndArc) {
        opacityHint = 0.72;
      } else if (isBackbone) {
        opacityHint = 0.96;
      } else if (e.weightRatio >= 0.42) {
        opacityHint = 0.68;
      } else if (e.weightRatio >= 0.2) {
        opacityHint = 0.34;
      } else {
        opacityHint = E >= 180 ? 0.08 : 0.14;
      }
    }

    return {
      ...e,
      isSelfLoop,
      isBackEdge,
      isBidirectional: hasReverse,
      isBackbone,
      bundleOffset,
      curveOffset,
      pathStyle: resolvedRouting,
      opacityHint,
    };
  });

  // ── Force Planar Embedding (when graph is planar & Force Planar is active) ─
  if (planarForcedActive) {
    const placeUnfoldedSugiyama = () => {
      layoutNodes.length = 0;
      const rankWidths = layers.map((layer) =>
        Math.max(...layer.map((n) => (resolvedOrientation === 'LR' ? n.width : n.height)), 44)
      );
      const maxNodeW = Math.max(...rawNodes.map((n) => n.width), 160);
      const rankFlowGap = (resolvedOrientation === 'LR' ? 56 : 42) * resolvedSpacingScale;
      const nodeGap =
        resolvedOrientation === 'LR'
          ? Math.max(72, 82 * resolvedSpacingScale)
          : Math.max(maxNodeW + 28, 200 * resolvedSpacingScale);

      let mainCursor = margin + 24;
      layers.forEach((layer, rIdx) => {
        const span = (layer.length - 1) * nodeGap;
        const centerOffset = ((maxRankBreadth - 1) * nodeGap) / 2;
        const rSize = rankWidths[rIdx];
        const mainCoord = mainCursor + rSize / 2;
        layer.forEach((n, idx) => {
          const crossCoord = margin + 48 + centerOffset - span / 2 + idx * nodeGap;
          layoutNodes.push({
            ...n,
            rank: rIdx,
            x: resolvedOrientation === 'LR' ? mainCoord : crossCoord,
            y: resolvedOrientation === 'LR' ? crossCoord : mainCoord,
          });
        });
        mainCursor += rSize + rankFlowGap;
      });
    };

    const routeSkipEdgesOutward = () => {
      const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
      layoutEdges.forEach((edge) => {
        if (edge.isSelfLoop || edge.isBackEdge) return;
        const sRank = rankMap.get(edge.source) ?? 0;
        const tRank = rankMap.get(edge.target) ?? 0;
        const sNode = nodeMap.get(edge.source);
        const tNode = nodeMap.get(edge.target);
        if (!sNode || !tNode || Math.abs(tRank - sRank) <= 1) {
          if (!edge.isBidirectional) {
            edge.curveOffset = 0;
            delete edge.planarControlPoint;
          }
          return;
        }
        const loR = Math.min(sRank, tRank);
        const hiR = Math.max(sRank, tRank);
        const skippedNodes = layoutNodes.filter((n) => n.rank > loR && n.rank < hiR);
        if (skippedNodes.length === 0) return;

        const isLR = resolvedOrientation === 'LR';
        const skippedCoords = skippedNodes.map((n) => (isLR ? n.y : n.x));
        const skippedCenter = skippedCoords.reduce((a, b) => a + b, 0) / skippedCoords.length;
        const avgCross = ((isLR ? sNode.y + tNode.y : sNode.x + tNode.x) / 2);
        const side = avgCross >= skippedCenter ? 1 : -1;
        const extremeEdge =
          side > 0
            ? Math.max(...skippedNodes.map((n) => (isLR ? n.y + n.height / 2 : n.x + n.width / 2)))
            : Math.min(...skippedNodes.map((n) => (isLR ? n.y - n.height / 2 : n.x - n.width / 2)));

        const clearance = (isLR ? 44 : 52) * resolvedSpacingScale;
        const targetCross = extremeEdge + side * clearance;
        const mx = (sNode.x + tNode.x) / 2;
        const my = (sNode.y + tNode.y) / 2;
        const cpCross = isLR
          ? side > 0
            ? Math.max(my, 2 * targetCross - my)
            : Math.min(my, 2 * targetCross - my)
          : side > 0
          ? Math.max(mx, 2 * targetCross - mx)
          : Math.min(mx, 2 * targetCross - mx);
        edge.planarControlPoint = isLR ? { x: mx, y: cpCross } : { x: cpCross, y: my };
      });
    };

    const placeConvexPlanarRing = (order: string[]) => {
      const nCount = order.length;
      const rawById = new Map(rawNodes.map((n) => [n.id, n]));
      const orderedRaw = order
        .map((id) => rawById.get(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n));
      if (orderedRaw.length === 0) return;

      // Rotate order so __start__ (or rank 0) starts at the left/top anchor
      const startHint = orderedRaw.findIndex((n) => n.id === '__start__' || n.isStart);
      const rotated =
        startHint > 0
          ? [...orderedRaw.slice(startHint), ...orderedRaw.slice(0, startHint)]
          : orderedRaw;

      const avgCardSpan =
        rotated.reduce(
          (sum, n) => sum + (resolvedOrientation === 'LR' ? n.width * 0.72 + n.height * 0.45 : n.width * 0.55 + n.height * 0.72),
          0
        ) / rotated.length;
      const minPerimeter = rotated.length * (avgCardSpan + 48) * resolvedSpacingScale;
      let rx = Math.max(230, (minPerimeter / (2 * Math.PI)) * 1.18);
      let ry = Math.max(175, (minPerimeter / (2 * Math.PI)) * 0.92);

      const applyEllipse = (scale: number) => {
        layoutNodes.length = 0;
        const curRx = rx * scale;
        const curRy = ry * scale;
        const cx = margin + curRx + 115;
        const cy = margin + curRy + 60;
        const baseAngle = resolvedOrientation === 'LR' ? Math.PI : -Math.PI / 2;

        rotated.forEach((n, i) => {
          const theta = baseAngle + (i / nCount) * Math.PI * 2;
          layoutNodes.push({
            ...n,
            rank: rankMap.get(n.id) ?? i,
            x: cx + curRx * Math.cos(theta),
            y: cy + curRy * Math.sin(theta),
          });
        });

        const posMap = new Map(layoutNodes.map((n) => [n.id, n]));
        layoutEdges.forEach((edge) => {
          if (edge.isSelfLoop) return;
          const s = posMap.get(edge.source);
          const t = posMap.get(edge.target);
          if (!s || !t) return;
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          if (edge.isBidirectional) {
            const nx = -dy / d;
            const ny = dx / d;
            edge.planarControlPoint = { x: mx + nx * 11, y: my + ny * 11 };
            edge.curveOffset = 11;
          } else {
            edge.planarControlPoint = { x: mx, y: my };
            edge.curveOffset = 0;
          }
        });
      };

      for (const scale of [1.0, 1.25, 1.55]) {
        applyEllipse(scale);
        if (countPlanarDrawingViolations(layoutNodes, layoutEdges, resolvedOrientation) === 0) {
          break;
        }
      }
    };

    const placeTwoPageSpine = (order: string[], edgeSideByKey: Map<string, 1 | -1>) => {
      const rawById = new Map(rawNodes.map((n) => [n.id, n]));
      const orderedRaw = order
        .map((id) => rawById.get(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n));
      if (orderedRaw.length === 0) return;

      const isLR = resolvedOrientation === 'LR';
      const maxW = Math.max(...orderedRaw.map((n) => n.width), 160);
      const maxH = Math.max(...orderedRaw.map((n) => n.height), 56);
      const step = (isLR ? maxW + 46 : maxH + 46) * resolvedSpacingScale;

      const idxById = new Map<string, number>();
      orderedRaw.forEach((n, i) => idxById.set(n.id, i));

      let maxSpan = 1;
      layoutEdges.forEach((e) => {
        const si = idxById.get(e.source);
        const ti = idxById.get(e.target);
        if (si !== undefined && ti !== undefined) {
          maxSpan = Math.max(maxSpan, Math.abs(si - ti));
        }
      });

      const spineCross = margin + 60 + Math.max(120, maxSpan * 36 * resolvedSpacingScale);
      layoutNodes.length = 0;
      orderedRaw.forEach((n, i) => {
        const mainCoord = margin + 90 + i * step;
        layoutNodes.push({
          ...n,
          rank: rankMap.get(n.id) ?? i,
          x: isLR ? mainCoord : spineCross,
          y: isLR ? spineCross : mainCoord,
        });
      });

      const posMap = new Map(layoutNodes.map((n) => [n.id, n]));
      layoutEdges.forEach((edge) => {
        if (edge.isSelfLoop) return;
        const s = posMap.get(edge.source);
        const t = posMap.get(edge.target);
        const si = idxById.get(edge.source);
        const ti = idxById.get(edge.target);
        if (!s || !t || si === undefined || ti === undefined) return;
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        const span = Math.abs(si - ti);
        if (span <= 1) {
          if (edge.isBidirectional) {
            const off = si < ti ? 14 : -14;
            edge.planarControlPoint = isLR ? { x: mx, y: my + off } : { x: mx + off, y: my };
          } else {
            edge.planarControlPoint = { x: mx, y: my };
          }
          return;
        }
        const a = edge.source < edge.target ? edge.source : edge.target;
        const b = edge.source < edge.target ? edge.target : edge.source;
        const pageSide = edgeSideByKey.get(`${a}|||${b}`) ?? 1;
        const arcH = (62 + (span - 1) * 34) * resolvedSpacingScale * (edge.isBidirectional && si > ti ? 1.12 : 1);
        edge.planarControlPoint = isLR
          ? { x: mx, y: my + pageSide * arcH }
          : { x: mx + pageSide * arcH, y: my };
      });
    };

    // Prefer clean unfolded Sugiyama if acyclic & crossing-free
    if (resolvedAlgorithm !== 'sugiyama') {
      placeUnfoldedSugiyama();
    }
    routeSkipEdgesOutward();

    const currentViolations =
      finalBackEdges > 0 || layeredCrossings > 0
        ? 1
        : countPlanarDrawingViolations(layoutNodes, layoutEdges, resolvedOrientation);

    if (currentViolations > 0) {
      const allNodeIds = rawNodes.map((n) => n.id);
      const allPairsSeen = new Set<string>();
      const allUndirectedPairs: Array<[string, string]> = [];
      rawEdges.forEach((e) => {
        if (e.source === e.target) return;
        const a = e.source < e.target ? e.source : e.target;
        const b = e.source < e.target ? e.target : e.source;
        const k = `${a}|||${b}`;
        if (!allPairsSeen.has(k)) {
          allPairsSeen.add(k);
          allUndirectedPairs.push([a, b]);
        }
      });

      const allCirc = testCircularPlanarity(allNodeIds, allUndirectedPairs);
      if (allCirc.crossings === 0) {
        placeConvexPlanarRing(allCirc.order);
      } else {
        const twoPageAll = findTwoPagePlanarEmbedding(allCirc.order, allUndirectedPairs);
        if (twoPageAll) {
          placeTwoPageSpine(twoPageAll.order, twoPageAll.edgeSideByKey);
        } else if (twoPageCore) {
          const fullOrder = [
            ...(hasStarts ? ['__start__'] : []),
            ...twoPageCore.order,
            ...(hasEnds ? ['__end__'] : []),
          ];
          const twoPageFull = findTwoPagePlanarEmbedding(fullOrder, allUndirectedPairs);
          if (twoPageFull) {
            placeTwoPageSpine(twoPageFull.order, twoPageFull.edgeSideByKey);
          }
        }
      }

      // Normalize positive margin after planar placement
      const cpXList = layoutEdges
        .map((e) => e.planarControlPoint?.x)
        .filter((v): v is number => v !== undefined);
      const cpYList = layoutEdges
        .map((e) => e.planarControlPoint?.y)
        .filter((v): v is number => v !== undefined);
      const pMinLeft = Math.min(...layoutNodes.map((n) => n.x - n.width / 2), ...cpXList);
      const pMinTop = Math.min(...layoutNodes.map((n) => n.y - n.height / 2), ...cpYList);
      const pShiftX = pMinLeft < margin ? margin - pMinLeft : 0;
      const pShiftY = pMinTop < margin ? margin - pMinTop : 0;
      if (pShiftX > 0 || pShiftY > 0) {
        layoutNodes.forEach((n) => {
          n.x += pShiftX;
          n.y += pShiftY;
        });
        layoutEdges.forEach((e) => {
          if (e.planarControlPoint) {
            e.planarControlPoint.x += pShiftX;
            e.planarControlPoint.y += pShiftY;
          }
        });
      }
    }
  }

  // Sort edges so dimmed long-tail spaghetti draws underneath high-traffic backbone edges
  layoutEdges.sort((a, b) => {
    const ab = a.isBackbone ? 1 : 0;
    const bb = b.isBackbone ? 1 : 0;
    if (ab !== bb) return ab - bb;
    return (a.opacityHint ?? 1) - (b.opacityHint ?? 1);
  });

  const cpMaxX = layoutEdges
    .map((e) => e.planarControlPoint?.x)
    .filter((v): v is number => v !== undefined);
  const cpMaxY = layoutEdges
    .map((e) => e.planarControlPoint?.y)
    .filter((v): v is number => v !== undefined);

  const maxX =
    Math.max(
      ...layoutNodes.map((n) => n.x + n.width / 2),
      ...layoutLanes.map((l) => l.x + l.width),
      ...cpMaxX,
      460
    ) + margin;
  const maxY =
    Math.max(
      ...layoutNodes.map((n) => n.y + n.height / 2),
      ...layoutLanes.map((l) => l.y + l.height),
      ...cpMaxY,
      340
    ) +
    margin +
    (finalBackEdges > 0 ? 34 : 0);

  const autoReasons = {
    algorithm:
      resolvedAlgorithm === 'backbone_spine'
        ? `Backbone Spine selected for ${V} nodes and ${E} edges: anchors the Maximum-Weight Spanning Tree along the main trunk and fans variants cleanly.`
        : resolvedAlgorithm === 'stress_majorization'
        ? `Stress Layout selected across ${V} nodes: clusters frequent transitions via weighted shortest-path stress majorization.`
        : `Layered Flow selected across ${maxRank + 1} topological stages. Best for structured pipelines, Petri Nets, and BPMN.`,
    orientation: `${resolvedOrientation === 'LR' ? 'Left-Right' : 'Top-Down'} selected to balance aspect ratio across ${V} nodes at regular scale.`,
    routing:
      resolvedRouting === 'bundled'
        ? `Bundled highway corridors pull ${E} non-backbone arcs into shared trunks so dominant flows stand out.`
        : resolvedRouting === 'orthogonal'
        ? 'Orthogonal 90° routing keeps Petri Net and BPMN connectors aligned.'
        : 'Curved quadratic arcs cleanly separate bidirectional pairs and feedback loops.',
    crossingMin: !crossingApplicable
      ? 'Crossing pass is inactive when nodes are not placed in multi-item layered ranks.'
      : resolvedCrossingMin === 'intensive'
      ? `Intensive 10-pass median/barycenter + sifting chosen for ${maxRankBreadth}-wide layers across ${V} nodes.`
      : `Standard single forward pass preserves natural frequency order across ${V} nodes.`,
    backbone: resolvedHighlightBackbone
      ? `Backbone Focus enabled automatically (${E} edges, degree ${avgDegree}) to keep MST spine crisp while attenuating long-tail noise.`
      : `Backbone Focus off so all ${E} edges in this sparse graph stay equally visible.`,
    spacing: `Node spacing auto-tuned to ${defaultSpacingScale.toFixed(2)}x for ${V} nodes, degree ${avgDegree}, and max breadth ${maxRankBreadth}.`,
  };

  const appliedRulesRaw: LayoutRuleSummary['appliedRules'] = [];
  if (resolvedAlgorithm === 'backbone_spine') {
    appliedRulesRaw.push({
      rule: 'Backbone Spine',
      reason: `Extracts ${mstDirectedIds.size} MST backbone links and organizes ${maxRank + 1} stages around the main trunk.`,
      worksFor: 'Dense & spaghetti DFGs (42N/500E – 72N/1150E).',
    });
  } else if (resolvedAlgorithm === 'stress_majorization') {
    appliedRulesRaw.push({
      rule: 'Stress Layout',
      reason: `Minimizes weighted shortest-path stress across ${V} activities with overlap resolution.`,
      worksFor: 'Cyclic and community-clustered processes.',
    });
  } else {
    appliedRulesRaw.push({
      rule: 'Layered Flow',
      reason: `Orders ${maxRank + 1} topological stages to follow process flow.`,
      worksFor: 'Sparse/medium DFGs, Petri Nets, and BPMN.',
    });
  }

  if (resolvedHighlightBackbone) {
    appliedRulesRaw.push({
      rule: 'Backbone Focus',
      reason: `Keeps MST backbone crisp while dimming low-volume long-tail arcs across ${E} links.`,
      worksFor: 'Dense graphs with 36+ edges.',
    });
  }

  if (finalBackEdges > 0) {
    appliedRulesRaw.push({
      rule: 'Feedback Loops',
      reason: `Routes ${finalBackEdges} retry arcs outside the main spine.`,
      worksFor: 'Cyclic DFGs, Petri Nets, and BPMN processes with rework.',
    });
  }

  if (layoutLanes.length > 0) {
    appliedRulesRaw.push({
      rule: 'BPMN Swimlanes',
      reason: `Groups tasks horizontally across ${layoutLanes.length} lanes.`,
      worksFor: 'BPMN 2.0 collaboration models.',
    });
  }

  if (chunkLongGraphActive) {
    appliedRulesRaw.push({
      rule: 'Divide',
      reason: `Divides long sequence into ${new Set(rankToChunk.values()).size} minimal divisions so the graph fits in one view.`,
      worksFor: 'Long Top-Down or Left-Right process models.',
    });
  }

  if (planarForcedActive) {
    appliedRulesRaw.unshift({
      rule: 'Planar Enforcement',
      reason: 'Forces a zero-crossing planar embedding across all nodes and edges.',
      worksFor: 'Planar graphs.',
    });
  }

  const seenRuleTitles = new Set<string>();
  const appliedRules = appliedRulesRaw.filter((item) => {
    if (seenRuleTitles.has(item.rule)) return false;
    seenRuleTitles.add(item.rule);
    return true;
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    lanes: layoutLanes,
    width: maxX,
    height: maxY,
    summary: {
      resolvedAlgorithm,
      resolvedOrientation,
      resolvedRouting,
      resolvedCrossingMin,
      resolvedSpacingScale,
      resolvedHighlightBackbone,
      defaultSpacingScale,
      defaultHighlightBackbone: autoHighlightBackbone,
      forcePlanarActive: planarForcedActive,
      chunkLongGraphActive,
      orientationApplicable,
      crossingApplicable,
      availableAlgorithms,
      availableRoutings,
      autoReasons,
      densityClass,
      planarityStatus,
      planarityReason,
      undirectedEdgeCount: undirectedCount,
      maxPlanarEdges,
      isBipartite,
      avgDegree,
      rankCount: maxRank + 1,
      maxRankBreadth,
      backEdgeCount: finalBackEdges,
      selfLoopCount,
      bidirectionalPairs: Math.floor(bidirectionalCount / 2),
      crossingEstimate: planarForcedActive ? 0 : layeredCrossings,
      appliedRules,
    },
  };
}
