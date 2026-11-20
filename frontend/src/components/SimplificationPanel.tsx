import React, { useEffect, useMemo, useState } from 'react';
import {
  GraphObject,
  ProcessTreeNode,
  SimplificationAlgorithm,
} from '../types/processMining';
import {
  applyGraphFilters,
  computeGraphStats,
  GraphFilterOptions,
  simplifyGraphClient,
} from '../utils/simplifier';

interface SimplificationPanelProps {
  originalGraph: GraphObject;
  currentGraph: GraphObject;
  onApplySimplification: (
    algorithm: SimplificationAlgorithm,
    threshold: number,
    params: Record<string, unknown>
  ) => Promise<void> | void;
  onApplyFilters: (filtered: GraphObject) => void;
  onReset: () => void;
  isBusy: boolean;
}

const SIMPLIFICATION_ALGORITHMS: Array<{
  id: SimplificationAlgorithm;
  name: string;
  description: string;
}> = [
  {
    id: 'filter_dfg',
    name: 'DFG Edge Frequency Simplification',
    description:
      'Prunes infrequent edges below a percentage of max edge count and removes orphaned activities.',
  },
  {
    id: 'abstraction',
    name: 'Activity Abstraction',
    description:
      'Clusters rare activities below the frequency percentile cutoff into a single abstract node or removes them.',
  },
  {
    id: 'merge_parallel',
    name: 'Parallel Branch Merging',
    description:
      'Detects reciprocal/concurrent activity pairs above an overlap ratio and collapses them into AND-block nodes.',
  },
];

