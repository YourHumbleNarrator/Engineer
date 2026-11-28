import React, { useState } from 'react';
import {
  CrossingMinLevel,
  EdgeRoutingStyle,
  GraphStats,
  LayoutAlgorithm,
  LayoutConfig,
  LayoutOrientation,
  LayoutRuleSummary,
  SelectedElement,
} from '../types/processMining';
import { LAYOUT_RULES_GUIDE } from '../utils/graphLayout';

interface GraphInfoPanelProps {
  graphName: string;
  stats: GraphStats;
  layoutSummary: LayoutRuleSummary;
  layoutConfig: LayoutConfig;
  onLayoutConfigChange: (next: LayoutConfig) => void;
  onResetLayoutDefaults: () => void;
  hasCustomOverrides: boolean;
  onResetPositions: () => void;
  selected: SelectedElement | null;
}

export const GraphInfoPanel: React.FC<GraphInfoPanelProps> = ({
  graphName,
  stats,
  layoutSummary,
  layoutConfig,
  onLayoutConfigChange,
  onResetLayoutDefaults,
  hasCustomOverrides,
  onResetPositions,
  selected,
}) => {
  const [showFullGuide, setShowFullGuide] = useState(false);

  const kindLabelMap: Record<GraphStats['kind'], string> = {
    dfg: 'Directly-Follows Graph',
    petri_net: 'Petri Net',
    process_tree: 'Process Tree',
    bpmn: 'BPMN 2.0 Model',
  };

  const algoLabelMap: Record<Exclude<LayoutAlgorithm, 'auto'>, string> = {
    sugiyama: 'Layered Flow',
    backbone_spine: 'Backbone Spine',
    stress_majorization: 'Stress Layout',
    tree_hierarchy: 'Tree',
  };

  const routingLabelMap: Record<Exclude<EdgeRoutingStyle, 'auto'>, string> = {
    curved: 'Curved',
    orthogonal: 'Orthogonal',
    bundled: 'Bundled',
  };

  const crossingLabelMap: Record<Exclude<CrossingMinLevel, 'auto'>, string> = {
    standard: 'Standard',
    intensive: 'Intensive',
  };

  const planarityStyleMap: Record<
    LayoutRuleSummary['planarityStatus'],
    { text: string; cls: string }
  > = {
    planar_verified: {
      text: 'Planar',
      cls: 'text-emerald-700 dark:text-emerald-400',
    },
    near_planar: {
      text: 'Near-planar',
      cls: 'text-amber-700 dark:text-amber-400',
    },
    non_planar_euler: {
      text: 'Non-planar',
      cls: 'text-rose-700 dark:text-rose-400',
    },
  };

  const planarityDisplay = planarityStyleMap[layoutSummary.planarityStatus];
  const effectiveSpacing =
    layoutConfig.spacingScale ?? layoutSummary.resolvedSpacingScale;
  const effectiveBackbone =
    layoutConfig.highlightBackbone ?? layoutSummary.resolvedHighlightBackbone;
  const isBackboneAuto =
    layoutConfig.highlightBackbone === null ||
    effectiveBackbone === layoutSummary.defaultHighlightBackbone;
  const isSpacingAuto =
    layoutConfig.spacingScale === null ||
    Math.abs(effectiveSpacing - layoutSummary.defaultSpacingScale) < 0.005;

  const hasLayoutOverrides =
    layoutConfig.algorithm !== 'auto' ||
    layoutConfig.orientation !== 'auto' ||
    layoutConfig.edgeRouting !== 'auto' ||
    layoutConfig.crossingMin !== 'auto' ||
    !isSpacingAuto ||
    !isBackboneAuto ||
    Boolean(layoutConfig.forcePlanar) ||
    Boolean(layoutConfig.chunkLongGraph);

  const orientationDisabled = !layoutSummary.orientationApplicable;
  const crossingDisabled = !layoutSummary.crossingApplicable;
  const chunkDisabled =
    layoutSummary.resolvedAlgorithm === 'stress_majorization' ||
    layoutSummary.resolvedAlgorithm === 'tree_hierarchy' ||
    Boolean(layoutSummary.forcePlanarActive);

  return (
    <div className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
      {/* Header Summary */}
      <section className="p-4">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {kindLabelMap[stats.kind]}
        </div>
        <h2 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
          {graphName
            .replace(/\s+[—-]\s+.*$/, '')
            .replace(/\s+\((INDUCTIVE|HEURISTICS|ALPHA)\s+·\s+.*\)$/i, '')}
        </h2>

        {/* Primary Metrics Grid */}
        <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-800/80 pt-3">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Nodes</div>
            <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.nodeCount}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Edges</div>
            <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.edgeCount}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg Deg</div>
            <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {layoutSummary.avgDegree}
            </div>
          </div>
        </div>
      </section>

      {/* Adaptive Layout Rules & Experimentation Controls */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white">
            Layout Rules
          </h3>
          {(hasLayoutOverrides || hasCustomOverrides) && (
            <button
              type="button"
              onClick={() => {
                onResetLayoutDefaults();
                onResetPositions();
              }}
              className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
            >
              Reset to Defaults
            </button>
          )}
        </div>

        {/* Clean Planarity Readout */}
        <div className="flex items-center justify-between text-xs py-0.5">
          <span className="text-slate-500 dark:text-slate-400">Planarity</span>
          <span className={`font-semibold ${planarityDisplay.cls}`}>
            {planarityDisplay.text}
          </span>
        </div>

        {/* Clickable Auto Choice Options — Names Only, Descriptions in Tooltip */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Auto Choice
          </div>
          <div className="space-y-1.5">
            <div className="relative group">
              <button
                type="button"
                title={layoutSummary.autoReasons.algorithm}
                onClick={() =>
                  onLayoutConfigChange({ ...layoutConfig, algorithm: 'auto' })
                }
                className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                  layoutConfig.algorithm === 'auto'
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Layout: {algoLabelMap[layoutSummary.resolvedAlgorithm]}
                  </span>
                  <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                    {layoutConfig.algorithm === 'auto' ? 'Active' : 'Use Auto'}
                  </span>
                </div>
              </button>
              <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 z-30 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                {layoutSummary.autoReasons.algorithm}
              </div>
            </div>

            <div className="relative group">
              <button
                type="button"
                disabled={orientationDisabled}
                title={layoutSummary.autoReasons.orientation}
                onClick={() =>
                  onLayoutConfigChange({ ...layoutConfig, orientation: 'auto' })
                }
                className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                  orientationDisabled
                    ? 'border-slate-200 dark:border-slate-800 opacity-45 cursor-not-allowed'
                    : layoutConfig.orientation === 'auto'
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Orientation:{' '}
                    {layoutSummary.resolvedOrientation === 'LR'
                      ? 'Left-Right'
                      : 'Top-Down'}
                  </span>
                  {!orientationDisabled && (
                    <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                      {layoutConfig.orientation === 'auto' ? 'Active' : 'Use Auto'}
                    </span>
                  )}
                </div>
              </button>
              <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 z-30 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                {layoutSummary.autoReasons.orientation}
              </div>
            </div>

            <div className="relative group">
              <button
                type="button"
                title={layoutSummary.autoReasons.routing}
                onClick={() =>
                  onLayoutConfigChange({ ...layoutConfig, edgeRouting: 'auto' })
                }
                className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                  layoutConfig.edgeRouting === 'auto'
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Edges: {routingLabelMap[layoutSummary.resolvedRouting]}
                  </span>
                  <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                    {layoutConfig.edgeRouting === 'auto' ? 'Active' : 'Use Auto'}
                  </span>
                </div>
              </button>
              <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 z-30 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                {layoutSummary.autoReasons.routing}
              </div>
            </div>

            <div className="relative group">
              <button
                type="button"
                disabled={crossingDisabled}
                title={layoutSummary.autoReasons.crossingMin}
                onClick={() =>
                  onLayoutConfigChange({ ...layoutConfig, crossingMin: 'auto' })
                }
                className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                  crossingDisabled
                    ? 'border-slate-200 dark:border-slate-800 opacity-45 cursor-not-allowed'
                    : layoutConfig.crossingMin === 'auto'
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Crossing Pass:{' '}
                    {crossingDisabled
                      ? 'Unavailable'
                      : crossingLabelMap[layoutSummary.resolvedCrossingMin]}
                  </span>
                  {!crossingDisabled && (
                    <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                      {layoutConfig.crossingMin === 'auto' ? 'Active' : 'Use Auto'}
                    </span>
                  )}
                </div>
              </button>
              <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 z-30 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                {layoutSummary.autoReasons.crossingMin}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div className="relative group">
                <button
                  type="button"
                  title={layoutSummary.autoReasons.backbone}
                  onClick={() =>
                    onLayoutConfigChange({ ...layoutConfig, highlightBackbone: null })
                  }
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                    isBackboneAuto
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                    Backbone: {effectiveBackbone ? 'On' : 'Off'}
                  </div>
                  <div className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                    {isBackboneAuto ? 'Auto' : 'Use Auto'}
                  </div>
                </button>
                <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 z-30 w-52 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  {layoutSummary.autoReasons.backbone}
                </div>
              </div>

              <div className="relative group">
                <button
                  type="button"
                  title={layoutSummary.autoReasons.spacing}
                  onClick={() =>
                    onLayoutConfigChange({ ...layoutConfig, spacingScale: null })
                  }
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                    isSpacingAuto
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                    Spacing: {effectiveSpacing.toFixed(2)}x
                  </div>
                  <div className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                    {isSpacingAuto ? 'Auto' : 'Use Auto'}
                  </div>
                </button>
                <div className="pointer-events-none absolute right-0 top-full mt-1 z-30 w-52 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  {layoutSummary.autoReasons.spacing}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Unique Layout Algorithms */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Layout Algorithm
          </label>
          <select
            value={
              layoutConfig.algorithm === 'auto' ||
              layoutSummary.availableAlgorithms.includes(layoutConfig.algorithm)
                ? layoutConfig.algorithm
                : 'auto'
            }
            onChange={(e) =>
              onLayoutConfigChange({
                ...layoutConfig,
                algorithm: e.target.value as LayoutAlgorithm,
              })
            }
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="auto">Auto</option>
            {layoutSummary.availableAlgorithms.map((alg) => (
              <option key={alg} value={alg}>
                {algoLabelMap[alg]}
              </option>
            ))}
          </select>
        </div>

        {/* Orientation */}
        <div className={orientationDisabled ? 'opacity-45' : ''}>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Orientation
          </label>
          <select
            disabled={orientationDisabled}
            value={layoutConfig.orientation}
            onChange={(e) =>
              onLayoutConfigChange({
                ...layoutConfig,
                orientation: e.target.value as LayoutOrientation,
              })
            }
            className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:cursor-not-allowed"
          >
            <option value="auto">Auto</option>
            <option value="LR">Left-Right</option>
            <option value="TB">Top-Down</option>
          </select>
        </div>

        {/* Unique Edge Routing Styles + Crossing Pass */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Edge Routing
            </label>
            <select
              value={
                layoutConfig.edgeRouting === 'auto' ||
                layoutSummary.availableRoutings.includes(layoutConfig.edgeRouting)
                  ? layoutConfig.edgeRouting
                  : 'auto'
              }
              onChange={(e) =>
                onLayoutConfigChange({
                  ...layoutConfig,
                  edgeRouting: e.target.value as EdgeRoutingStyle,
                })
              }
              className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="auto">Auto</option>
              {layoutSummary.availableRoutings.map((rt) => (
                <option key={rt} value={rt}>
                  {routingLabelMap[rt]}
                </option>
              ))}
            </select>
          </div>
          <div className={crossingDisabled ? 'opacity-45' : ''}>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Crossing Pass
            </label>
            <select
              disabled={crossingDisabled}
              value={layoutConfig.crossingMin}
              onChange={(e) =>
                onLayoutConfigChange({
                  ...layoutConfig,
                  crossingMin: e.target.value as CrossingMinLevel,
                })
              }
              className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:cursor-not-allowed"
            >
              <option value="auto">Auto</option>
              <option value="standard">Standard</option>
              <option value="intensive">Intensive</option>
            </select>
          </div>
        </div>

        {/* Unboxed Backbone Focus Switch */}
        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Backbone Focus
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={effectiveBackbone}
            aria-label="Toggle Backbone Focus"
            onClick={() => {
              const nextVal = !effectiveBackbone;
              onLayoutConfigChange({
                ...layoutConfig,
                highlightBackbone:
                  nextVal === layoutSummary.defaultHighlightBackbone
                    ? null
                    : nextVal,
              });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              effectiveBackbone
                ? 'bg-blue-700 dark:bg-blue-600'
                : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                effectiveBackbone ? 'translate-x-4.5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Force Planar Switch (only shown when graph is planar) */}
        {layoutSummary.planarityStatus === 'planar_verified' && (
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Force Planar
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(layoutConfig.forcePlanar)}
              aria-label="Toggle Force Planar"
              onClick={() =>
                onLayoutConfigChange({
                  ...layoutConfig,
                  forcePlanar: !layoutConfig.forcePlanar,
                })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                layoutConfig.forcePlanar
                  ? 'bg-blue-700 dark:bg-blue-600'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  layoutConfig.forcePlanar ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}

        {/* Divide Switch */}
        <div
          className={`flex items-center justify-between gap-3 py-1 ${
            chunkDisabled ? 'opacity-45' : ''
          }`}
          title={
            chunkDisabled
              ? 'Available for Layered Flow and Backbone Spine layouts without Force Planar'
              : 'Divide a very long graph into the fewest rows or columns needed to fit in one view'
          }
        >
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Divide
          </span>
          <button
            type="button"
            role="switch"
            disabled={chunkDisabled}
            aria-checked={Boolean(layoutConfig.chunkLongGraph) && !chunkDisabled}
            aria-label="Toggle Divide"
            onClick={() =>
              onLayoutConfigChange({
                ...layoutConfig,
                chunkLongGraph: !layoutConfig.chunkLongGraph,
              })
            }
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
              layoutConfig.chunkLongGraph && !chunkDisabled
                ? 'bg-blue-700 dark:bg-blue-600'
                : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                layoutConfig.chunkLongGraph && !chunkDisabled
                  ? 'translate-x-4.5'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Node Spacing */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Node Spacing
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {effectiveSpacing.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min={0.75}
            max={1.8}
            step={0.05}
            value={effectiveSpacing}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              onLayoutConfigChange({
                ...layoutConfig,
                spacingScale:
                  Math.abs(val - layoutSummary.defaultSpacingScale) < 0.005
                    ? null
                    : val,
              });
            }}
            aria-label="Layout spacing multiplier"
            className="w-full accent-blue-700 cursor-pointer"
          />
        </div>

        {/* Full Rules Guide */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <button
            type="button"
            onClick={() => setShowFullGuide((v) => !v)}
            className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
          >
            {showFullGuide
              ? 'Hide Layout Rules & Compatibility'
              : 'Show All Layout Rules & Compatibility'}
          </button>

          {showFullGuide && (
            <div className="space-y-1.5 pt-1">
              {LAYOUT_RULES_GUIDE.map((entry) => (
                <div
                  key={entry.title}
                  className="p-2 rounded-md border border-slate-200 dark:border-slate-800 text-[11px] space-y-0.5"
                >
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {entry.title}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 leading-snug">
                    {entry.summary}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    Works for: {entry.worksFor}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Model-Specific Breakdown */}
      <section className="p-4">
        <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white pb-1.5 mb-2.5 border-b border-slate-200 dark:border-slate-800">
          Structural Breakdown
        </h3>
        <dl className="space-y-2">
          {stats.details.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between text-xs py-0.5"
            >
              <dt className="text-slate-600 dark:text-slate-400">{row.label}</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Selected Element Inspector */}
      <section className="p-4">
        <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white pb-1.5 mb-2.5 border-b border-slate-200 dark:border-slate-800">
          Element Inspector
        </h3>
        {!selected ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Switch to Inspect or Drag mode and click any node or edge to inspect its
            attributes and incident connections.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {selected.subtitle}
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {selected.title}
              </div>
            </div>
            <dl className="space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2.5">
              {selected.metrics.map((m) => (
                <div key={m.label} className="flex items-center justify-between text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">{m.label}</dt>
                  <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
            {selected.incoming && selected.incoming.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Incoming
                </div>
                <ul className="space-y-0.5 text-xs text-slate-700 dark:text-slate-300 font-mono">
                  {selected.incoming.map((item, idx) => (
                    <li key={idx} className="truncate">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selected.outgoing && selected.outgoing.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Outgoing
                </div>
                <ul className="space-y-0.5 text-xs text-slate-700 dark:text-slate-300 font-mono">
                  {selected.outgoing.map((item, idx) => (
                    <li key={idx} className="truncate">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
