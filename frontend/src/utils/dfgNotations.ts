import { DFGGraph } from '../types/processMining';

export type DfgNotationFormat =
  | 'json'
  | 'csv_edges'
  | 'dot'
  | 'mermaid'
  | 'graphml'
  | 'gml'
  | 'yaml';

export interface DfgNotationMeta {
  id: DfgNotationFormat;
  label: string;
  extension: string;
  mimeType: string;
  readSupported: string;
}

export const DFG_NOTATION_FORMATS: DfgNotationMeta[] = [
  {
    id: 'json',
    label: 'Native DFG JSON',
    extension: 'json',
    mimeType: 'application/json',
    readSupported: 'Lossless ProcessCanvas DFG schema (preserves counts, durations, start/end sets)',
  },
  {
    id: 'csv_edges',
    label: 'Edge List CSV',
    extension: 'csv',
    mimeType: 'text/csv',
    readSupported: 'source,target,count,meanDurationSec table (direct upload supported by backend & frontend)',
  },
  {
    id: 'dot',
    label: 'Graphviz DOT',
    extension: 'dot',
    mimeType: 'text/vnd.graphviz',
    readSupported: 'digraph syntax ("A" -> "B" [label="42"])',
  },
  {
    id: 'mermaid',
    label: 'Mermaid Flowchart',
    extension: 'mmd',
    mimeType: 'text/plain',
    readSupported: 'flowchart LR/TD syntax (A[Label] -->|42| B[Label])',
  },
  {
    id: 'graphml',
    label: 'GraphML XML',
    extension: 'graphml',
    mimeType: 'application/xml',
    readSupported: 'Standard XML graph format (supported directly by Engineer backend)',
  },
  {
    id: 'gml',
    label: 'GML',
    extension: 'gml',
    mimeType: 'text/plain',
    readSupported: 'Graph Modelling Language (supported directly by Engineer backend)',
  },
  {
    id: 'yaml',
    label: 'YAML Graph',
    extension: 'yaml',
    mimeType: 'text/yaml',
    readSupported: 'Structured nodes/edges YAML (supported directly by Engineer backend)',
  },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeQuoted(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function serializeDfgToNotation(
  dfg: DFGGraph,
  format: DfgNotationFormat
): string {
  const actMap = new Map(dfg.activities.map((a) => [a.id, a]));

  if (format === 'json') {
    return JSON.stringify(dfg, null, 2);
  }

  if (format === 'csv_edges') {
    const rows = ['source,target,count,meanDurationSec'];
    dfg.edges.forEach((e) => {
      const s = actMap.get(e.source)?.label || e.source;
      const t = actMap.get(e.target)?.label || e.target;
      const dur = e.meanDurationSec !== undefined && e.meanDurationSec !== null ? e.meanDurationSec : '';
      rows.push(`"${s.replace(/"/g, '""')}","${t.replace(/"/g, '""')}",${e.count},${dur}`);
    });
    return rows.join('\n');
  }

  if (format === 'dot') {
    const lines = [
      `digraph "${escapeQuoted(dfg.name)}" {`,
      '  rankdir=LR;',
      '  node [shape=box, style="rounded,filled", fillcolor="#f8fafc", fontname="Helvetica"];',
    ];
    dfg.activities.forEach((a) => {
      const lbl = `${a.label}\\n(${a.count})`;
      lines.push(`  "${escapeQuoted(a.id)}" [label="${escapeQuoted(lbl)}"];`);
    });
    dfg.edges.forEach((e) => {
      lines.push(
        `  "${escapeQuoted(e.source)}" -> "${escapeQuoted(e.target)}" [label="${e.count}", weight=${e.count}];`
      );
    });
    lines.push('}');
    return lines.join('\n');
  }

  if (format === 'mermaid') {
    const safeId = (id: string, idx: number) =>
      `n_${idx}_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const idMap = new Map<string, string>();
    dfg.activities.forEach((a, idx) => idMap.set(a.id, safeId(a.id, idx)));

    const lines = ['flowchart LR'];
    dfg.activities.forEach((a) => {
      const mid = idMap.get(a.id) || a.id;
      lines.push(`  ${mid}["${escapeQuoted(a.label)} (${a.count})"]`);
    });
    dfg.edges.forEach((e) => {
      const s = idMap.get(e.source) || e.source;
      const t = idMap.get(e.target) || e.target;
      lines.push(`  ${s} -->|${e.count}| ${t}`);
    });
    return lines.join('\n');
  }

  if (format === 'graphml') {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      '  <key id="d0" for="node" attr.name="label" attr.type="string"/>',
      '  <key id="d1" for="edge" attr.name="weight" attr.type="int"/>',
      `  <graph id="${escapeXml(dfg.id)}" edgedefault="directed">`,
    ];
    dfg.activities.forEach((a) => {
      lines.push(`    <node id="${escapeXml(a.id)}"><data key="d0">${escapeXml(a.label)}</data></node>`);
    });
    dfg.edges.forEach((e) => {
      lines.push(
        `    <edge id="${escapeXml(e.id)}" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}"><data key="d1">${e.count}</data></edge>`
      );
    });
    lines.push('  </graph>', '</graphml>');
    return lines.join('\n');
  }

  if (format === 'gml') {
    const idxMap = new Map<string, number>();
    const lines = ['graph [', '  directed 1'];
    dfg.activities.forEach((a, idx) => {
      idxMap.set(a.id, idx);
      lines.push('  node [', `    id ${idx}`, `    label "${escapeQuoted(a.label)}"`, '  ]');
    });
    dfg.edges.forEach((e) => {
      const s = idxMap.get(e.source);
      const t = idxMap.get(e.target);
      if (s !== undefined && t !== undefined) {
        lines.push('  edge [', `    source ${s}`, `    target ${t}`, `    weight ${e.count}`, '  ]');
      }
    });
    lines.push(']');
    return lines.join('\n');
  }

  // yaml
  const lines = ['nodes:'];
  dfg.activities.forEach((a) => {
    lines.push(`  - id: "${escapeQuoted(a.id)}"`, `    label: "${escapeQuoted(a.label)}"`);
  });
  lines.push('edges:');
  dfg.edges.forEach((e) => {
    lines.push(
      `  - source: "${escapeQuoted(e.source)}"`,
      `    target: "${escapeQuoted(e.target)}"`,
      `    weight: ${e.count}`
    );
  });
  return lines.join('\n');
}

