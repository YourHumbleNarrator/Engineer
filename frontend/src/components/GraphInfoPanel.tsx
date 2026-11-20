import React from 'react';
import {
  GraphStats,
  LayoutOrientation,
  SelectedElement,
} from '../types/processMining';

interface GraphInfoPanelProps {
  graphName: string;
  stats: GraphStats;
  selected: SelectedElement | null;
  orientation: LayoutOrientation;
  onOrientationChange: (o: LayoutOrientation) => void;
  spacingScale: number;
  onSpacingScaleChange: (s: number) => void;
  hasCustomOverrides: boolean;
  onResetPositions: () => void;
}

export const GraphInfoPanel: React.FC<GraphInfoPanelProps> = ({
  graphName,
  stats,
  selected,
  orientation,
  onOrientationChange,
  spacingScale,
  onSpacingScaleChange,
  hasCustomOverrides,
  onResetPositions,
}) => {
  const kindLabelMap: Record<GraphStats['kind'], string> = {
    dfg: 'Directly-Follows Graph',
    petri_net: 'Petri Net',
    process_tree: 'Process Tree',
    bpmn: 'BPMN 2.0 Model',
  };

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
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-800/80 pt-3">
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
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Density</div>
            <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.density}
            </div>
          </div>
        </div>
      </section>

      {/* Layout Rules Controls */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white">
            Layout Rules
          </h3>
          {hasCustomOverrides && (
            <button
              type="button"
              onClick={onResetPositions}
              className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
            >
              Reset Positions
            </button>
          )}
        </div>

        <div>
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Orientation
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => onOrientationChange('auto')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                orientation === 'auto'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => onOrientationChange('LR')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                orientation === 'LR'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Left-Right
            </button>
            <button
              type="button"
              onClick={() => onOrientationChange('TB')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                orientation === 'TB'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Top-Down
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Node Spacing
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {spacingScale.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={spacingScale}
            onChange={(e) => onSpacingScaleChange(parseFloat(e.target.value))}
            aria-label="Layout spacing multiplier"
            className="w-full accent-blue-700 cursor-pointer"
          />
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
