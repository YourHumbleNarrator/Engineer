import { loadAll as loadAllYaml } from 'js-yaml';
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
import { parseDotToDfg, parseMermaidToDfg } from './dfgNotations';

export interface ParsedCsvPreview {
  headers: string[];
  rows: string[][];
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const delim of candidates) {
    const count = headerLine.split(delim).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function previewCsvHeaders(text: string): ParsedCsvPreview {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  return {
    headers: splitCsvLine(lines[0], delimiter),
    rows: lines.slice(1, 6).map((l) => splitCsvLine(l, delimiter)),
  };
}

export function isCsvEdgeListHeaders(headers: string[]): boolean {
  if (headers.length < 2) return false;
  const lower = headers.map((h) => h.toLowerCase().trim());
  const hasCaseCol = lower.some((h) =>
    ['case:concept:name', 'case_id', 'caseid', 'case', 'trace_id'].includes(h)
  );
  const hasActCol = lower.some((h) =>
    ['concept:name', 'activity', 'event', 'task', 'action'].includes(h)
  );
  if (hasCaseCol && hasActCol) return false;

  const hasSource = lower.some(
    (h) => h.includes('source') || h === 'src' || h === 'from'
  );
  const hasTarget = lower.some(
    (h) => h.includes('target') || h === 'dst' || h === 'to'
  );
  return hasSource && hasTarget;
}

export function sanitiseXmlText(xmlText: string): string {
  let clean = xmlText.replace(/^\uFEFF/, '').replace(/^[\x00\s]+/, '');
  clean = clean.replace(/<\?xml([^?]*)\?>/i, (_match, attrs: string) => {
    const updated = attrs.replace(/encoding\s*=\s*["'][^"']*["']/i, '').trim();
    return `<?xml ${updated ? `${updated} ` : ''}encoding="UTF-8"?>`;
  });
  return clean;
}

export function parseCsvToTraces(
  text: string,
  caseIdCol = 'case:concept:name',
  activityCol = 'concept:name',
  timestampCol = 'time:timestamp'
): EventTrace[] {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV file must include a header row and at least one event row.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter);
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
    const cells = splitCsvLine(lines[i], delimiter);
    const cid = cells[cIdx];
    const act = cells[aIdx];
    if (!cid || !act) continue;
    const ts =
      tIdx >= 0 && cells[tIdx]
        ? cells[tIdx]
        : new Date(Date.now() + i * 60000).toISOString();
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
  const doc = parser.parseFromString(sanitiseXmlText(xmlText), 'application/xml');
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
          getAttr(eEl, 'time:timestamp') ||
          new Date(Date.now() + eIdx * 60000).toISOString();
        const resource = getAttr(eEl, 'org:resource');
        return { activity, timestamp, resource };
      })
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return { caseId, events };
  });
}

function buildDfgFromNodesAndEdges(
  filename: string,
  nodeLabels: Map<string, string>,
  rawEdges: Array<{ source: string; target: string; count: number }>
): DFGGraph {
  const counts = new Map<string, number>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  nodeLabels.forEach((_, id) => counts.set(id, 0));

  const edges: DFGGraph['edges'] = rawEdges.map((e, idx) => {
    if (!nodeLabels.has(e.source)) nodeLabels.set(e.source, e.source);
    if (!nodeLabels.has(e.target)) nodeLabels.set(e.target, e.target);
    const weight = Math.max(1, Math.round(Number.isFinite(e.count) ? e.count : 1));
    counts.set(e.source, (counts.get(e.source) || 0) + weight);
    counts.set(e.target, (counts.get(e.target) || 0) + weight);
    outgoing.add(e.source);
    incoming.add(e.target);
    return {
      id: `ge_${idx}`,
      source: e.source,
      target: e.target,
      count: weight,
    };
  });

  const startSet: Record<string, number> = {};
  const endSet: Record<string, number> = {};
  nodeLabels.forEach((_, id) => {
    const c = Math.max(1, counts.get(id) || 1);
    if (!incoming.has(id)) startSet[id] = c;
    if (!outgoing.has(id)) endSet[id] = c;
  });

  return {
    kind: 'dfg',
    id: `uploaded-${Date.now()}`,
    name: filename,
    activities: Array.from(nodeLabels.entries()).map(([id, label]) => ({
      id,
      label,
      count: Math.max(1, counts.get(id) || 1),
    })),
    startActivities: startSet,
    endActivities: endSet,
    edges,
  };
}

export function isNativeGraphObject(data: unknown): data is GraphObject {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const kind = (data as { kind?: unknown }).kind;
  return (
    kind === 'dfg' ||
    kind === 'petri_net' ||
    kind === 'process_tree' ||
    kind === 'bpmn'
  );
}

function parseJsonGraph(text: string, filename: string): GraphObject {
  const data = JSON.parse(text);
  if (isNativeGraphObject(data)) return data;

  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    for (const n of nodes) {
      if (typeof n === 'string' || typeof n === 'number') {
        nodeLabels.set(String(n), String(n));
      } else if (n && typeof n === 'object') {
        const rec = n as Record<string, unknown>;
        const id = String(rec.id ?? rec.name ?? '');
        if (id) nodeLabels.set(id, String(rec.label ?? rec.name ?? id));
      }
    }

    const linkList = Array.isArray(obj.links)
      ? obj.links
      : Array.isArray(obj.edges)
      ? obj.edges
      : Array.isArray(obj.arcs)
      ? obj.arcs
      : null;

    if (!linkList) {
      throw new Error(
        "JSON graph must be a ProcessCanvas model ('kind'), node-link dict ('links'), adjacency dict ('edges'/'arcs'), or list of edges."
      );
    }

    for (const e of linkList) {
      if (Array.isArray(e) && e.length >= 2) {
        rawEdges.push({
          source: String(e[0]),
          target: String(e[1]),
          count: e.length > 2 ? Number(e[2]) || 1 : 1,
        });
      } else if (e && typeof e === 'object') {
        const rec = e as Record<string, unknown>;
        const src = String(rec.source ?? rec.src ?? rec.from ?? '');
        const tgt = String(rec.target ?? rec.dst ?? rec.to ?? '');
        const w = Number(rec.weight ?? rec.count ?? 1) || 1;
        if (src && tgt) rawEdges.push({ source: src, target: tgt, count: w });
      }
    }
    return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
  }

  if (Array.isArray(data)) {
    for (const e of data) {
      if (Array.isArray(e) && e.length >= 2) {
        rawEdges.push({
          source: String(e[0]),
          target: String(e[1]),
          count: e.length > 2 ? Number(e[2]) || 1 : 1,
        });
      } else if (e && typeof e === 'object') {
        const rec = e as Record<string, unknown>;
        const src = String(rec.source ?? rec.src ?? rec.from ?? '');
        const tgt = String(rec.target ?? rec.dst ?? rec.to ?? '');
        const w = Number(rec.weight ?? rec.count ?? 1) || 1;
        if (src && tgt) rawEdges.push({ source: src, target: tgt, count: w });
      }
    }
    return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
  }

  throw new Error('Unsupported JSON graph format.');
}