export function parseDotToDfg(text: string, filename: string): DFGGraph {
  const nodeLabels = new Map<string, string>();
  const edges: Array<{ source: string; target: string; count: number }> = [];

  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const nodeStmtRe = /^\s*"?([^"\s[\];->]+)"?\s*\[([^\]]*)\]/gm;
  let m: RegExpExecArray | null;
  while ((m = nodeStmtRe.exec(clean)) !== null) {
    const id = m[1];
    if (['graph', 'node', 'edge', 'digraph', 'subgraph'].includes(id.toLowerCase())) continue;
    const lblMatch = m[2].match(/label\s*=\s*"([^"]*)"/i);
    const label = lblMatch ? lblMatch[1].split('\\n')[0] : id;
    nodeLabels.set(id, label);
  }

  const edgeRe = /(?:"([^"]+)"|([A-Za-z0-9_.-]+))\s*->\s*(?:"([^"]+)"|([A-Za-z0-9_.-]+))(?:\s*\[([^\]]*)\])?/g;
  while ((m = edgeRe.exec(clean)) !== null) {
    const source = m[1] || m[2];
    const target = m[3] || m[4];
    const attrs = m[5] || '';
    const wMatch = attrs.match(/(?:weight|label)\s*=\s*"?(\d+(?:\.\d+)?)"?/i);
    const count = wMatch ? Math.max(1, Math.round(Number(wMatch[1]))) : 1;
    if (source && target) {
      if (!nodeLabels.has(source)) nodeLabels.set(source, source);
      if (!nodeLabels.has(target)) nodeLabels.set(target, target);
      edges.push({ source, target, count });
    }
  }

  if (edges.length === 0) {
    throw new Error('Could not find directed edges (A -> B) in DOT file.');
  }

  return assembleDfg(filename, nodeLabels, edges);
}