export const SimplificationPanel: React.FC<SimplificationPanelProps> = ({
  originalGraph,
  currentGraph,
  onApplySimplification,
  onApplyFilters,
  onReset,
  isBusy,
}) => {
  // Simplification state
  const [algorithm, setAlgorithm] = useState<SimplificationAlgorithm>('filter_dfg');
  const [simpThreshold, setSimpThreshold] = useState<number>(0.2);
  const [absoluteMin, setAbsoluteMin] = useState<string>('');
  const [abstractLabel, setAbstractLabel] = useState<string>('OTHER');
  const [abstractStrategy, setAbstractStrategy] = useState<'merge' | 'remove'>('merge');

  // Frequency & Attribute Filtering state
  const [edgeFrequencyPct, setEdgeFrequencyPct] = useState<number>(0);
  const [minNodeFrequency, setMinNodeFrequency] = useState<number>(0);
  const [attributeMode, setAttributeMode] = useState<'include' | 'exclude'>('exclude');
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [selectedLanes, setSelectedLanes] = useState<string[]>([]);
  const [includeSilent, setIncludeSilent] = useState<boolean>(true);
  const [activitySearch, setActivitySearch] = useState<string>('');

  useEffect(() => {
    setEdgeFrequencyPct(0);
    setMinNodeFrequency(0);
    setAttributeMode('exclude');
    setSelectedActivities([]);
    setSelectedLanes([]);
    setIncludeSilent(true);
    setActivitySearch('');
    setSimpThreshold(0.2);
    setAbsoluteMin('');
  }, [originalGraph.id]);

  const isDfg = originalGraph.kind === 'dfg';

  const simpParams = useMemo(() => {
    if (algorithm === 'filter_dfg') {
      const parsed = parseInt(absoluteMin, 10);
      return !Number.isNaN(parsed) && parsed > 0 ? { absolute_threshold: parsed } : {};
    }
    if (algorithm === 'abstraction') {
      return { label: abstractLabel, strategy: abstractStrategy };
    }
    return { max_merge_size: 3 };
  }, [algorithm, absoluteMin, abstractLabel, abstractStrategy]);

  const simpPreviewStats = useMemo(() => {
    const simulated = simplifyGraphClient(originalGraph, algorithm, simpThreshold, simpParams);
    return computeGraphStats(simulated);
  }, [originalGraph, algorithm, simpThreshold, simpParams]);

  // Extract filterable activities, max frequency, and lanes across any graph kind
  const { activityItems, maxNodeFreq, lanes } = useMemo(() => {
    const actMap = new Map<string, number>();
    const laneList: Array<{ id: string; label: string }> = [];

    if (originalGraph.kind === 'dfg') {
      originalGraph.activities.forEach((a) => actMap.set(a.label, a.count));
    } else if (originalGraph.kind === 'petri_net') {
      originalGraph.transitions.forEach((t) => {
        if (!t.silent) actMap.set(t.label, t.frequency ?? 0);
      });
    } else if (originalGraph.kind === 'process_tree') {
      const walk = (n: ProcessTreeNode) => {
        if (n.type === 'activity' && n.label) {
          actMap.set(n.label, Math.max(actMap.get(n.label) || 0, n.frequency ?? 0));
        }
        n.children.forEach(walk);
      };
      walk(originalGraph.root);
    } else if (originalGraph.kind === 'bpmn') {
      originalGraph.nodes.forEach((n) => {
        if (n.type === 'task' && n.label) actMap.set(n.label, 0);
      });
      originalGraph.lanes.forEach((l) => laneList.push({ id: l.id, label: l.label }));
    }

    const items = Array.from(actMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const maxFreq = Math.max(...items.map((i) => i.count), 0);
    return { activityItems: items, maxNodeFreq: maxFreq, lanes: laneList };
  }, [originalGraph]);

  const filterOptions: GraphFilterOptions = useMemo(
    () => ({
      edgeFrequencyPct,
      minNodeFrequency,
      attributeMode,
      selectedActivities,
      selectedLanes,
      includeSilent,
    }),
    [
      edgeFrequencyPct,
      minNodeFrequency,
      attributeMode,
      selectedActivities,
      selectedLanes,
      includeSilent,
    ]
  );

  const filteredPreviewGraph = useMemo(
    () => applyGraphFilters(originalGraph, filterOptions),
    [originalGraph, filterOptions]
  );

  const originalStats = useMemo(() => computeGraphStats(originalGraph), [originalGraph]);
  const filterPreviewStats = useMemo(
    () => computeGraphStats(filteredPreviewGraph),
    [filteredPreviewGraph]
  );

  const filteredActivityList = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return activityItems.filter((a) => !q || a.label.toLowerCase().includes(q));
  }, [activityItems, activitySearch]);

  const toggleActivity = (label: string) => {
    setSelectedActivities((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    );
  };

  const toggleLane = (laneId: string) => {
    setSelectedLanes((prev) =>
      prev.includes(laneId) ? prev.filter((x) => x !== laneId) : [...prev, laneId]
    );
  };

  const handleResetAll = () => {
    setEdgeFrequencyPct(0);
    setMinNodeFrequency(0);
    setAttributeMode('exclude');
    setSelectedActivities([]);
    setSelectedLanes([]);
    setIncludeSilent(true);
    setSimpThreshold(0.2);
    setAbsoluteMin('');
    onReset();
  };

  const isModified = currentGraph !== originalGraph;

  return (
    <div className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
      {/* ── Module 1: Graph Simplification ───────────────────────────────────── */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white">
            Graph Simplification
          </h3>
          {isModified && (
            <button
              type="button"
              onClick={handleResetAll}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              Restore Original
            </button>
          )}
        </div>

        {!isDfg && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-lg p-2.5 leading-relaxed">
            DFG simplification algorithms (abstraction and parallel merging) apply to Directly-Follows Graphs. Use Frequency and Attribute Filtering below for {originalGraph.kind.replace('_', ' ')} models.
          </p>
        )}

        <div className="space-y-1.5">
          {SIMPLIFICATION_ALGORITHMS.map((alg) => (
            <button
              key={alg.id}
              type="button"
              onClick={() => setAlgorithm(alg.id)}
              disabled={!isDfg}
              className={`w-full text-left p-2.5 rounded-lg border transition-colors disabled:opacity-50 ${
                algorithm === alg.id
                  ? 'border-blue-700 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {alg.name}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {alg.description}
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-2.5 pt-1">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {algorithm === 'filter_dfg'
                  ? 'Relative Edge Cutoff'
                  : algorithm === 'abstraction'
                  ? 'Frequency Percentile Cutoff'
                  : 'Concurrent Overlap Ratio'}
              </span>
              <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                {Math.round(simpThreshold * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={simpThreshold}
              onChange={(e) => setSimpThreshold(parseFloat(e.target.value))}
              className="w-full accent-blue-700 cursor-pointer"
              disabled={!isDfg}
            />
          </div>

          {algorithm === 'filter_dfg' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Absolute Min Edge Count (optional)
              </label>
              <input
                type="number"
                min={0}
                placeholder="e.g. 150"
                value={absoluteMin}
                onChange={(e) => setAbsoluteMin(e.target.value)}
                disabled={!isDfg}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {algorithm === 'abstraction' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Cluster Label
                </label>
                <input
                  type="text"
                  value={abstractLabel}
                  onChange={(e) => setAbstractLabel(e.target.value)}
                  disabled={!isDfg}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Strategy
                </label>
                <select
                  value={abstractStrategy}
                  onChange={(e) => setAbstractStrategy(e.target.value as 'merge' | 'remove')}
                  disabled={!isDfg}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="merge">Merge Node</option>
                  <option value="remove">Remove Rare</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>Simplified Structure</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {simpPreviewStats.nodeCount}/{originalStats.nodeCount} nodes ·{' '}
              {simpPreviewStats.edgeCount}/{originalStats.edgeCount} edges
            </span>
          </div>
          <button
            type="button"
            disabled={!isDfg || isBusy}
            onClick={() => onApplySimplification(algorithm, simpThreshold, simpParams)}
            className="w-full px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors"
          >
            {isBusy ? 'Simplifying…' : 'Apply Simplification'}
          </button>
        </div>
      </section>

      {/* ── Module 2: Frequency Filtering ────────────────────────────────────── */}
      <section className="p-4 space-y-3.5">
        <div className="pb-1.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white">
            Frequency Filtering
          </h3>
        </div>

        {isDfg && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Min Edge Frequency
              </span>
              <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                {Math.round(edgeFrequencyPct * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={edgeFrequencyPct}
              onChange={(e) => setEdgeFrequencyPct(parseFloat(e.target.value))}
              className="w-full accent-blue-700 cursor-pointer"
            />
          </div>
        )}

        {maxNodeFreq > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Min Activity Count
              </span>
              <span className="font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                {minNodeFrequency.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxNodeFreq}
              step={Math.max(1, Math.floor(maxNodeFreq / 25))}
              value={minNodeFrequency}
              onChange={(e) => setMinNodeFrequency(parseInt(e.target.value, 10))}
              className="w-full accent-blue-700 cursor-pointer"
            />
          </div>
        )}

        {maxNodeFreq === 0 && originalGraph.kind === 'bpmn' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Use Attribute Filtering below to filter BPMN tasks and swimlanes.
          </p>
        )}
      </section>

      {/* ── Module 3: Attribute Filtering ────────────────────────────────────── */}
      <section className="p-4 space-y-3">
        <div className="pb-1.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900 dark:text-white">
            Attribute Filtering
          </h3>
        </div>

        {lanes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Swimlane / Resource
            </div>
            <div className="space-y-1">
              {lanes.map((lane) => {
                const checked = selectedLanes.includes(lane.id);
                return (
                  <label
                    key={lane.id}
                    className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLane(lane.id)}
                      className="rounded border-slate-300 accent-blue-700"
                    />
                    <span className="truncate">{lane.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {(originalGraph.kind === 'petri_net' || originalGraph.kind === 'process_tree') && (
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSilent}
              onChange={(e) => setIncludeSilent(e.target.checked)}
              className="rounded border-slate-300 accent-blue-700"
            />
            <span>Include Silent Nodes (τ)</span>
          </label>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Activity Name
            </span>
            <div className="inline-flex p-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setAttributeMode('exclude')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                  attributeMode === 'exclude'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Exclude
              </button>
              <button
                type="button"
                onClick={() => setAttributeMode('include')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                  attributeMode === 'include'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Include Only
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="Search activity..."
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
            {filteredActivityList.map((act) => {
              const checked = selectedActivities.includes(act.label);
              return (
                <label
                  key={act.label}
                  className="flex items-center justify-between py-1.5 text-xs cursor-pointer gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleActivity(act.label)}
                      className="rounded border-slate-300 accent-blue-700 shrink-0"
                    />
                    <span className="text-slate-700 dark:text-slate-300 truncate">
                      {act.label}
                    </span>
                  </span>
                  {act.count > 0 && (
                    <span className="font-mono tabular-nums font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      {act.count.toLocaleString()}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>Filtered Structure</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {filterPreviewStats.nodeCount}/{originalStats.nodeCount} nodes ·{' '}
              {filterPreviewStats.edgeCount}/{originalStats.edgeCount} edges
            </span>
          </div>
          <button
            type="button"
            disabled={filterPreviewStats.nodeCount === 0}
            onClick={() => onApplyFilters(filteredPreviewGraph)}
            className="w-full px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </section>
    </div>
  );
};