function parseGraphml(text: string, filename: string): DFGGraph {
  const doc = new DOMParser().parseFromString(sanitiseXmlText(text), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GraphML XML.');

  const labelKeyIds = new Set<string>();
  Array.from(doc.getElementsByTagName('key')).forEach((k) => {
    const attrName = (k.getAttribute('attr.name') || '').toLowerCase();
    if (attrName === 'label' || attrName === 'name') {
      const id = k.getAttribute('id');
      if (id) labelKeyIds.add(id);
    }
  });

  const nodeLabels = new Map<string, string>();
  Array.from(doc.getElementsByTagName('node')).forEach((n) => {
    const id = n.getAttribute('id');
    if (!id) return;
    let label = id;
    for (const d of Array.from(n.getElementsByTagName('data'))) {
      const k = d.getAttribute('key') || '';
      if ((labelKeyIds.has(k) || k === 'label' || k === 'd0') && d.textContent?.trim()) {
        label = d.textContent.trim();
        break;
      }
    }
    nodeLabels.set(id, label);
  });

  const rawEdges: Array<{ source: string; target: string; count: number }> = [];
  Array.from(doc.getElementsByTagName('edge')).forEach((e) => {
    const source = e.getAttribute('source');
    const target = e.getAttribute('target');
    if (!source || !target) return;
    let count = 1;
    for (const d of Array.from(e.getElementsByTagName('data'))) {
      const k = (d.getAttribute('key') || '').toLowerCase();
      const val = Number(d.textContent?.trim());
      if ((k.includes('weight') || k.includes('count') || k === 'd1') && !Number.isNaN(val)) {
        count = val;
        break;
      }
    }
    rawEdges.push({ source, target, count });
  });

  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

function parseGexf(text: string, filename: string): DFGGraph {
  const doc = new DOMParser().parseFromString(sanitiseXmlText(text), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GEXF XML.');

  const nodeLabels = new Map<string, string>();
  Array.from(doc.getElementsByTagName('node')).forEach((n) => {
    const id = n.getAttribute('id');
    if (!id) return;
    nodeLabels.set(id, n.getAttribute('label') || id);
  });

  const rawEdges: Array<{ source: string; target: string; count: number }> = [];
  Array.from(doc.getElementsByTagName('edge')).forEach((e) => {
    const source = e.getAttribute('source');
    const target = e.getAttribute('target');
    if (!source || !target) return;
    const w = Number(e.getAttribute('weight') || 1) || 1;
    rawEdges.push({ source, target, count: w });
  });

  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

function parseGml(text: string, filename: string): DFGGraph {
  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];

  const nodeRegex = /\bnode\s*\[([\s\S]*?)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = nodeRegex.exec(text)) !== null) {
    const block = m[1];
    const idMatch = block.match(/\bid\s+("([^"]*)"|\S+)/i);
    const labelMatch = block.match(/\blabel\s+"([^"]*)"/i);
    if (idMatch) {
      const id = idMatch[2] ?? idMatch[1];
      const label = labelMatch ? labelMatch[1] : id;
      nodeLabels.set(id, label);
    }
  }

  const edgeRegex = /\bedge\s*\[([\s\S]*?)\]/gi;
  while ((m = edgeRegex.exec(text)) !== null) {
    const block = m[1];
    const srcMatch = block.match(/\bsource\s+("([^"]*)"|\S+)/i);
    const tgtMatch = block.match(/\btarget\s+("([^"]*)"|\S+)/i);
    const valMatch = block.match(/\b(?:value|weight|count)\s+([\d.]+)/i);
    if (srcMatch && tgtMatch) {
      rawEdges.push({
        source: srcMatch[2] ?? srcMatch[1],
        target: tgtMatch[2] ?? tgtMatch[1],
        count: valMatch ? Number(valMatch[1]) || 1 : 1,
      });
    }
  }

  if (nodeLabels.size === 0 && rawEdges.length === 0) {
    throw new Error('Could not parse GML node/edge blocks.');
  }
  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

function parsePajek(text: string, filename: string): DFGGraph {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];
  let section: 'none' | 'vertices' | 'edges' = 'none';

  for (const line of lines) {
    if (line.startsWith('*')) {
      const lower = line.toLowerCase();
      if (lower.startsWith('*vertices')) section = 'vertices';
      else if (lower.startsWith('*arcs') || lower.startsWith('*edges')) section = 'edges';
      else section = 'none';
      continue;
    }
    if (section === 'vertices') {
      const match = line.match(/^(\S+)\s+"([^"]+)"|^(\S+)\s+(\S+)/);
      if (match) {
        const id = match[1] || match[3];
        const label = match[2] || match[4] || id;
        nodeLabels.set(id, label);
      }
    } else if (section === 'edges') {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        rawEdges.push({
          source: parts[0],
          target: parts[1],
          count: parts[2] && !Number.isNaN(Number(parts[2])) ? Number(parts[2]) : 1,
        });
      }
    }
  }

  if (nodeLabels.size === 0 && rawEdges.length === 0) {
    throw new Error('Could not parse Pajek vertices or edges.');
  }
  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

function stripLineCommentRespectingQuotes(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && raw[i - 1] !== '\\') {
      inDouble = !inDouble;
    } else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

function parseInlineKeyValueMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = text.trim().replace(/^\{|\}$/g, '').trim();
  if (!inner) return out;
  for (const part of splitCsvLine(inner, ',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx <= 0) continue;
    const k = part.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '').toLowerCase();
    const v = part.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (k) out[k] = v;
  }
  return out;
}

function extractNumericWeight(rec: Record<string, unknown>): number {
  const attrs =
    rec.attributes && typeof rec.attributes === 'object'
      ? (rec.attributes as Record<string, unknown>)
      : rec.data && typeof rec.data === 'object'
      ? (rec.data as Record<string, unknown>)
      : null;
  const candidates = [
    rec.weight,
    rec.count,
    rec.frequency,
    rec.freq,
    rec.value,
    rec.val,
    rec.w,
    attrs?.weight,
    attrs?.count,
    attrs?.frequency,
    attrs?.value,
    rec.label,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    if (typeof c === 'string' && c.trim() !== '') {
      const n = Number(c.trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 1;
}

function extractEdgeEndpoints(
  rec: Record<string, unknown>
): { source: string; target: string; count: number } | null {
  const inner =
    rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)
      ? ({ ...rec, ...(rec.data as Record<string, unknown>) } as Record<string, unknown>)
      : rec;
  const rawSrc =
    inner.source ??
    inner.src ??
    inner.from ??
    inner.u ??
    inner.start ??
    inner.tail ??
    inner.parent ??
    inner.origin;
  const rawTgt =
    inner.target ??
    inner.dst ??
    inner.dest ??
    inner.to ??
    inner.v ??
    inner.end ??
    inner.head ??
    inner.child ??
    inner.destination;
  const source = rawSrc !== undefined && rawSrc !== null ? String(rawSrc).trim() : '';
  const target = rawTgt !== undefined && rawTgt !== null ? String(rawTgt).trim() : '';
  if (!source || !target) return null;
  return { source, target, count: extractNumericWeight(inner) };
}

function loadYamlDocuments(text: string): unknown[] {
  const clean = text.replace(/^\uFEFF/, '');
  const tryLoadAll = (yamlText: string): unknown[] => {
    const docs: unknown[] = [];
    loadAllYaml(
      yamlText,
      (doc) => {
        if (doc !== undefined && doc !== null) docs.push(doc);
      },
      { json: true }
    );
    return docs;
  };

  try {
    return tryLoadAll(clean);
  } catch {
    const tagStripped = clean.replace(/(^|\s)!!?[A-Za-z0-9_.:/-]+(?=\s|$)/gm, '$1');
    try {
      return tryLoadAll(tagStripped);
    } catch {
      const tabNormalized = tagStripped.replace(/^\t+/gm, (m) => '  '.repeat(m.length));
      try {
        return tryLoadAll(tabNormalized);
      } catch {
        return [];
      }
    }
  }
}

function extractXesYamlAttr(
  obj: Record<string, unknown>,
  targetKeys: string[],
  depth = 0
): string | undefined {
  const lowerTargets = new Set(targetKeys.map((k) => k.toLowerCase()));

  const unwrapScalar = (val: unknown): string | undefined => {
    if (val instanceof Date) {
      return Number.isNaN(val.getTime()) ? undefined : val.toISOString();
    }
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      const s = String(val).trim();
      if (!s || s.toUpperCase() === '__NOTSPECIFIED__') return undefined;
      return s;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const rec = val as Record<string, unknown>;
      const inner =
        rec.value ??
        rec['@value'] ??
        rec.val ??
        rec['#text'] ??
        rec.text ??
        rec.content ??
        rec._;
      if (inner instanceof Date) {
        return Number.isNaN(inner.getTime()) ? undefined : inner.toISOString();
      }
      if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') {
        const s = String(inner).trim();
        if (!s || s.toUpperCase() === '__NOTSPECIFIED__') return undefined;
        return s;
      }
    }
    return undefined;
  };

  // 1. Direct properties on the object
  for (const [k, v] of Object.entries(obj)) {
    const cleanKey = k.replace(/^@/, '').toLowerCase();
    if (lowerTargets.has(cleanKey)) {
      const s = unwrapScalar(v);
      if (s) return s;
    }
  }

  // 2. Colon/dot-namespaced nested objects (e.g. `concept: { name: ... }`, `time: { timestamp: ... }`)
  for (const tk of targetKeys) {
    const sepIdx = tk.indexOf(':');
    if (sepIdx > 0) {
      const prefix = tk.slice(0, sepIdx).toLowerCase();
      const suffix = tk.slice(sepIdx + 1).toLowerCase();
      for (const [k, v] of Object.entries(obj)) {
        if (k.replace(/^@/, '').toLowerCase() === prefix && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
            if (sk.replace(/^@/, '').toLowerCase() === suffix) {
              const s = unwrapScalar(sv);
              if (s) return s;
            }
          }
        }
      }
    }
  }

  // 3. Nested attributes dict (`attributes` / `attrs` / `attribute` / `attrib` / `$` / `@` / `meta`)
  for (const attrContainerKey of ['attributes', 'attrs', 'attribute', 'attrib', '$', '@', 'meta']) {
    const bag = obj[attrContainerKey];
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
        if (lowerTargets.has(k.replace(/^@/, '').toLowerCase())) {
          const s = unwrapScalar(v);
          if (s) return s;
        }
      }
      if (depth < 2) {
        const nested = extractXesYamlAttr(bag as Record<string, unknown>, targetKeys, depth + 1);
        if (nested) return nested;
      }
    }
  }

  // 4. XES typed attribute elements (`string`, `date`, `int`, `float`, `boolean`, `id`, `xes:string`, etc.)
  const typedBuckets = [
    'string',
    'date',
    'int',
    'float',
    'boolean',
    'id',
    'xes:string',
    'xes:date',
    'xes:int',
    'xes:float',
    'xes:boolean',
    'xes:id',
    'attributes',
    'attrs',
    'attribute',
    'elements',
    'properties',
  ];
  for (const bucket of typedBuckets) {
    const raw = obj[bucket];
    if (!raw) continue;
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const recAttrs =
        (rec.attributes && typeof rec.attributes === 'object' && !Array.isArray(rec.attributes)
          ? (rec.attributes as Record<string, unknown>)
          : null) ??
        (rec.$ && typeof rec.$ === 'object' && !Array.isArray(rec.$)
          ? (rec.$ as Record<string, unknown>)
          : null) ??
        (rec['@'] && typeof rec['@'] === 'object' && !Array.isArray(rec['@'])
          ? (rec['@'] as Record<string, unknown>)
          : null) ??
        (rec.attrib && typeof rec.attrib === 'object' && !Array.isArray(rec.attrib)
          ? (rec.attrib as Record<string, unknown>)
          : null) ??
        (rec.attrs && typeof rec.attrs === 'object' && !Array.isArray(rec.attrs)
          ? (rec.attrs as Record<string, unknown>)
          : null) ??
        rec;
      const kRaw =
        recAttrs.key ??
        recAttrs['@key'] ??
        recAttrs.name ??
        recAttrs['@name'] ??
        recAttrs.k;
      const vRaw =
        recAttrs.value ??
        recAttrs['@value'] ??
        recAttrs.val ??
        recAttrs['#text'] ??
        recAttrs.text ??
        recAttrs.content ??
        recAttrs._ ??
        rec.value ??
        rec.text ??
        rec['#text'];
      if (typeof kRaw === 'string' && lowerTargets.has(kRaw.trim().toLowerCase())) {
        const s = unwrapScalar(vRaw);
        if (s) return s;
      }
      // Also support direct key:value object inside bucket
      for (const [dk, dv] of Object.entries(rec)) {
        if (lowerTargets.has(dk.replace(/^@/, '').toLowerCase())) {
          const s = unwrapScalar(dv);
          if (s) return s;
        }
      }
      if (depth < 1 && (rec.string || rec.date || rec.attributes || rec.attrs)) {
        const nested = extractXesYamlAttr(rec, targetKeys, depth + 1);
        if (nested) return nested;
      }
    }
  }

  // 5. XML-tree children array (`children: [{ tag: 'string', attributes: { key, value } }]`)
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      const rawChild = child as Record<string, unknown>;
      const cRec =
        rawChild.string && typeof rawChild.string === 'object' && !Array.isArray(rawChild.string)
          ? (rawChild.string as Record<string, unknown>)
          : rawChild.date && typeof rawChild.date === 'object' && !Array.isArray(rawChild.date)
          ? (rawChild.date as Record<string, unknown>)
          : rawChild;
      const cAttrs =
        (cRec.attributes && typeof cRec.attributes === 'object' && !Array.isArray(cRec.attributes)
          ? (cRec.attributes as Record<string, unknown>)
          : null) ??
        (cRec.$ && typeof cRec.$ === 'object' && !Array.isArray(cRec.$)
          ? (cRec.$ as Record<string, unknown>)
          : null) ??
        (cRec['@'] && typeof cRec['@'] === 'object' && !Array.isArray(cRec['@'])
          ? (cRec['@'] as Record<string, unknown>)
          : null) ??
        (cRec.attrib && typeof cRec.attrib === 'object' && !Array.isArray(cRec.attrib)
          ? (cRec.attrib as Record<string, unknown>)
          : null) ??
        cRec;
      const kRaw = cAttrs.key ?? cAttrs['@key'] ?? cAttrs.name ?? cAttrs['@name'];
      const vRaw =
        cAttrs.value ??
        cAttrs['@value'] ??
        cRec.value ??
        cRec.text ??
        cRec['#text'] ??
        cRec._;
      if (typeof kRaw === 'string' && lowerTargets.has(kRaw.trim().toLowerCase())) {
        const s = unwrapScalar(vRaw);
        if (s) return s;
      }
    }
  }

  return undefined;
}

