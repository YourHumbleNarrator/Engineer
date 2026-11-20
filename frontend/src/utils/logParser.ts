import {
  BPMNGraph,
  DFGGraph,
  EventTrace,
  GraphKind,
  GraphObject,
  PetriNetGraph,
  ProcessTreeGraph,
  ProcessTreeNode,
} from '../types/processMining';

export interface ParsedCsvPreview {
  headers: string[];
  rows: string[][];
}

export function previewCsvHeaders(text: string): ParsedCsvPreview {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const splitLine = (line: string) =>
    line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, '').trim());
  return {
    headers: splitLine(lines[0]),
    rows: lines.slice(1, 6).map(splitLine),
  };
}

export function parseCsvToTraces(
  text: string,
  caseIdCol = 'case:concept:name',
  activityCol = 'concept:name',
  timestampCol = 'time:timestamp'
): EventTrace[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error('CSV file must include a header row and at least one event row.');

  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const splitLine = (line: string) =>
    line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, '').trim());

  const headers = splitLine(lines[0]);
  const findCol = (preferred: string, fallbacks: string[]) => {
    const exact = headers.indexOf(preferred);
    if (exact >= 0) return exact;
    const lower = headers.map((h) => h.toLowerCase());
    for (const fb of [preferred.toLowerCase(), ...fallbacks]) {
      const idx = lower.indexOf(fb);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const cIdx = findCol(caseIdCol, ['case_id', 'caseid', 'case', 'trace_id']);
  const aIdx = findCol(activityCol, ['activity', 'event', 'task', 'action']);
  const tIdx = findCol(timestampCol, ['timestamp', 'time', 'date', 'start_time']);

  if (cIdx < 0 || aIdx < 0) {
    throw new Error(
      `Could not match Case ID (${caseIdCol}) or Activity (${activityCol}) columns in headers: ${headers.join(', ')}`
    );
  }

  const byCase = new Map<string, EventTrace['events']>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const cid = cells[cIdx];
    const act = cells[aIdx];
    if (!cid || !act) continue;
    const ts = tIdx >= 0 && cells[tIdx] ? cells[tIdx] : new Date(Date.now() + i * 60000).toISOString();
    const list = byCase.get(cid) || [];
    list.push({ activity: act, timestamp: ts });
    byCase.set(cid, list);
  }

  const traces: EventTrace[] = [];
  byCase.forEach((events, caseId) => {
    events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    traces.push({ caseId, events });
  });
  return traces;
}

export function parseXesToTraces(xmlText: string): EventTrace[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XES XML syntax.');
  }

  const traceEls = Array.from(doc.getElementsByTagName('trace'));
  if (traceEls.length === 0) {
    throw new Error('No <trace> elements found in XES log.');
  }

  const getAttr = (el: Element, key: string): string | undefined => {
    const children = Array.from(el.children);
    for (const child of children) {
      if (child.getAttribute('key') === key) {
        return child.getAttribute('value') || undefined;
      }
    }
    return undefined;
  };

  return traceEls.map((tEl, idx) => {
    const caseId = getAttr(tEl, 'concept:name') || `case-${idx + 1}`;
    const eventEls = Array.from(tEl.getElementsByTagName('event'));
    const events = eventEls
      .map((eEl, eIdx) => {
        const activity = getAttr(eEl, 'concept:name') || `Activity ${eIdx + 1}`;
        const timestamp =
          getAttr(eEl, 'time:timestamp') || new Date(Date.now() + eIdx * 60000).toISOString();
        const resource = getAttr(eEl, 'org:resource');
        return { activity, timestamp, resource };
      })
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return { caseId, events };
  });
}