export function parseMermaidToDfg(text: string, filename: string): DFGGraph {
  const nodeLabels = new Map<string, string>();
  const edges: Array<{ source: string; target: string; count: number }> = [];

  const extractToken = (raw: string): { id: string; label?: string } => {
    const trimmed = raw.trim();
    const m = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:\[\s*"?([^"\]]+)"?\s*\]|\(\s*"?([^")]+)"?\s*\)|\{\s*"?([^"}]+)"?\s*\})?$/);
    if (!m) return { id: trimmed };
    const id = m[1];
    const rawLbl = (m[2] || m[3] || m[4] || '').replace(/\s*\(\d+\)\s*$/, '').trim();
    return { id, label: rawLbl || undefined };
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/%%.*$/, '').trim();
    if (!line || /^(?:flowchart|graph)\s+/i.test(line)) continue;

    const arrowMatch = line.match(
      /^(.+?)\s*--+>\s*(?:\|([^|]+)\|\s*)?(.+?);?$/
    );
    if (arrowMatch) {
      const s = extractToken(arrowMatch[1]);
      const t = extractToken(arrowMatch[3]);
      if (s.label || !nodeLabels.has(s.id)) nodeLabels.set(s.id, s.label || s.id);
      if (t.label || !nodeLabels.has(t.id)) nodeLabels.set(t.id, t.label || t.id);
      const wRaw = (arrowMatch[2] || '').trim();
      const count = wRaw && !Number.isNaN(Number(wRaw)) ? Math.max(1, Math.round(Number(wRaw))) : 1;
      edges.push({ source: s.id, target: t.id, count });
      continue;
    }

    const nodeOnly = line.match(/^([A-Za-z0-9_.-]+)\s*(?:\[\s*"?([^"\]]+)"?\s*\]|\(\s*"?([^")]+)"?\s*\));?$/);
    if (nodeOnly) {
      const id = nodeOnly[1];
      const lbl = (nodeOnly[2] || nodeOnly[3] || id).replace(/\s*\(\d+\)\s*$/, '').trim();
      nodeLabels.set(id, lbl);
    }
  }

  if (edges.length === 0) {
    throw new Error('Could not find flowchart edges (A --> B) in Mermaid file.');
  }

  return assembleDfg(filename, nodeLabels, edges);
}

function assembleDfg(
  filename: string,
  nodeLabels: Map<string, string>,
  rawEdges: Array<{ source: string; target: string; count: number }>
): DFGGraph {
  const counts = new Map<string, number>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  nodeLabels.forEach((_, id) => counts.set(id, 0));

  const edges: DFGGraph['edges'] = rawEdges.map((e, idx) => {
    counts.set(e.source, (counts.get(e.source) || 0) + e.count);
    counts.set(e.target, (counts.get(e.target) || 0) + e.count);
    outgoing.add(e.source);
    incoming.add(e.target);
    return {
      id: `dfg_e_${idx}`,
      source: e.source,
      target: e.target,
      count: e.count,
    };
  });

  const startActivities: Record<string, number> = {};
  const endActivities: Record<string, number> = {};
  nodeLabels.forEach((_, id) => {
    const c = Math.max(1, counts.get(id) || 1);
    if (!incoming.has(id)) startActivities[id] = c;
    if (!outgoing.has(id)) endActivities[id] = c;
  });

  return {
    kind: 'dfg',
    id: `dfg-${Date.now()}`,
    name: filename,
    activities: Array.from(nodeLabels.entries()).map(([id, label]) => ({
      id,
      label,
      count: Math.max(1, counts.get(id) || 1),
    })),
    startActivities,
    endActivities,
    edges,
  };
}