function parseYamlEventLogDoc(doc: unknown): EventTrace[] | null {
  if (!doc || typeof doc !== 'object') return null;

  const isXmlTag = (c: unknown, target: string) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    const rec = c as Record<string, unknown>;
    const raw = String(rec.tag ?? rec.type ?? rec.nodeName ?? rec.element ?? rec.name ?? '').toLowerCase();
    return raw === target || raw.endsWith(`:${target}`);
  };

  const findLogContainer = (obj: Record<string, unknown>, depth = 0): Record<string, unknown> | null => {
    if (depth > 4) return null;
    if (
      'trace' in obj ||
      'traces' in obj ||
      'xes:trace' in obj ||
      'cases' in obj ||
      'events' in obj
    ) {
      return obj;
    }
    if (Array.isArray(obj.children) && obj.children.some((c) => isXmlTag(c, 'trace'))) {
      return obj;
    }
    const priority = ['log', 'xes:log', 'event_log', 'eventLog', 'data', 'root', 'document'];
    for (const key of priority) {
      const sub = obj[key];
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        const found = findLogContainer(sub as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
    for (const [key, sub] of Object.entries(obj)) {
      if (priority.includes(key)) continue;
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        const found = findLogContainer(sub as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
    // Check XML-tree `{ tag: 'log', children: [...] }`
    if (typeof obj.tag === 'string' && obj.tag.toLowerCase().endsWith('log') && Array.isArray(obj.children)) {
      return obj;
    }
    return null;
  };

  // Top-level array of event rows or trace sequences
  if (Array.isArray(doc)) {
    const byCase = new Map<string, EventTrace['events']>();
    const traces: EventTrace[] = [];

    doc.forEach((item, idx) => {
      if (Array.isArray(item) && item.every((v) => typeof v === 'string' || typeof v === 'number')) {
        const base = Date.now() + idx * 60000;
        traces.push({
          caseId: `case-${idx + 1}`,
          events: item.map((act, eIdx) => ({
            activity: String(act),
            timestamp: new Date(base + eIdx * 60000).toISOString(),
          })),
        });
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if ('events' in rec || 'event' in rec || 'trace' in rec) {
          const cid =
            extractXesYamlAttr(rec, ['concept:name', 'case:concept:name', 'case_id', 'caseid', 'id', 'name']) ||
            `case-${idx + 1}`;
          const rawEvs = rec.events ?? rec.event ?? rec.trace;
          const evArr = Array.isArray(rawEvs) ? rawEvs : rawEvs && typeof rawEvs === 'object' ? [rawEvs] : [];
          const parsedEvs: EventTrace['events'] = [];
          evArr.forEach((ev, eIdx) => {
            if (typeof ev === 'string') {
              parsedEvs.push({ activity: ev, timestamp: new Date(Date.now() + eIdx * 60000).toISOString() });
            } else if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
              const evRec = ev as Record<string, unknown>;
              const act = extractXesYamlAttr(evRec, [
                'concept:name',
                'activity',
                'event',
                'task',
                'action',
                'name',
                'label',
              ]);
              if (act) {
                parsedEvs.push({
                  activity: act,
                  timestamp:
                    extractXesYamlAttr(evRec, ['time:timestamp', 'timestamp', 'time', 'date', 'start_time']) ||
                    new Date(Date.now() + eIdx * 60000).toISOString(),
                  resource: extractXesYamlAttr(evRec, ['org:resource', 'resource', 'user', 'actor']),
                });
              }
            }
          });
          if (parsedEvs.length > 0) traces.push({ caseId: cid, events: parsedEvs });
        } else {
          const cid = extractXesYamlAttr(rec, [
            'case:concept:name',
            'case_id',
            'caseid',
            'case',
            'trace_id',
          ]);
          const act = extractXesYamlAttr(rec, [
            'concept:name',
            'activity',
            'event',
            'task',
            'action',
            'name',
          ]);
          if (cid && act) {
            const ts =
              extractXesYamlAttr(rec, ['time:timestamp', 'timestamp', 'time', 'date', 'start_time']) ||
              new Date(Date.now() + idx * 60000).toISOString();
            const res = extractXesYamlAttr(rec, ['org:resource', 'resource', 'user', 'actor']);
            const list = byCase.get(cid) || [];
            list.push({ activity: act, timestamp: ts, resource: res });
            byCase.set(cid, list);
          }
        }
      }
    });

    if (byCase.size > 0) {
      byCase.forEach((events, caseId) => {
        events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        traces.push({ caseId, events });
      });
    }
    return traces.length > 0 ? traces : null;
  }

  const container = findLogContainer(doc as Record<string, unknown>);
  if (!container) return null;

  // Flat `events:` list at log level
  if (Array.isArray(container.events) && !container.trace && !container.traces) {
    return parseYamlEventLogDoc(container.events);
  }

  let rawTraces =
    container.trace ??
    container.traces ??
    container['xes:trace'] ??
    container.cases ??
    container.case;

  if (!rawTraces && Array.isArray(container.children)) {
    rawTraces = container.children.filter((c) => isXmlTag(c, 'trace'));
  }

  if (!rawTraces) return null;

  let traceList: Array<{ caseIdHint?: string; data: unknown }> = [];
  if (Array.isArray(rawTraces)) {
    traceList = rawTraces.map((t) => ({ data: t }));
  } else if (typeof rawTraces === 'object') {
    const trObj = rawTraces as Record<string, unknown>;
    if ('event' in trObj || 'events' in trObj || 'xes:event' in trObj || 'children' in trObj) {
      traceList = [{ data: trObj }];
    } else if (Array.isArray(trObj.trace)) {
      traceList = trObj.trace.map((t) => ({ data: t }));
    } else {
      traceList = Object.entries(trObj).map(([cid, val]) => ({ caseIdHint: cid, data: val }));
    }
  }

  const traces: EventTrace[] = [];
  traceList.forEach((entry, tIdx) => {
    if (Array.isArray(entry.data)) {
      const evs: EventTrace['events'] = [];
      entry.data.forEach((ev, eIdx) => {
        if (typeof ev === 'string') {
          evs.push({ activity: ev, timestamp: new Date(Date.now() + eIdx * 60000).toISOString() });
        } else if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
          const rawEv = ev as Record<string, unknown>;
          const evRec =
            rawEv.event && typeof rawEv.event === 'object' && !Array.isArray(rawEv.event)
              ? (rawEv.event as Record<string, unknown>)
              : rawEv;
          const act = extractXesYamlAttr(evRec, [
            'concept:name',
            'xes:concept:name',
            'concept_name',
            'concept.name',
            'activity',
            'task',
            'action',
            'name',
            'label',
            'step',
          ]);
          if (act) {
            evs.push({
              activity: act,
              timestamp:
                extractXesYamlAttr(evRec, ['time:timestamp', 'timestamp', 'time', 'date', 'start_time']) ||
                new Date(Date.now() + eIdx * 60000).toISOString(),
              resource: extractXesYamlAttr(evRec, ['org:resource', 'resource', 'user', 'actor']),
            });
          }
        }
      });
      if (evs.length > 0) {
        traces.push({ caseId: entry.caseIdHint || `case-${tIdx + 1}`, events: evs });
      }
      return;
    }

    if (!entry.data || typeof entry.data !== 'object') return;
    let tRec = entry.data as Record<string, unknown>;
    if (
      !tRec.event &&
      !tRec.events &&
      !tRec['xes:event'] &&
      tRec.trace &&
      typeof tRec.trace === 'object' &&
      !Array.isArray(tRec.trace)
    ) {
      tRec = tRec.trace as Record<string, unknown>;
    }
    const caseId =
      entry.caseIdHint ||
      extractXesYamlAttr(tRec, ['concept:name', 'case:concept:name', 'case_id', 'caseid', 'id', 'name']) ||
      `case-${tIdx + 1}`;

    let rawEvs: unknown = tRec.event ?? tRec.events ?? tRec['xes:event'] ?? tRec.activities ?? tRec.items;
    if (!rawEvs && Array.isArray(tRec.children)) {
      rawEvs = tRec.children.filter((c) => isXmlTag(c, 'event'));
    }
    if (!rawEvs) return;

    let evArr: unknown[];
    if (Array.isArray(rawEvs)) {
      evArr = rawEvs;
    } else if (typeof rawEvs === 'object' && rawEvs !== null) {
      const evObj = rawEvs as Record<string, unknown>;
      if (Array.isArray(evObj.event)) {
        evArr = evObj.event;
      } else if (
        'concept:name' in evObj ||
        'concept:instance' in evObj ||
        'activity' in evObj ||
        'string' in evObj ||
        'attributes' in evObj ||
        'children' in evObj
      ) {
        evArr = [evObj];
      } else {
        const vals = Object.values(evObj);
        evArr = vals.every((v) => v && typeof v === 'object') ? vals : [evObj];
      }
    } else {
      return;
    }

    const events: EventTrace['events'] = [];
    evArr.forEach((ev, eIdx) => {
      if (typeof ev === 'string') {
        events.push({ activity: ev, timestamp: new Date(Date.now() + eIdx * 60000).toISOString() });
        return;
      }
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return;
      const rawEv = ev as Record<string, unknown>;
      const evRec =
        rawEv.event && typeof rawEv.event === 'object' && !Array.isArray(rawEv.event)
          ? (rawEv.event as Record<string, unknown>)
          : rawEv;
      const activity = extractXesYamlAttr(evRec, [
        'concept:name',
        'xes:concept:name',
        'concept_name',
        'concept.name',
        'activity',
        'activityname',
        'task',
        'action',
        'name',
        'label',
        'step',
      ]);
      if (!activity) return;
      const timestamp =
        extractXesYamlAttr(evRec, [
          'time:timestamp',
          'xes:time:timestamp',
          'time_timestamp',
          'timestamp',
          'time',
          'date',
          'start_time',
        ]) || new Date(Date.now() + eIdx * 60000).toISOString();
      const resource = extractXesYamlAttr(evRec, ['org:resource', 'resource', 'user', 'actor']);
      events.push({ activity, timestamp, resource });
    });

    if (events.length > 0) {
      events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      traces.push({ caseId, events });
    }
  });

  return traces.length > 0 ? traces : null;
}

function parseXesYamlLinesFallback(text: string): EventTrace[] | null {
  if (!/(?:^|\s)(?:trace|traces|xes:trace|event|events|xes:event)\s*:/im.test(text)) {
    return null;
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const traces: EventTrace[] = [];
  let inTraces = false;
  let traceSectionIndent = -1;
  let traceItemIndent = -1;
  let inEvents = false;
  let eventSectionIndent = -1;
  let eventItemIndent = -1;

  let currentTrace: {
    caseId?: string;
    events: EventTrace['events'];
  } | null = null;
  let currentEvent: {
    activity?: string;
    timestamp?: string;
    resource?: string;
    subKey?: string;
    subIndent?: number;
    pendingAttrKey?: string;
  } | null = null;
  let pendingTraceAttrKey: string | undefined;
  let traceSubKey: string | undefined;
  let traceSubIndent = -1;

  const stripQuotes = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();

  const flushEvent = () => {
    if (currentEvent && currentEvent.activity && currentTrace) {
      currentTrace.events.push({
        activity: currentEvent.activity,
        timestamp:
          currentEvent.timestamp ||
          new Date(Date.now() + currentTrace.events.length * 60000).toISOString(),
        resource: currentEvent.resource,
      });
    }
    currentEvent = null;
  };

  const flushTrace = () => {
    flushEvent();
    if (currentTrace && currentTrace.events.length > 0) {
      currentTrace.events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      traces.push({
        caseId: currentTrace.caseId || `case-${traces.length + 1}`,
        events: currentTrace.events,
      });
    }
    currentTrace = null;
    inEvents = false;
    eventSectionIndent = -1;
    eventItemIndent = -1;
    pendingTraceAttrKey = undefined;
    traceSubKey = undefined;
  };

  const applyEventKv = (rawK: string, rawV: string) => {
    if (!currentEvent) return;
    const k = rawK.replace(/^@/, '').toLowerCase();
    const v = stripQuotes(rawV);
    if (!v || v.toUpperCase() === '__NOTSPECIFIED__') return;

    if (k === 'key' || (k === 'name' && currentEvent.pendingAttrKey === undefined && !v.includes(' '))) {
      if (k === 'key') {
        currentEvent.pendingAttrKey = v.toLowerCase();
        return;
      }
    }
    if ((k === 'value' || k === 'val' || k === 'text' || k === '#text') && currentEvent.pendingAttrKey) {
      const targetKey = currentEvent.pendingAttrKey;
      currentEvent.pendingAttrKey = undefined;
      applyEventKv(targetKey, v);
      return;
    }

    const fullKey =
      currentEvent.subKey && !k.includes(':') ? `${currentEvent.subKey}:${k}` : k;

    if (
      fullKey === 'concept:name' ||
      fullKey === 'xes:concept:name' ||
      k === 'concept:name' ||
      k === 'xes:concept:name' ||
      k === 'activity' ||
      k === 'task' ||
      k === 'action' ||
      k === 'label' ||
      (k === 'name' && currentEvent.subKey === 'concept')
    ) {
      if (!currentEvent.activity) currentEvent.activity = v;
    } else if (
      fullKey === 'time:timestamp' ||
      k === 'time:timestamp' ||
      k === 'timestamp' ||
      k === 'date'
    ) {
      if (!currentEvent.timestamp) currentEvent.timestamp = v;
    } else if (
      fullKey === 'org:resource' ||
      k === 'org:resource' ||
      k === 'resource' ||
      k === 'user'
    ) {
      if (!currentEvent.resource) currentEvent.resource = v;
    }
  };

  for (const rawLine of lines) {
    if (!rawLine || !rawLine.trim()) continue;
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('#') || trimmed === '...') continue;
    if (trimmed === '---') {
      flushEvent();
      continue;
    }

    const indent = rawLine.search(/\S/);
    const isDash = trimmed.startsWith('-');
    const body = isDash ? trimmed.slice(1).trim() : trimmed;

    if (/^(?:trace|traces|xes:trace)\s*:$/i.test(body)) {
      if (currentTrace && currentTrace.events.length > 0) flushTrace();
      inTraces = true;
      traceSectionIndent = indent;
      if (isDash || !currentTrace) {
        currentTrace = { events: [] };
        if (isDash) traceItemIndent = indent;
      }
      continue;
    }

    if (/^(?:event|events|xes:event)\s*:$/i.test(body) && indent === 0 && !isDash) {
      flushEvent();
      if (!currentTrace) currentTrace = { events: [] };
      inTraces = true;
      traceSectionIndent = -1;
      inEvents = true;
      eventSectionIndent = -1;
      eventItemIndent = 0;
      currentEvent = {};
      continue;
    }

    if (!inTraces) continue;

    if (traceSectionIndent >= 0 && indent <= traceSectionIndent && !isDash) {
      if (/^(?:event|events|xes:event)\s*:$/i.test(body)) {
        flushEvent();
        inTraces = true;
        traceSectionIndent = -1;
        inEvents = true;
        eventSectionIndent = -1;
        eventItemIndent = indent;
        currentEvent = {};
        continue;
      }
      flushTrace();
      inTraces = false;
      continue;
    }

    if (isDash) {
      if (traceItemIndent >= 0 && indent <= traceItemIndent) {
        flushTrace();
        traceItemIndent = indent;
        currentTrace = { events: [] };
      } else if (inEvents && (eventItemIndent < 0 || indent === eventItemIndent || indent > eventSectionIndent)) {
        if (eventItemIndent < 0 || indent <= eventItemIndent) {
          flushEvent();
          eventItemIndent = indent;
          currentEvent = {};
        }
      } else if (!inEvents && traceItemIndent < 0) {
        flushTrace();
        traceItemIndent = indent;
        currentTrace = { events: [] };
      }
    }

    if (/^(?:event|events|xes:event)\s*:$/i.test(body)) {
      if (!currentTrace) currentTrace = { events: [] };
      if (isDash || indent === 0) {
        flushEvent();
        currentEvent = {};
        eventItemIndent = indent;
        inEvents = true;
      } else {
        inEvents = true;
        eventSectionIndent = indent;
        eventItemIndent = -1;
      }
      continue;
    }

    if (!currentTrace) continue;

    const kvMatch = body.match(/^([^\s:]+(?::[^\s:]+)?)\s*:\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const val = kvMatch[2];

    if (currentEvent) {
      if (currentEvent.subIndent !== undefined && indent <= currentEvent.subIndent && !isDash) {
        currentEvent.subKey = undefined;
        currentEvent.subIndent = undefined;
      }
      if (!val) {
        const kl = key.toLowerCase();
        if (kl === 'concept' || kl === 'time' || kl === 'org' || kl === 'lifecycle') {
          currentEvent.subKey = kl;
          currentEvent.subIndent = indent;
        }
        continue;
      }
      applyEventKv(key, val);
    } else {
      if (traceSubIndent >= 0 && indent <= traceSubIndent && !isDash) {
        traceSubKey = undefined;
        traceSubIndent = -1;
      }
      if (!val) {
        const kl = key.toLowerCase();
        if (kl === 'concept') {
          traceSubKey = kl;
          traceSubIndent = indent;
        }
        continue;
      }
      const kl = key.replace(/^@/, '').toLowerCase();
      const v = stripQuotes(val);
      if (kl === 'key') {
        pendingTraceAttrKey = v.toLowerCase();
      } else if ((kl === 'value' || kl === 'val') && pendingTraceAttrKey) {
        if (pendingTraceAttrKey === 'concept:name') currentTrace.caseId = v;
        pendingTraceAttrKey = undefined;
      } else if (
        kl === 'concept:name' ||
        kl === 'case:concept:name' ||
        kl === 'case_id' ||
        (kl === 'name' && traceSubKey === 'concept')
      ) {
        if (!currentTrace.caseId) currentTrace.caseId = v;
      }
    }
  }

  flushTrace();
  return traces.length > 0 ? traces : null;
}

function parseMultiDocYamlEventStream(docs: unknown[]): EventTrace[] | null {
  if (docs.length === 0) return null;

  let activeCaseId: string | undefined;
  let hasPrimaryActivity = false;
  let seqCounter = 0;

  const collected: Array<{
    caseId: string;
    primaryActivity?: string;
    secondaryActivity?: string;
    timestamp: string;
    resource?: string;
    seq: number;
  }> = [];

  const traceCaseKeys = [
    'concept:name',
    'case:concept:name',
    'cpee:instance',
    'concept:instance',
    'cpee:name',
    'case_id',
    'caseid',
    'id',
    'name',
  ];
  const primaryActivityKeys = [
    'concept:name',
    'xes:concept:name',
    'concept_name',
    'concept.name',
    'activity',
    'activityname',
    'task',
    'action',
  ];
  const secondaryActivityKeys = ['name', 'label', 'step'];
  const timestampKeys = [
    'time:timestamp',
    'xes:time:timestamp',
    'time_timestamp',
    'timestamp',
    'time',
    'date',
    'start_time',
  ];
  const resourceKeys = ['org:resource', 'resource', 'user', 'actor'];

  const ingestEventRecord = (evRec: Record<string, unknown>) => {
    const primaryAct = extractXesYamlAttr(evRec, primaryActivityKeys);
    const secondaryAct = primaryAct ? undefined : extractXesYamlAttr(evRec, secondaryActivityKeys);
    if (primaryAct) hasPrimaryActivity = true;

    const cleanSecondary =
      secondaryAct &&
      secondaryAct.toLowerCase() !== 'external' &&
      secondaryAct.toUpperCase() !== '__NOTSPECIFIED__'
        ? secondaryAct
        : undefined;

    if (!primaryAct && !cleanSecondary) return;

    const evExplicitCase = extractXesYamlAttr(evRec, [
      'case:concept:name',
      'case_id',
      'caseid',
      'case',
      'trace_id',
    ]);
    const rawConceptInst = extractXesYamlAttr(evRec, ['concept:instance']);
    const evConceptInst = rawConceptInst && rawConceptInst !== '-1' ? rawConceptInst : undefined;
    const evCpeeInst = extractXesYamlAttr(evRec, ['cpee:instance']);

    const caseId =
      evExplicitCase ||
      (activeCaseId && (!evConceptInst || evConceptInst === activeCaseId)
        ? activeCaseId
        : evConceptInst || evCpeeInst || activeCaseId) ||
      'case-1';

    const seq = seqCounter++;
    const timestamp =
      extractXesYamlAttr(evRec, timestampKeys) ||
      new Date(Date.now() + seq * 1000).toISOString();
    const resource = extractXesYamlAttr(evRec, resourceKeys);

    collected.push({
      caseId,
      primaryActivity: primaryAct,
      secondaryActivity: cleanSecondary,
      timestamp,
      resource,
      seq,
    });
  };

  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    if (Array.isArray(doc)) {
      for (const item of doc) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemRec = item as Record<string, unknown>;
        const unwrapped =
          itemRec.event && typeof itemRec.event === 'object' && !Array.isArray(itemRec.event)
            ? (itemRec.event as Record<string, unknown>)
            : itemRec;
        ingestEventRecord(unwrapped);
      }
      continue;
    }

    const rec = doc as Record<string, unknown>;

    // Update active case ID from log/trace header documents (e.g. CPEE XES-YAML first document)
    const logContainer =
      (rec.log && typeof rec.log === 'object' && !Array.isArray(rec.log)
        ? (rec.log as Record<string, unknown>)
        : undefined) ??
      (rec['xes:log'] && typeof rec['xes:log'] === 'object' && !Array.isArray(rec['xes:log'])
        ? (rec['xes:log'] as Record<string, unknown>)
        : undefined);
    const traceHeader =
      (logContainer &&
      (logContainer.trace ?? logContainer['xes:trace']) &&
      typeof (logContainer.trace ?? logContainer['xes:trace']) === 'object' &&
      !Array.isArray(logContainer.trace ?? logContainer['xes:trace'])
        ? ((logContainer.trace ?? logContainer['xes:trace']) as Record<string, unknown>)
        : undefined) ??
      (rec.trace && typeof rec.trace === 'object' && !Array.isArray(rec.trace)
        ? (rec.trace as Record<string, unknown>)
        : undefined) ??
      (rec['xes:trace'] && typeof rec['xes:trace'] === 'object' && !Array.isArray(rec['xes:trace'])
        ? (rec['xes:trace'] as Record<string, unknown>)
        : undefined);

    if (traceHeader) {
      const cid = extractXesYamlAttr(traceHeader, traceCaseKeys);
      if (cid) activeCaseId = cid;
    }

    // Event documents: `{ event: { ... } }` / `{ events: [...] }` / `{ 'xes:event': { ... } }`
    const rawEventPayload = rec.event ?? rec.events ?? rec['xes:event'];
    if (rawEventPayload !== undefined) {
      const evArr = Array.isArray(rawEventPayload) ? rawEventPayload : [rawEventPayload];
      for (const ev of evArr) {
        if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
          ingestEventRecord(ev as Record<string, unknown>);
        }
      }
      continue;
    }

    // Bare event document without `event:` wrapper (e.g. `---\nconcept:name: Read\ntime:timestamp: ...`)
    if (
      !logContainer &&
      !traceHeader &&
      ('concept:name' in rec || 'xes:concept:name' in rec || 'time:timestamp' in rec)
    ) {
      ingestEventRecord(rec);
    }
  }

  const byCase = new Map<
    string,
    Array<{ activity: string; timestamp: string; resource?: string; seq: number }>
  >();

  for (const item of collected) {
    const activity = hasPrimaryActivity ? item.primaryActivity : item.secondaryActivity;
    if (!activity) continue;
    const list = byCase.get(item.caseId) || [];
    list.push({
      activity,
      timestamp: item.timestamp,
      resource: item.resource,
      seq: item.seq,
    });
    byCase.set(item.caseId, list);
  }

  if (byCase.size === 0) return null;

  const traces: EventTrace[] = [];
  byCase.forEach((items, caseId) => {
    items.sort((a, b) => {
      const ta = Date.parse(a.timestamp);
      const tb = Date.parse(b.timestamp);
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
      return a.seq - b.seq;
    });
    traces.push({
      caseId,
      events: items.map(({ activity, timestamp, resource }) => ({
        activity,
        timestamp,
        resource,
      })),
    });
  });

  return traces.length > 0 ? traces : null;
}