export function parseEdgeListOrJsonGraph(text: string, filename: string): GraphObject {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as GraphObject;
    if (parsed && 'kind' in parsed) return parsed;
  }

  // Fallback parser for edge lists (source,target[,weight]) or simple GML/TXT
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const nodesMap = new Map<string, number>();
  const edges: DFGGraph['edges'] = [];
  const startSet: Record<string, number> = {};
  const endSet: Record<string, number> = {};
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  lines.forEach((line, idx) => {
    if (idx === 0 && /source/i.test(line) && /target/i.test(line)) return;
    const parts = line.split(/[,;\t\s]+/).filter(Boolean);
    if (parts.length < 2) return;
    const [src, tgt, weightRaw] = parts;
    const count = weightRaw && !Number.isNaN(Number(weightRaw)) ? Number(weightRaw) : 1;
    nodesMap.set(src, (nodesMap.get(src) || 0) + count);
    nodesMap.set(tgt, (nodesMap.get(tgt) || 0) + count);
    outgoing.add(src);
    incoming.add(tgt);
    edges.push({
      id: `ge_${idx}`,
      source: src,
      target: tgt,
      count,
    });
  });

  nodesMap.forEach((cnt, id) => {
    if (!incoming.has(id)) startSet[id] = cnt;
    if (!outgoing.has(id)) endSet[id] = cnt;
  });

  return {
    kind: 'dfg',
    id: `uploaded-${Date.now()}`,
    name: filename,
    activities: Array.from(nodesMap.entries()).map(([id, count]) => ({
      id,
      label: id,
      count,
    })),
    startActivities: startSet,
    endActivities: endSet,
    edges,
  };
}

