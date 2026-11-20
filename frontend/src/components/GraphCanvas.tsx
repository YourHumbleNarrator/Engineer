import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ComputedLayout,
  LayoutEdge,
  LayoutNode,
} from '../utils/graphLayout';
import {
  InteractionMode,
  ProcessTreeOperator,
  SelectedElement,
} from '../types/processMining';

interface GraphCanvasProps {
  layout: ComputedLayout;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  selected: SelectedElement | null;
  onSelect: (el: SelectedElement | null) => void;
  darkMode: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  graphId: string;
  resetPositionsSignal: number;
  onCustomOverridesChange: (hasOverrides: boolean) => void;
}

interface Point {
  x: number;
  y: number;
}

function getBoundaryPoint(node: LayoutNode, toward: Point): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };

  if (
    node.shape === 'place' ||
    node.shape === 'startTerminal' ||
    node.shape === 'endTerminal' ||
    node.shape === 'bpmnStart' ||
    node.shape === 'bpmnEnd' ||
    node.shape === 'bpmnIntermediate' ||
    node.shape === 'ptOperator'
  ) {
    const r = node.width / 2 + 2;
    const len = Math.hypot(dx, dy);
    return { x: node.x + (dx / len) * r, y: node.y + (dy / len) * r };
  }

  if (node.shape === 'bpmnGateway') {
    const r = node.width / 2 + 2;
    const scale = r / (Math.abs(dx) + Math.abs(dy) || 1);
    return { x: node.x + dx * scale, y: node.y + dy * scale };
  }

  const hw = node.width / 2 + 2;
  const hh = node.height / 2 + 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: node.x + dx * t, y: node.y + dy * t };
}