let yamlTracesCache: { key: string; traces: EventTrace[] | null } | null = null;

function resolveYamlTraces(text: string): EventTrace[] | null {
  const cacheKey = `${text.length}:${text.slice(0, 160)}:${text.slice(-160)}`;
  if (yamlTracesCache && yamlTracesCache.key === cacheKey) {
    return yamlTracesCache.traces;
  }

  const docs = loadYamlDocuments(text);
  const aggregatedSingleDocTraces: EventTrace[] = [];
  for (const doc of docs) {
    const traces = parseYamlEventLogDoc(doc);
    if (traces && traces.length > 0) {
      aggregatedSingleDocTraces.push(...traces);
    }
  }

  let found: EventTrace[] | null =
    aggregatedSingleDocTraces.length > 0 ? aggregatedSingleDocTraces : null;

  if (!found) {
    found = parseMultiDocYamlEventStream(docs);
  }

  if (!found) {
    found = parseXesYamlLinesFallback(text);
  }

  yamlTracesCache = { key: cacheKey, traces: found };
  return found;
}

export function isYamlEventLog(text: string): boolean {
  const traces = resolveYamlTraces(text);
  return Boolean(traces && traces.length > 0);
}

export function parseYamlToTraces(text: string): EventTrace[] {
  const traces = resolveYamlTraces(text);
  if (traces && traces.length > 0) return traces;
  throw new Error('No traces or events found in YAML event log.');
}