export function discoverGraphFromTraces(
  traces: EventTrace[],
  output: GraphKind,
  algorithm: 'alpha' | 'inductive' | 'heuristics',
  name = 'Discovered Model'
): GraphObject {
  const actCounts = new Map<string, number>();
  const startCounts: Record<string, number> = {};
  const endCounts: Record<string, number> = {};
  const edgeCounts = new Map<string, { source: string; target: string; count: number; totalSec: number }>();
  const actResource = new Map<string, string>();

  for (const trace of traces) {
    if (trace.events.length === 0) continue;
    const first = trace.events[0].activity;
    const last = trace.events[trace.events.length - 1].activity;
    startCounts[first] = (startCounts[first] || 0) + 1;
    endCounts[last] = (endCounts[last] || 0) + 1;

    for (let i = 0; i < trace.events.length; i++) {
      const ev = trace.events[i];
      actCounts.set(ev.activity, (actCounts.get(ev.activity) || 0) + 1);
      if (ev.resource && !actResource.has(ev.activity)) {
        actResource.set(ev.activity, ev.resource);
      }
      if (i < trace.events.length - 1) {
        const next = trace.events[i + 1];
        const key = `${ev.activity}|||${next.activity}`;
        const dt = Math.max(
          0,
          (Date.parse(next.timestamp) - Date.parse(ev.timestamp)) / 1000 || 0
        );
        const existing = edgeCounts.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalSec += dt;
        } else {
          edgeCounts.set(key, { source: ev.activity, target: next.activity, count: 1, totalSec: dt });
        }
      }
    }
  }

  const dfg: DFGGraph = {
    kind: 'dfg',
    id: `local-dfg-${Date.now()}`,
    name: `${name} (${algorithm.toUpperCase()} · DFG)`,
    activities: Array.from(actCounts.entries()).map(([label, count]) => ({
      id: label,
      label,
      count,
    })),
    startActivities: startCounts,
    endActivities: endCounts,
    edges: Array.from(edgeCounts.values()).map((e, i) => ({
      id: `e_${i}`,
      source: e.source,
      target: e.target,
      count: e.count,
      meanDurationSec: e.totalSec > 0 ? Math.round(e.totalSec / e.count) : undefined,
    })),
  };

  if (output === 'dfg') return dfg;

  if (output === 'petri_net') {
    const places: PetriNetGraph['places'] = [
      { id: 'p_start', label: 'source', initialTokens: 1, isFinal: false },
      { id: 'p_end', label: 'sink', initialTokens: 0, isFinal: true },
    ];
    const transitions: PetriNetGraph['transitions'] = dfg.activities.map((a) => ({
      id: `t_${a.id}`,
      label: a.label,
      silent: false,
      frequency: a.count,
    }));
    const arcs: PetriNetGraph['arcs'] = [];

    Object.keys(dfg.startActivities).forEach((s, idx) => {
      arcs.push({ id: `as_${idx}`, source: 'p_start', target: `t_${s}`, weight: 1 });
    });
    Object.keys(dfg.endActivities).forEach((e, idx) => {
      arcs.push({ id: `ae_${idx}`, source: `t_${e}`, target: 'p_end', weight: 1 });
    });
    dfg.edges.forEach((edge, idx) => {
      const pId = `p_${idx}`;
      places.push({ id: pId, label: pId, initialTokens: 0, isFinal: false });
      arcs.push({ id: `a_in_${idx}`, source: `t_${edge.source}`, target: pId, weight: 1 });
      arcs.push({ id: `a_out_${idx}`, source: pId, target: `t_${edge.target}`, weight: 1 });
    });

    return {
      kind: 'petri_net',
      id: `local-pn-${Date.now()}`,
      name: `${name} (${algorithm.toUpperCase()} · Petri Net)`,
      places,
      transitions,
      arcs,
    };
  }

  if (output === 'process_tree') {
    // Build structured sequential/choice process tree from trace variants
    const variantMap = new Map<string, { seq: string[]; count: number }>();
    traces.forEach((t) => {
      const seq = t.events.map((e) => e.activity);
      const key = seq.join('→');
      const cur = variantMap.get(key);
      if (cur) cur.count += 1;
      else variantMap.set(key, { seq, count: 1 });
    });
    const variants = Array.from(variantMap.values()).sort((a, b) => b.count - a.count);

    const makeSeqNode = (seq: string[], count: number, prefix: string): ProcessTreeNode => {
      if (seq.length === 1) {
        return { id: `${prefix}_0`, type: 'activity', label: seq[0], frequency: count, children: [] };
      }
      return {
        id: `${prefix}_seq`,
        type: 'operator',
        operator: 'seq',
        frequency: count,
        children: seq.map((act, idx) => ({
          id: `${prefix}_${idx}`,
          type: 'activity',
          label: act,
          frequency: count,
          children: [],
        })),
      };
    };

    const root: ProcessTreeNode =
      variants.length === 1
        ? makeSeqNode(variants[0].seq, variants[0].count, 'pt')
        : {
            id: 'pt_root',
            type: 'operator',
            operator: 'xor',
            frequency: traces.length,
            children: variants.slice(0, 6).map((v, i) => makeSeqNode(v.seq, v.count, `v${i}`)),
          };

    return {
      kind: 'process_tree',
      id: `local-pt-${Date.now()}`,
      name: `${name} (${algorithm.toUpperCase()} · Process Tree)`,
      root,
    };
  }

  // BPMN
  const lanesSet = Array.from(new Set(Array.from(actResource.values())));
  const lanes: BPMNGraph['lanes'] = lanesSet.map((l) => ({ id: `lane_${l}`, label: l }));
  const nodes: BPMNGraph['nodes'] = [
    { id: 'bpmn_start', type: 'startEvent', label: 'Start', laneId: lanes[0]?.id },
    ...dfg.activities.map((a) => ({
      id: a.id,
      type: 'task' as const,
      label: a.label,
      laneId: actResource.get(a.id) ? `lane_${actResource.get(a.id)}` : lanes[0]?.id,
    })),
    { id: 'bpmn_end', type: 'endEvent', label: 'End', laneId: lanes[0]?.id },
  ];
  const edges: BPMNGraph['edges'] = [
    ...Object.keys(dfg.startActivities).map((s, i) => ({
      id: `bs_${i}`,
      source: 'bpmn_start',
      target: s,
    })),
    ...dfg.edges.map((e) => ({
      id: `be_${e.id}`,
      source: e.source,
      target: e.target,
      label: `${e.count}`,
    })),
    ...Object.keys(dfg.endActivities).map((e, i) => ({
      id: `bend_${i}`,
      source: e,
      target: 'bpmn_end',
    })),
  ];

  return {
    kind: 'bpmn',
    id: `local-bpmn-${Date.now()}`,
    name: `${name} (${algorithm.toUpperCase()} · BPMN 2.0)`,
    nodes,
    edges,
    lanes,
  };
}