function quadPoint(p0: Point, cp: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
  };
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  layout,
  mode,
  onModeChange,
  selected,
  onSelect,
  darkMode,
  svgRef,
  graphId,
  resetPositionsSignal,
  onCustomOverridesChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 24, y: 24 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  const [nodeOverrides, setNodeOverrides] = useState<Record<string, Point>>({});
  const [edgeOverrides, setEdgeOverrides] = useState<Record<string, Point>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingEdgeId, setDraggingEdgeId] = useState<string | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  useEffect(() => {
    setNodeOverrides({});
    setEdgeOverrides({});
    setHoveredNodeId(null);
    setHoveredEdgeId(null);
  }, [graphId, layout.summary.resolvedOrientation, resetPositionsSignal]);

  useEffect(() => {
    onCustomOverridesChange(
      Object.keys(nodeOverrides).length > 0 || Object.keys(edgeOverrides).length > 0
    );
  }, [nodeOverrides, edgeOverrides, onCustomOverridesChange]);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 48;
    const scaleX = (rect.width - pad) / Math.max(layout.width, 1);
    const scaleY = (rect.height - pad) / Math.max(layout.height, 1);
    const nextZoom = Math.max(0.25, Math.min(1.15, Math.min(scaleX, scaleY)));
    const offsetX = Math.max(16, (rect.width - layout.width * nextZoom) / 2);
    const offsetY = Math.max(16, (rect.height - layout.height * nextZoom) / 2);
    setZoom(nextZoom);
    setPan({ x: offsetX, y: offsetY });
  }, [layout.width, layout.height]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  const positionedNodes = useMemo(() => {
    return layout.nodes.map((n) => {
      const ov = nodeOverrides[n.id];
      return ov ? { ...n, x: ov.x, y: ov.y } : n;
    });
  }, [layout.nodes, nodeOverrides]);

  const nodeById = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    positionedNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [positionedNodes]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const activeFocus = useMemo(() => {
    if (mode !== 'inspect') return null;
    const focusNodeId = hoveredNodeId || (selected?.kind === 'node' ? selected.id : null);
    const focusEdgeId = hoveredEdgeId || (selected?.kind === 'edge' ? selected.id : null);

    if (!focusNodeId && !focusEdgeId) return null;

    const highlightedNodes = new Set<string>();
    const highlightedEdges = new Set<string>();

    if (focusNodeId) {
      highlightedNodes.add(focusNodeId);
      layout.edges.forEach((e) => {
        if (e.source === focusNodeId || e.target === focusNodeId) {
          highlightedEdges.add(e.id);
          highlightedNodes.add(e.source);
          highlightedNodes.add(e.target);
        }
      });
    } else if (focusEdgeId) {
      highlightedEdges.add(focusEdgeId);
      const edge = layout.edges.find((e) => e.id === focusEdgeId);
      if (edge) {
        highlightedNodes.add(edge.source);
        highlightedNodes.add(edge.target);
      }
    }

    return { highlightedNodes, highlightedEdges };
  }, [mode, hoveredNodeId, hoveredEdgeId, selected, layout.edges]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (draggingNodeId || draggingEdgeId) return;
    setIsPanning(true);
    didDragRef.current = false;
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingNodeId && mode === 'edit') {
      didDragRef.current = true;
      const w = clientToWorld(e.clientX, e.clientY);
      setNodeOverrides((prev) => ({
        ...prev,
        [draggingNodeId]: {
          x: w.x - dragOffsetRef.current.x,
          y: w.y - dragOffsetRef.current.y,
        },
      }));
      return;
    }

    if (draggingEdgeId && mode === 'edit') {
      didDragRef.current = true;
      const w = clientToWorld(e.clientX, e.clientY);
      setEdgeOverrides((prev) => ({
        ...prev,
        [draggingEdgeId]: w,
      }));
      return;
    }

    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      if (Math.hypot(dx, dy) > 3) didDragRef.current = true;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    if (isPanning && !didDragRef.current && mode !== 'static') {
      onSelect(null);
    }
    setIsPanning(false);
    setDraggingNodeId(null);
    setDraggingEdgeId(null);
    panStartRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const nextZoom = Math.max(0.2, Math.min(2.6, zoom * factor));
    const ratio = nextZoom / zoom;
    setPan({
      x: mouseX - (mouseX - pan.x) * ratio,
      y: mouseY - (mouseY - pan.y) * ratio,
    });
    setZoom(nextZoom);
  };

  const selectNode = (node: LayoutNode) => {
    if (mode === 'static' || didDragRef.current) return;
    const incoming = layout.edges
      .filter((e) => e.target === node.id)
      .map((e) => `${nodeById.get(e.source)?.label || e.source}${e.label ? ` (${e.label})` : ''}`);
    const outgoing = layout.edges
      .filter((e) => e.source === node.id)
      .map((e) => `${nodeById.get(e.target)?.label || e.target}${e.label ? ` (${e.label})` : ''}`);

    const metrics: Array<{ label: string; value: string | number }> = [
      { label: 'Node ID', value: node.id },
      { label: 'Shape Type', value: node.shape },
      { label: 'Topological Rank', value: `Layer ${node.rank}` },
    ];
    if (node.count !== undefined) metrics.push({ label: 'Frequency', value: node.count.toLocaleString() });
    if (node.durationText) {
      metrics.push({ label: 'Time', value: node.durationText });
    } else if (node.sublabel) {
      metrics.push({ label: 'Time', value: node.sublabel });
    }
    if (node.initialTokens !== undefined) {
      metrics.push({ label: 'Initial Tokens', value: node.initialTokens });
    }
    if (node.isFinal !== undefined) {
      metrics.push({ label: 'Final Marking', value: node.isFinal ? 'Yes' : 'No' });
    }

    onSelect({
      kind: 'node',
      id: node.id,
      title: node.label,
      subtitle: node.silent ? 'Silent Transition (τ)' : node.shape,
      metrics,
      incoming,
      outgoing,
    });
  };

  const selectEdge = (edge: LayoutEdge) => {
    if (mode === 'static' || didDragRef.current) return;
    const src = nodeById.get(edge.source)?.label || edge.source;
    const tgt = nodeById.get(edge.target)?.label || edge.target;
    const metrics: Array<{ label: string; value: string | number }> = [
      { label: 'Edge ID', value: edge.id },
      { label: 'Source', value: src },
      { label: 'Target', value: tgt },
    ];
    if (edge.count !== undefined) metrics.push({ label: 'Transition Count', value: edge.count.toLocaleString() });
    if (edge.sublabel) metrics.push({ label: 'Mean Duration', value: edge.sublabel });
    if (edge.isBackEdge) metrics.push({ label: 'Routing Rule', value: 'Feedback Loop Arc' });
    if (edge.isBidirectional) metrics.push({ label: 'Routing Rule', value: 'Reciprocal Offset' });

    onSelect({
      kind: 'edge',
      id: edge.id,
      title: `${src} → ${tgt}`,
      subtitle: edge.isBackEdge ? 'Loop Back-Edge' : 'Directed Flow',
      metrics,
    });
  };

  const opSymbolMap: Record<ProcessTreeOperator, string> = {
    seq: '→',
    xor: '×',
    and: '∧',
    loop: '↺',
    or: '∨',
  };

  return (
    <div className="relative flex-1 h-full overflow-hidden select-none">
      {/* Floating Top-Left 3-Mode Switcher (clean text, no layout bars or symbols) */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none">
        <div
          className="pointer-events-auto inline-flex items-center gap-1 p-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-sm backdrop-blur"
          role="tablist"
          aria-label="Visualization interaction mode"
        >
          <button
            type="button"
            onClick={() => {
              onModeChange('static');
              setHoveredNodeId(null);
              setHoveredEdgeId(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'static'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Static
          </button>
          <button
            type="button"
            onClick={() => onModeChange('inspect')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'inspect'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Inspect
          </button>
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'edit'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Drag Nodes & Edges
          </button>
        </div>
      </div>

      {/* Zoom Controls Bottom-Right */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 p-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-sm">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.2, z * 0.85))}
          aria-label="Zoom out"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="px-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 min-w-[48px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.6, z * 1.15))}
          aria-label="Zoom in"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          title="Fit graph to viewport"
          aria-label="Fit graph to viewport"
          className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border-l border-slate-200 dark:border-slate-800 ml-0.5 pl-2"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive SVG Viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onWheel={handleWheel}
        className={`w-full h-full ${
          darkMode ? 'canvas-grid-dark' : 'canvas-grid-light'
        } ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="block w-full h-full"
          data-graph-width={layout.width}
          data-graph-height={layout.height}
        >
          <defs>
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={darkMode ? '#64748b' : '#475569'} />
            </marker>
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#1d4ed8" />
            </marker>
            <marker
              id="arrow-back"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#d97706" />
            </marker>
          </defs>

          <g id="viewport-transform" transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* BPMN Swimlanes */}
            {layout.lanes.map((lane, idx) => (
              <g key={lane.id}>
                <rect
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  fill={
                    darkMode
                      ? idx % 2 === 0
                        ? 'rgba(15, 23, 42, 0.55)'
                        : 'rgba(30, 41, 59, 0.35)'
                      : idx % 2 === 0
                      ? 'rgba(255, 255, 255, 0.72)'
                      : 'rgba(241, 245, 249, 0.65)'
                  }
                  stroke={darkMode ? '#334155' : '#cbd5e1'}
                  strokeWidth={1.2}
                />
                <rect
                  x={lane.x}
                  y={lane.y}
                  width={48}
                  height={lane.height}
                  fill={darkMode ? '#1e293b' : '#f1f5f9'}
                  stroke={darkMode ? '#334155' : '#cbd5e1'}
                  strokeWidth={1.2}
                />
                <text
                  x={lane.x + 24}
                  y={lane.y + lane.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(-90, ${lane.x + 24}, ${lane.y + lane.height / 2})`}
                  fill={darkMode ? '#cbd5e1' : '#334155'}
                  fontSize={12}
                  fontWeight={600}
                >
                  {lane.label}
                </text>
              </g>
            ))}

            {/* Edges */}
            {layout.edges.map((edge) => {
              const sNode = nodeById.get(edge.source);
              const tNode = nodeById.get(edge.target);
              if (!sNode || !tNode) return null;

              const isHighlighted =
                selected?.id === edge.id ||
                hoveredEdgeId === edge.id ||
                Boolean(activeFocus?.highlightedEdges.has(edge.id));
              const isDimmed =
                Boolean(activeFocus) && !activeFocus?.highlightedEdges.has(edge.id);

              let pathD = '';
              let labelPos: Point = { x: 0, y: 0 };

              if (edge.isSelfLoop) {
                const sx = sNode.x - 16;
                const sy = sNode.y - sNode.height / 2;
                const ex = sNode.x + 16;
                const ey = sNode.y - sNode.height / 2;
                const customMid = edgeOverrides[edge.id];
                const cpY = customMid
                  ? (customMid.y - 0.25 * sy) / 0.75
                  : sNode.y - sNode.height / 2 - 64;
                const cpX = customMid ? customMid.x : sNode.x;
                pathD = `M ${sx} ${sy} C ${sx - 28} ${cpY}, ${ex + 28} ${cpY}, ${ex} ${ey}`;
                labelPos = { x: cpX, y: 0.25 * sy + 0.75 * cpY };
              } else {
                const mx = (sNode.x + tNode.x) / 2;
                const my = (sNode.y + tNode.y) / 2;
                const dx = tNode.x - sNode.x;
                const dy = tNode.y - sNode.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = -dy / len;
                const ny = dx / len;

                let cp: Point;
                const customMid = edgeOverrides[edge.id];
                if (customMid) {
                  const approxStart = getBoundaryPoint(sNode, customMid);
                  const approxEnd = getBoundaryPoint(tNode, customMid);
                  cp = {
                    x: 2 * customMid.x - 0.5 * (approxStart.x + approxEnd.x),
                    y: 2 * customMid.y - 0.5 * (approxStart.y + approxEnd.y),
                  };
                } else if (edge.isBackEdge) {
                  cp =
                    layout.summary.resolvedOrientation === 'LR'
                      ? { x: mx, y: Math.max(sNode.y, tNode.y) + edge.curveOffset }
                      : { x: Math.max(sNode.x, tNode.x) + edge.curveOffset, y: my };
                } else {
                  cp = {
                    x: mx + nx * edge.curveOffset,
                    y: my + ny * edge.curveOffset,
                  };
                }

                const startPt = getBoundaryPoint(sNode, cp);
                const endPt = getBoundaryPoint(tNode, cp);
                pathD = `M ${startPt.x} ${startPt.y} Q ${cp.x} ${cp.y} ${endPt.x} ${endPt.y}`;
                labelPos = customMid || quadPoint(startPt, cp, endPt, 0.5);
              }

              const strokeWidth = edge.isStartArc || edge.isEndArc ? 1.5 : 1.4 + edge.weightRatio * 3.4;
              const strokeColor = isHighlighted
                ? '#1d4ed8'
                : edge.isBackEdge
                ? '#d97706'
                : '#64748b';
              const markerEnd = isHighlighted
                ? 'url(#arrow-active)'
                : edge.isBackEdge
                ? 'url(#arrow-back)'
                : 'url(#arrow-default)';

              return (
                <g
                  key={edge.id}
                  style={{ opacity: isDimmed ? 0.18 : 1, transition: 'opacity 150ms ease' }}
                  onMouseEnter={() =>
                    (mode === 'inspect' || mode === 'edit') && setHoveredEdgeId(edge.id)
                  }
                  onMouseLeave={() =>
                    (mode === 'inspect' || mode === 'edit') && setHoveredEdgeId(null)
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    selectEdge(edge);
                  }}
                  className={mode !== 'static' ? 'cursor-pointer' : undefined}
                >
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth={14} />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.isStartArc || edge.isEndArc ? '5 4' : undefined}
                    markerEnd={markerEnd}
                  />

                  {(edge.label || edge.sublabel) && (
                    <g transform={`translate(${labelPos.x}, ${labelPos.y})`}>
                      <rect
                        x={-28}
                        y={-10}
                        width={56}
                        height={edge.sublabel ? 24 : 18}
                        rx={4}
                        fill={darkMode ? '#0f172a' : '#ffffff'}
                        stroke={
                          isHighlighted
                            ? '#1d4ed8'
                            : darkMode
                            ? '#334155'
                            : '#e2e8f0'
                        }
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={edge.sublabel ? -2 : 0}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={
                          isHighlighted
                            ? '#2563eb'
                            : edge.isBackEdge
                            ? '#d97706'
                            : darkMode
                            ? '#e2e8f0'
                            : '#1e293b'
                        }
                        fontSize={10.5}
                        fontWeight={600}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {edge.label}
                      </text>
                      {edge.sublabel && (
                        <text
                          x={0}
                          y={8}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={darkMode ? '#94a3b8' : '#64748b'}
                          fontSize={9}
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {edge.sublabel}
                        </text>
                      )}
                    </g>
                  )}

                  {mode === 'edit' && (
                    <circle
                      data-export-ignore="true"
                      cx={labelPos.x}
                      cy={labelPos.y}
                      r={7}
                      fill="#1d4ed8"
                      fillOpacity={
                        hoveredEdgeId === edge.id || draggingEdgeId === edge.id ? 0.92 : 0.32
                      }
                      stroke="#ffffff"
                      strokeOpacity={
                        hoveredEdgeId === edge.id || draggingEdgeId === edge.id ? 0.95 : 0.45
                      }
                      strokeWidth={1.8}
                      className="cursor-move"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        didDragRef.current = false;
                        setDraggingEdgeId(edge.id);
                      }}
                    />
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {positionedNodes.map((node) => {
              const isSelected = selected?.id === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isHighlighted =
                isSelected || isHovered || Boolean(activeFocus?.highlightedNodes.has(node.id));
              const isDimmed =
                Boolean(activeFocus) && !activeFocus?.highlightedNodes.has(node.id);

              const strokeColor = isSelected || isHovered
                ? '#1d4ed8'
                : node.isStart
                ? '#059669'
                : node.isEnd
                ? '#dc2626'
                : darkMode
                ? '#475569'
                : '#94a3b8';

              const strokeWidth = isSelected || isHovered ? 2.2 : 1.4;

              const heatAlpha = node.heatRatio !== undefined ? 0.05 + node.heatRatio * 0.16 : 0;
              const cardFill =
                node.shape === 'activity'
                  ? darkMode
                    ? `rgba(37, 99, 235, ${heatAlpha + 0.08})`
                    : `rgba(29, 78, 216, ${heatAlpha})`
                  : darkMode
                  ? '#1e293b'
                  : '#ffffff';

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{
                    opacity: isDimmed ? 0.2 : 1,
                    transition: 'opacity 150ms ease',
                  }}
                  className={
                    mode === 'edit'
                      ? 'cursor-grab active:cursor-grabbing'
                      : mode === 'inspect'
                      ? 'cursor-pointer'
                      : undefined
                  }
                  onMouseEnter={() => mode === 'inspect' && setHoveredNodeId(node.id)}
                  onMouseLeave={() => mode === 'inspect' && setHoveredNodeId(null)}
                  onMouseDown={(e) => {
                    if (mode !== 'edit' || e.button !== 0) return;
                    e.stopPropagation();
                    didDragRef.current = false;
                    const w = clientToWorld(e.clientX, e.clientY);
                    dragOffsetRef.current = { x: w.x - node.x, y: w.y - node.y };
                    setDraggingNodeId(node.id);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectNode(node);
                  }}
                >
                  {(node.shape === 'startTerminal' || node.shape === 'endTerminal') && (
                    <>
                      <circle
                        r={node.width / 2}
                        fill={
                          node.shape === 'startTerminal'
                            ? darkMode
                              ? '#064e3b'
                              : '#ecfdf5'
                            : darkMode
                            ? '#7f1d1d'
                            : '#fef2f2'
                        }
                        stroke={node.shape === 'startTerminal' ? '#059669' : '#dc2626'}
                        strokeWidth={2}
                      />
                      {node.shape === 'startTerminal' ? (
                        <polygon points="-5,-8 9,0 -5,8" fill="#059669" />
                      ) : (
                        <rect x={-7} y={-7} width={14} height={14} rx={2} fill="#dc2626" />
                      )}
                      <text
                        y={node.width / 2 + 14}
                        textAnchor="middle"
                        fill={darkMode ? '#94a3b8' : '#64748b'}
                        fontSize={10}
                        fontWeight={600}
                      >
                        {node.label}
                      </text>
                    </>
                  )}

                  {node.shape === 'place' && (
                    <>
                      <circle
                        r={node.width / 2}
                        fill={darkMode ? '#0f172a' : '#ffffff'}
                        stroke={isHighlighted ? '#1d4ed8' : darkMode ? '#94a3b8' : '#334155'}
                        strokeWidth={strokeWidth}
                      />
                      {node.isFinal && (
                        <circle
                          r={node.width / 2 - 4.5}
                          fill="none"
                          stroke={isHighlighted ? '#1d4ed8' : '#dc2626'}
                          strokeWidth={1.6}
                        />
                      )}
                      {node.initialTokens === 1 && (
                        <circle r={5.5} fill={darkMode ? '#f8fafc' : '#0f172a'} />
                      )}
                      {node.initialTokens === 2 && (
                        <>
                          <circle cx={-6} r={4} fill={darkMode ? '#f8fafc' : '#0f172a'} />
                          <circle cx={6} r={4} fill={darkMode ? '#f8fafc' : '#0f172a'} />
                        </>
                      )}
                      {(node.initialTokens || 0) >= 3 && (
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={darkMode ? '#f8fafc' : '#0f172a'}
                          fontSize={12}
                          fontWeight={700}
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {node.initialTokens}
                        </text>
                      )}
                      <text
                        y={node.width / 2 + 13}
                        textAnchor="middle"
                        fill={darkMode ? '#94a3b8' : '#64748b'}
                        fontSize={10}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {node.label}
                      </text>
                    </>
                  )}

                  {node.shape === 'silentTransition' && (
                    <>
                      <rect
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={3}
                        fill={isHighlighted ? '#1d4ed8' : darkMode ? '#e2e8f0' : '#0f172a'}
                      />
                      <text
                        y={node.height / 2 + 13}
                        textAnchor="middle"
                        fill={darkMode ? '#94a3b8' : '#64748b'}
                        fontSize={10}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        τ
                      </text>
                    </>
                  )}

                  {node.shape === 'ptOperator' && (
                    <>
                      <circle
                        r={node.width / 2}
                        fill={darkMode ? '#1e293b' : '#ffffff'}
                        stroke={isHighlighted ? '#1d4ed8' : '#0f172a'}
                        strokeWidth={isHighlighted ? 2.4 : 1.8}
                      />
                      <text
                        y={-1}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={darkMode ? '#f8fafc' : '#0f172a'}
                        fontSize={20}
                        fontWeight={700}
                      >
                        {node.operator ? opSymbolMap[node.operator] : '→'}
                      </text>
                      <text
                        y={node.width / 2 + 13}
                        textAnchor="middle"
                        fill={darkMode ? '#94a3b8' : '#475569'}
                        fontSize={10}
                        fontWeight={600}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {node.label}
                      </text>
                    </>
                  )}

                  {node.shape === 'ptTau' && (
                    <>
                      <rect
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={8}
                        fill={darkMode ? '#334155' : '#0f172a'}
                        stroke={isHighlighted ? '#1d4ed8' : 'none'}
                        strokeWidth={2}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#ffffff"
                        fontSize={16}
                        fontWeight={700}
                      >
                        τ
                      </text>
                    </>
                  )}

                  {(node.shape === 'bpmnStart' ||
                    node.shape === 'bpmnEnd' ||
                    node.shape === 'bpmnIntermediate') && (
                    <>
                      <circle
                        r={node.width / 2}
                        fill={
                          node.shape === 'bpmnStart'
                            ? darkMode
                              ? '#064e3b'
                              : '#ecfdf5'
                            : node.shape === 'bpmnEnd'
                            ? darkMode
                              ? '#7f1d1d'
                              : '#fef2f2'
                            : darkMode
                            ? '#1e293b'
                            : '#ffffff'
                        }
                        stroke={
                          isHighlighted
                            ? '#1d4ed8'
                            : node.shape === 'bpmnStart'
                            ? '#059669'
                            : node.shape === 'bpmnEnd'
                            ? '#dc2626'
                            : '#d97706'
                        }
                        strokeWidth={node.shape === 'bpmnEnd' ? 3.5 : 1.8}
                      />
                      {node.shape === 'bpmnIntermediate' && (
                        <circle
                          r={node.width / 2 - 4}
                          fill="none"
                          stroke="#d97706"
                          strokeWidth={1.3}
                        />
                      )}
                      <text
                        y={node.width / 2 + 14}
                        textAnchor="middle"
                        fill={darkMode ? '#cbd5e1' : '#334155'}
                        fontSize={11}
                        fontWeight={500}
                      >
                        {node.label}
                      </text>
                    </>
                  )}

                  {node.shape === 'bpmnGateway' && (
                    <>
                      <polygon
                        points={`0,${-node.height / 2} ${node.width / 2},0 0,${node.height / 2} ${
                          -node.width / 2
                        },0`}
                        fill={darkMode ? '#1e293b' : '#fffbeb'}
                        stroke={isHighlighted ? '#1d4ed8' : '#d97706'}
                        strokeWidth={isHighlighted ? 2.4 : 1.8}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={darkMode ? '#fbbf24' : '#b45309'}
                        fontSize={20}
                        fontWeight={700}
                      >
                        {node.gatewayType === 'and'
                          ? '+'
                          : node.gatewayType === 'or'
                          ? '○'
                          : '×'}
                      </text>
                      {node.label && (
                        <text
                          y={node.height / 2 + 14}
                          textAnchor="middle"
                          fill={darkMode ? '#cbd5e1' : '#475569'}
                          fontSize={10.5}
                          fontWeight={500}
                        >
                          {node.label}
                        </text>
                      )}
                    </>
                  )}

                  {(node.shape === 'activity' ||
                    node.shape === 'transition' ||
                    node.shape === 'ptActivity' ||
                    node.shape === 'bpmnTask') && (
                    <>
                      <rect
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={node.shape === 'transition' ? 4 : 9}
                        fill={darkMode ? '#0f172a' : '#ffffff'}
                        stroke="none"
                      />
                      <rect
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={node.shape === 'transition' ? 4 : 9}
                        fill={cardFill}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                      />
                      <text
                        y={node.sublabel ? -7 : 0}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={darkMode ? '#f1f5f9' : '#0f172a'}
                        fontSize={12.5}
                        fontWeight={600}
                      >
                        {node.label.length > 23 ? `${node.label.slice(0, 21)}…` : node.label}
                      </text>
                      {node.sublabel && (
                        <text
                          y={11}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={darkMode ? '#94a3b8' : '#475569'}
                          fontSize={10.5}
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {node.sublabel}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};

export function serializeSvgForDownload(
  svgEl: SVGSVGElement,
  layout: ComputedLayout,
  darkMode: boolean
): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export-ignore="true"]').forEach((el) => el.remove());

  const vp = clone.querySelector('#viewport-transform');
  if (vp) {
    vp.setAttribute('transform', 'translate(0, 0) scale(1)');
  }

  const w = Math.ceil(layout.width);
  const h = Math.ceil(layout.height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', darkMode ? '#090d16' : '#f8fafc');
  clone.insertBefore(bg, clone.firstChild);

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `text { font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif; }`;
  clone.insertBefore(style, clone.firstChild);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}