function parseYamlObjectGraph(
  doc: unknown,
  filename: string,
  allowRootAdjacencyFallback: boolean
): DFGGraph | null {
  if (!doc || typeof doc !== 'object') return null;
  if (isNativeGraphObject(doc) && doc.kind === 'dfg') return doc;

  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];

  const pushEdgeFromString = (line: string) => {
    const arrow = line.match(/^(.+?)\s*(?:->|=>)\s*(.+?)(?:\s*:\s*(\d+(?:\.\d+)?))?$/);
    if (arrow) {
      const src = arrow[1].trim().replace(/^["']|["']$/g, '');
      const tgt = arrow[2].trim().replace(/^["']|["']$/g, '');
      const w = arrow[3] ? Number(arrow[3]) || 1 : 1;
      if (src && tgt) rawEdges.push({ source: src, target: tgt, count: w });
      return;
    }
    const parts = splitCsvLine(line, ',').map((p) => p.replace(/^["']|["']$/g, '').trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const w = parts[2] && !Number.isNaN(Number(parts[2])) ? Number(parts[2]) || 1 : 1;
      rawEdges.push({ source: parts[0], target: parts[1], count: w });
    }
  };

  const addNodeItem = (item: unknown) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const id = String(item).trim();
      if (id) nodeLabels.set(id, id);
      return;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const raw = item as Record<string, unknown>;
      const rec =
        raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
          ? ({ ...raw, ...(raw.data as Record<string, unknown>) } as Record<string, unknown>)
          : raw;
      const rawId = rec.id ?? rec.name ?? rec.key ?? rec.node ?? rec.activity ?? rec.label;
      const id = rawId !== undefined && rawId !== null ? String(rawId).trim() : '';
      if (!id) return;
      const rawLbl = rec.label ?? rec.name ?? rec.title ?? rec.activity ?? id;
      nodeLabels.set(id, String(rawLbl).trim() || id);
    }
  };

  const addEdgeItem = (item: unknown) => {
    if (typeof item === 'string') {
      pushEdgeFromString(item);
      return;
    }
    if (Array.isArray(item) && item.length >= 2) {
      const src = String(item[0] ?? '').trim();
      const tgt = String(item[1] ?? '').trim();
      let w = 1;
      if (item.length > 2) {
        if (typeof item[2] === 'number' && Number.isFinite(item[2]) && item[2] > 0) {
          w = item[2];
        } else if (typeof item[2] === 'string' && !Number.isNaN(Number(item[2]))) {
          w = Number(item[2]) || 1;
        } else if (item[2] && typeof item[2] === 'object') {
          w = extractNumericWeight(item[2] as Record<string, unknown>);
        }
      }
      if (src && tgt) rawEdges.push({ source: src, target: tgt, count: w });
      return;
    }
    if (item && typeof item === 'object') {
      const edge = extractEdgeEndpoints(item as Record<string, unknown>);
      if (edge) rawEdges.push(edge);
    }
  };

  const ingestAdjacencyMap = (adjObj: Record<string, unknown>, skipMetaKeys: boolean) => {
    const metaKeys = new Set([
      'directed',
      'multigraph',
      'name',
      'id',
      'kind',
      'type',
      'graph',
      'meta',
      'metadata',
      'header',
      'info',
      'version',
      'schema',
      'config',
      'settings',
      'namespaces',
      'xes',
      'extension',
      'extensions',
      'global',
      'globals',
      'classifier',
      'classifiers',
      'log',
      'xes:log',
      'trace',
      'traces',
      'xes:trace',
      'event',
      'events',
      'xes:event',
      'cpee',
      'attributes',
    ]);
    for (const [srcKey, targets] of Object.entries(adjObj)) {
      if (skipMetaKeys && metaKeys.has(srcKey.toLowerCase())) continue;
      const src = String(srcKey).trim();
      if (!src) continue;
      if (!nodeLabels.has(src)) nodeLabels.set(src, src);

      if (Array.isArray(targets)) {
        for (const t of targets) {
          if (typeof t === 'string' || typeof t === 'number') {
            const tgt = String(t).trim();
            if (tgt) rawEdges.push({ source: src, target: tgt, count: 1 });
          } else if (t && typeof t === 'object' && !Array.isArray(t)) {
            const rec = t as Record<string, unknown>;
            const tgt = String(rec.target ?? rec.to ?? rec.id ?? rec.node ?? '').trim();
            if (tgt) rawEdges.push({ source: src, target: tgt, count: extractNumericWeight(rec) });
          }
        }
      } else if (targets && typeof targets === 'object') {
        for (const [tgtKey, val] of Object.entries(targets as Record<string, unknown>)) {
          if (skipMetaKeys && metaKeys.has(tgtKey.toLowerCase())) continue;
          const tgt = String(tgtKey).trim();
          if (!tgt) continue;
          let count = 1;
          if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
            count = val;
          } else if (typeof val === 'string' && !Number.isNaN(Number(val))) {
            count = Number(val) || 1;
          } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            const valRec = val as Record<string, unknown>;
            const hasWeightKey = ['weight', 'count', 'frequency', 'freq', 'value', 'w'].some(
              (wk) => wk in valRec
            );
            if (skipMetaKeys && !hasWeightKey && Object.keys(valRec).length > 0) {
              continue;
            }
            count = extractNumericWeight(valRec);
          } else if (skipMetaKeys) {
            continue;
          }
          rawEdges.push({ source: src, target: tgt, count });
        }
      }
    }
  };

  if (Array.isArray(doc)) {
    doc.forEach((item) => addEdgeItem(item));
    if (rawEdges.length === 0) return null;
    return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
  }

  const graphKeySet = [
    'nodes',
    'vertices',
    'activities',
    'states',
    'edges',
    'links',
    'arcs',
    'transitions',
    'relations',
    'adj',
    '_adj',
    'adjacency',
  ];
  const hasGraphKeys = (obj: Record<string, unknown>) => graphKeySet.some((k) => k in obj);
  const skipSearchKeys = new Set([
    'namespaces',
    'xes',
    'extension',
    'extensions',
    'global',
    'globals',
    'classifier',
    'classifiers',
    'metadata',
    'meta',
    'header',
    'log',
    'xes:log',
    'trace',
    'traces',
    'xes:trace',
    'event',
    'events',
    'xes:event',
  ]);

  const findGraphRoot = (obj: Record<string, unknown>, depth = 0): Record<string, unknown> | null => {
    if (hasGraphKeys(obj)) return obj;
    if (depth >= 4) return null;
    const priority = ['graph', 'dfg', 'data', 'elements', 'network', 'model', 'result', 'document'];
    for (const k of priority) {
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = findGraphRoot(v as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (priority.includes(k) || skipSearchKeys.has(k.toLowerCase())) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = findGraphRoot(v as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  const root = findGraphRoot(doc as Record<string, unknown>) ?? (doc as Record<string, unknown>);

  const rawNodes =
    root.nodes ?? root.vertices ?? root.activities ?? root.states ?? root._node ?? root.node;
  if (Array.isArray(rawNodes)) {
    rawNodes.forEach((n) => addNodeItem(n));
  } else if (rawNodes && typeof rawNodes === 'object') {
    for (const [k, v] of Object.entries(rawNodes as Record<string, unknown>)) {
      const id = String(k).trim();
      if (!id) continue;
      if (typeof v === 'string' || typeof v === 'number') {
        nodeLabels.set(id, String(v).trim() || id);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        const lbl = rec.label ?? rec.name ?? rec.title ?? rec.activity ?? id;
        nodeLabels.set(id, String(lbl).trim() || id);
      } else {
        nodeLabels.set(id, id);
      }
    }
  }

  const rawEdgeContainer =
    root.edges ??
    root.links ??
    root.arcs ??
    root.transitions ??
    root.relations ??
    root.connections;

  if (Array.isArray(rawEdgeContainer)) {
    rawEdgeContainer.forEach((e) => addEdgeItem(e));
  } else if (rawEdgeContainer && typeof rawEdgeContainer === 'object') {
    const entries = Object.entries(rawEdgeContainer as Record<string, unknown>);
    const hasArrowKeys = entries.some(([k]) => k.includes('->') || k.includes('=>'));
    if (hasArrowKeys) {
      for (const [k, v] of entries) {
        const arrow = k.match(/^(.+?)\s*(?:->|=>)\s*(.+)$/);
        if (arrow) {
          const w =
            typeof v === 'number' && v > 0
              ? v
              : v && typeof v === 'object'
              ? extractNumericWeight(v as Record<string, unknown>)
              : 1;
          rawEdges.push({ source: arrow[1].trim(), target: arrow[2].trim(), count: w });
        }
      }
    } else {
      ingestAdjacencyMap(rawEdgeContainer as Record<string, unknown>, false);
    }
  }

  const rawAdj = root.adj ?? root._adj ?? root.adjacency;
  if (rawAdj && typeof rawAdj === 'object' && !Array.isArray(rawAdj)) {
    ingestAdjacencyMap(rawAdj as Record<string, unknown>, false);
  }

  if (nodeLabels.size === 0 && rawEdges.length === 0 && allowRootAdjacencyFallback) {
    ingestAdjacencyMap(root, true);
    if (rawEdges.length === 0) nodeLabels.clear();
  }

  if (nodeLabels.size === 0 && rawEdges.length === 0) return null;

  const built = buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
  const startRaw = root.startActivities ?? root.start_activities;
  if (startRaw && typeof startRaw === 'object' && !Array.isArray(startRaw)) {
    const starts: Record<string, number> = {};
    for (const [k, v] of Object.entries(startRaw as Record<string, unknown>)) {
      const n = Number(v);
      starts[k] = Number.isFinite(n) && n > 0 ? n : 1;
    }
    if (Object.keys(starts).length > 0) built.startActivities = starts;
  }
  const endRaw = root.endActivities ?? root.end_activities;
  if (endRaw && typeof endRaw === 'object' && !Array.isArray(endRaw)) {
    const ends: Record<string, number> = {};
    for (const [k, v] of Object.entries(endRaw as Record<string, unknown>)) {
      const n = Number(v);
      ends[k] = Number.isFinite(n) && n > 0 ? n : 1;
    }
    if (Object.keys(ends).length > 0) built.endActivities = ends;
  }
  return built;
}

function parseYamlGraphFallback(text: string, filename: string): DFGGraph {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];
  let section: 'none' | 'nodes' | 'edges' = 'none';
  let pendingNode: { id?: string; label?: string } | null = null;
  let pendingEdge: { source?: string; target?: string; count?: number } | null = null;

  const flushPending = () => {
    if (pendingNode?.id) {
      nodeLabels.set(pendingNode.id, pendingNode.label || pendingNode.id);
    }
    pendingNode = null;
    if (pendingEdge?.source && pendingEdge?.target) {
      rawEdges.push({
        source: pendingEdge.source,
        target: pendingEdge.target,
        count: pendingEdge.count ?? 1,
      });
    }
    pendingEdge = null;
  };

  const applyNodeKv = (target: { id?: string; label?: string }, key: string, val: string) => {
    if (key === 'id' || key === 'name' || key === 'key' || key === 'node') target.id = val;
    if (key === 'label' || key === 'title' || key === 'name') {
      target.label = val;
      if (!target.id && key === 'name') target.id = val;
    }
  };

  const applyEdgeKv = (
    target: { source?: string; target?: string; count?: number },
    key: string,
    val: string
  ) => {
    if (['source', 'src', 'from', 'u', 'start', 'tail'].includes(key)) target.source = val;
    if (['target', 'dst', 'dest', 'to', 'v', 'end', 'head'].includes(key)) target.target = val;
    if (['weight', 'count', 'frequency', 'freq', 'value', 'val', 'w'].includes(key)) {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) target.count = n;
    }
  };

  for (const rawLine of lines) {
    const line = stripLineCommentRespectingQuotes(rawLine);
    if (!line || line === '---' || line === '...') continue;

    if (/^(?:nodes|vertices|activities|states)\s*:/i.test(line)) {
      flushPending();
      section = 'nodes';
      const inline = line.match(/^(?:nodes|vertices|activities|states)\s*:\s*\[(.*)\]/i);
      if (inline) {
        splitCsvLine(inline[1], ',').forEach((item) => {
          const clean = item.replace(/^["'\s]+|["'\s]+$/g, '');
          if (clean) nodeLabels.set(clean, clean);
        });
      }
      continue;
    }

    if (/^(?:edges|links|arcs|transitions|relations)\s*:/i.test(line)) {
      flushPending();
      section = 'edges';
      continue;
    }

    if (section === 'nodes') {
      if (line.startsWith('-')) {
        flushPending();
        const rest = line.slice(1).trim();
        if (rest.startsWith('{') && rest.endsWith('}')) {
          const map = parseInlineKeyValueMap(rest);
          const id = map.id || map.name || map.key || map.label;
          if (id) nodeLabels.set(id, map.label || map.name || id);
        } else {
          const kv = rest.match(/^(\w+)\s*:\s*(.+)$/);
          if (kv) {
            pendingNode = {};
            applyNodeKv(
              pendingNode,
              kv[1].toLowerCase(),
              kv[2].trim().replace(/^["']|["']$/g, '')
            );
          } else if (rest) {
            const id = rest.replace(/^["']|["']$/g, '');
            if (id) nodeLabels.set(id, id);
          } else {
            pendingNode = {};
          }
        }
      } else if (pendingNode) {
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (kv) {
          applyNodeKv(
            pendingNode,
            kv[1].toLowerCase(),
            kv[2].trim().replace(/^["']|["']$/g, '')
          );
        }
      }
    } else if (section === 'edges') {
      const flowArr = line.match(/^-\s*\[([^\]]+)\]/);
      if (flowArr) {
        flushPending();
        const parts = splitCsvLine(flowArr[1], ',').map((p) =>
          p.trim().replace(/^["']|["']$/g, '')
        );
        if (parts.length >= 2 && parts[0] && parts[1]) {
          rawEdges.push({
            source: parts[0],
            target: parts[1],
            count: parts[2] && !Number.isNaN(Number(parts[2])) ? Number(parts[2]) || 1 : 1,
          });
        }
        continue;
      }
      if (line.startsWith('-')) {
        flushPending();
        const rest = line.slice(1).trim();
        if (rest.startsWith('{') && rest.endsWith('}')) {
          const map = parseInlineKeyValueMap(rest);
          const tmp: { source?: string; target?: string; count?: number } = {};
          Object.entries(map).forEach(([k, v]) => applyEdgeKv(tmp, k, v));
          if (tmp.source && tmp.target) {
            rawEdges.push({ source: tmp.source, target: tmp.target, count: tmp.count ?? 1 });
          }
        } else {
          pendingEdge = {};
          const kv = rest.match(/^(\w+)\s*:\s*(.+)$/);
          if (kv) {
            applyEdgeKv(
              pendingEdge,
              kv[1].toLowerCase(),
              kv[2].trim().replace(/^["']|["']$/g, '')
            );
          }
        }
      } else if (pendingEdge) {
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (kv) {
          applyEdgeKv(
            pendingEdge,
            kv[1].toLowerCase(),
            kv[2].trim().replace(/^["']|["']$/g, '')
          );
        }
      }
    }
  }
  flushPending();

  if (nodeLabels.size === 0 && rawEdges.length === 0) {
    throw new Error('Could not parse YAML graph nodes or edges.');
  }
  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

function parseYamlGraph(text: string, filename: string): DFGGraph {
  const docs = loadYamlDocuments(text);

  // 1. Prefer explicit graph schemas (nodes/edges/links/adj) across all documents
  for (const doc of docs) {
    const parsed = parseYamlObjectGraph(doc, filename, false);
    if (parsed) return parsed;
  }

  // 2. If the YAML is an event log (e.g., XES-YAML log/trace/event, traces, events), discover DFG
  const traces = resolveYamlTraces(text);
  if (traces && traces.length > 0) {
    return discoverGraphFromTraces(traces, 'dfg', 'inductive', filename) as DFGGraph;
  }

  // 3. Fallback to pure adjacency dict (skipping XES/metadata keys)
  for (const doc of docs) {
    const parsed = parseYamlObjectGraph(doc, filename, true);
    if (parsed) return parsed;
  }

  return parseYamlGraphFallback(text.replace(/^\uFEFF/, ''), filename);
}

function parsePnmlToPetriNet(text: string, filename: string): PetriNetGraph {
  const doc = new DOMParser().parseFromString(sanitiseXmlText(text), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid PNML XML.');

  const getTagText = (el: Element, tag: string): string => {
    const child = el.getElementsByTagName(tag)[0];
    return child?.textContent?.trim() || '';
  };

  const places: PetriNetGraph['places'] = Array.from(doc.getElementsByTagName('place')).map(
    (p, idx) => {
      const id = p.getAttribute('id') || `p_${idx}`;
      const nameEl = p.getElementsByTagName('name')[0];
      const label = (nameEl ? getTagText(nameEl, 'text') : '') || id;
      const markingEl = p.getElementsByTagName('initialMarking')[0];
      const tok = markingEl ? parseInt(getTagText(markingEl, 'text'), 10) || 0 : 0;
      return { id, label, initialTokens: tok, isFinal: false };
    }
  );

  const transitions: PetriNetGraph['transitions'] = Array.from(
    doc.getElementsByTagName('transition')
  ).map((t, idx) => {
    const id = t.getAttribute('id') || `t_${idx}`;
    const nameEl = t.getElementsByTagName('name')[0];
    const label = nameEl ? getTagText(nameEl, 'text') : '';
    const silent =
      !label ||
      t.getAttribute('type') === 'silent' ||
      Boolean(t.querySelector('toolspecific[activity="$invisible$"]'));
    return { id, label: silent ? '' : label, silent };
  });

  const arcs: PetriNetGraph['arcs'] = Array.from(doc.getElementsByTagName('arc'))
    .map((a, idx) => {
      const source = a.getAttribute('source') || '';
      const target = a.getAttribute('target') || '';
      const inscrEl = a.getElementsByTagName('inscription')[0];
      const weight = inscrEl ? parseInt(getTagText(inscrEl, 'text'), 10) || 1 : 1;
      return { id: a.getAttribute('id') || `a_${idx}`, source, target, weight };
    })
    .filter((a) => a.source && a.target);

  const outSources = new Set(arcs.map((a) => a.source));
  places.forEach((p) => {
    if (!outSources.has(p.id) && p.initialTokens === 0) {
      p.isFinal = true;
    }
  });

  if (places.length === 0 && transitions.length === 0) {
    throw new Error('No <place> or <transition> elements found in PNML file.');
  }

  return {
    kind: 'petri_net',
    id: `pnml-${Date.now()}`,
    name: filename,
    places,
    transitions,
    arcs,
  };
}

function parseBpmnXmlToGraph(text: string, filename: string): BPMNGraph {
  const doc = new DOMParser().parseFromString(sanitiseXmlText(text), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid BPMN XML.');

  const allEls = Array.from(doc.getElementsByTagName('*'));
  const localName = (el: Element) => (el.localName || el.tagName.split(':').pop() || '').toLowerCase();

  const laneByNode = new Map<string, string>();
  const lanes: BPMNGraph['lanes'] = [];
  allEls
    .filter((el) => localName(el) === 'lane')
    .forEach((laneEl, idx) => {
      const lid = laneEl.getAttribute('id') || `lane_${idx}`;
      const label = laneEl.getAttribute('name') || lid;
      lanes.push({ id: lid, label });
      allEls
        .filter((c) => c.parentElement === laneEl && localName(c) === 'flownoderef')
        .forEach((ref) => {
          const nodeId = ref.textContent?.trim();
          if (nodeId) laneByNode.set(nodeId, lid);
        });
    });

  const typeMap: Record<string, BPMNGraph['nodes'][number]['type']> = {
    startevent: 'startEvent',
    endevent: 'endEvent',
    intermediatecatchevent: 'intermediateEvent',
    intermediatethrowevent: 'intermediateEvent',
    boundaryevent: 'intermediateEvent',
    task: 'task',
    usertask: 'task',
    servicetask: 'task',
    scripttask: 'task',
    manualtask: 'task',
    sendtask: 'task',
    receivetask: 'task',
    businessruletask: 'task',
    callactivity: 'task',
    subprocess: 'task',
    exclusivegateway: 'xorGateway',
    eventbasedgateway: 'xorGateway',
    parallelgateway: 'andGateway',
    inclusivegateway: 'orGateway',
    complexgateway: 'orGateway',
  };

  const nodes: BPMNGraph['nodes'] = [];
  const edges: BPMNGraph['edges'] = [];

  for (const el of allEls) {
    const ln = localName(el);
    const mapped = typeMap[ln];
    if (mapped) {
      const id = el.getAttribute('id');
      if (id) {
        nodes.push({
          id,
          type: mapped,
          label: el.getAttribute('name') || (mapped === 'task' ? id : ''),
          laneId: laneByNode.get(id),
        });
      }
    } else if (ln === 'sequenceflow') {
      const source = el.getAttribute('sourceRef');
      const target = el.getAttribute('targetRef');
      if (source && target) {
        edges.push({
          id: el.getAttribute('id') || `f_${edges.length}`,
          source,
          target,
          label: el.getAttribute('name') || undefined,
        });
      }
    }
  }

  if (nodes.length === 0) {
    throw new Error('No BPMN flow nodes found in XML file.');
  }

  return {
    kind: 'bpmn',
    id: `bpmn-${Date.now()}`,
    name: filename,
    nodes,
    edges,
    lanes,
  };
}

function parsePlainEdgeList(text: string, filename: string): DFGGraph {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (lines.length === 0) {
    throw new Error('Graph file contains no edges.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const nodeLabels = new Map<string, string>();
  const rawEdges: Array<{ source: string; target: string; count: number }> = [];

  let srcIdx = 0;
  let tgtIdx = 1;
  let wIdx = 2;

  lines.forEach((line, idx) => {
    const parts = line.includes(',') || line.includes(';') || line.includes('\t')
      ? splitCsvLine(line, delimiter)
      : line.split(/\s+/).filter(Boolean);

    if (idx === 0) {
      const lower = parts.map((p) => p.toLowerCase());
      const sI = lower.findIndex((p) => p.includes('source') || p === 'src' || p === 'from');
      const tI = lower.findIndex((p) => p.includes('target') || p === 'dst' || p === 'to');
      const wI = lower.findIndex((p) => p.includes('weight') || p.includes('count'));
      if (sI >= 0 && tI >= 0) {
        srcIdx = sI;
        tgtIdx = tI;
        wIdx = wI >= 0 ? wI : -1;
        return;
      }
    }

    if (parts.length < 2) return;
    const src = parts[srcIdx];
    const tgt = parts[tgtIdx];
    if (!src || !tgt) return;
    const rawW = wIdx >= 0 ? parts[wIdx] : undefined;
    const count = rawW && !Number.isNaN(Number(rawW)) ? Number(rawW) : 1;
    rawEdges.push({ source: src, target: tgt, count });
  });

  if (rawEdges.length === 0) {
    throw new Error(`Could not extract edges from "${filename}".`);
  }
  return buildDfgFromNodesAndEdges(filename, nodeLabels, rawEdges);
}

export function parseGraphFileClient(text: string, filename: string): GraphObject {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (ext === 'json') return parseJsonGraph(text, filename);
  if (ext === 'graphml') return parseGraphml(text, filename);
  if (ext === 'gexf') return parseGexf(text, filename);
  if (ext === 'gml') return parseGml(text, filename);
  if (ext === 'net' || ext === 'pajek') return parsePajek(text, filename);
  if (ext === 'yaml' || ext === 'yml') return parseYamlGraph(text, filename);
  if (ext === 'pnml') return parsePnmlToPetriNet(text, filename);
  if (ext === 'bpmn') return parseBpmnXmlToGraph(text, filename);
  if (ext === 'dot' || ext === 'gv') return parseDotToDfg(text, filename);
  if (ext === 'mmd' || ext === 'mermaid') return parseMermaidToDfg(text, filename);
  if (ext === 'xes') {
    const traces = parseXesToTraces(text);
    return discoverGraphFromTraces(traces, 'dfg', 'inductive', filename);
  }
  return parsePlainEdgeList(text, filename);
}

export function parseEdgeListOrJsonGraph(text: string, filename: string): GraphObject {
  return parseGraphFileClient(text, filename);
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
  const edgeCounts = new Map<
    string,
    { source: string; target: string; count: number; totalSec: number }
  >();
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
          edgeCounts.set(key, {
            source: ev.activity,
            target: next.activity,
            count: 1,
            totalSec: dt,
          });
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
        return {
          id: `${prefix}_0`,
          type: 'activity',
          label: seq[0],
          frequency: count,
          children: [],
        };
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
      variants.length === 0
        ? { id: 'pt_empty', type: 'tau', children: [] }
        : variants.length === 1
        ? makeSeqNode(variants[0].seq, variants[0].count, 'pt')
        : {
            id: 'pt_root',
            type: 'operator',
            operator: 'xor',
            frequency: traces.length,
            children: variants
              .slice(0, 6)
              .map((v, i) => makeSeqNode(v.seq, v.count, `v${i}`)),
          };

    return {
      kind: 'process_tree',
      id: `local-pt-${Date.now()}`,
      name: `${name} (${algorithm.toUpperCase()} · Process Tree)`,
      root,
    };
  }

  const lanesSet = Array.from(new Set(Array.from(actResource.values())));
  const lanes: BPMNGraph['lanes'] = lanesSet.map((l) => ({
    id: `lane_${l}`,
    label: l,
  }));
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
