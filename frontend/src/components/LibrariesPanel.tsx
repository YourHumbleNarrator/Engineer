import React, { useMemo, useState } from 'react';
import { Play, Search, Terminal, X, Download } from 'lucide-react';
import {
  PMFunctionExecutionResult,
  PMLibraryFunction,
} from '../types/processMining';

interface LibrariesPanelProps {
  functions: PMLibraryFunction[];
  onExecuteFunction: (fn: PMLibraryFunction) => Promise<void>;
  executingFn: string | null;
  lastResult: PMFunctionExecutionResult | null;
  onClearResult: () => void;
}

type LibFilter = 'all' | 'pm4py' | 'pm4js' | 'bupar' | 'bpmn-js';

export const LibrariesPanel: React.FC<LibrariesPanelProps> = ({
  functions,
  onExecuteFunction,
  executingFn,
  lastResult,
  onClearResult,
}) => {
  const [libFilter, setLibFilter] = useState<LibFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(functions.map((f) => f.category)))],
    [functions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return functions.filter((f) => {
      if (libFilter !== 'all' && f.module !== libFilter) return false;
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (
        q &&
        !f.name.toLowerCase().includes(q) &&
        !f.description.toLowerCase().includes(q) &&
        !f.pm4py_function.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [functions, libFilter, categoryFilter, query]);

  return (
    <div className="flex flex-col h-full">
      {/* Controls Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Terminal className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
            Process Mining Libraries
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500">
            {filtered.length} functions
          </span>
        </div>

        {/* Library Segmented Filter */}
        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
          {(['all', 'pm4py', 'pm4js', 'bupar', 'bpmn-js'] as LibFilter[]).map((lib) => (
            <button
              key={lib}
              type="button"
              onClick={() => setLibFilter(lib)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                libFilter === lib
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {lib === 'all' ? 'All' : lib === 'bupar' ? 'bupaR' : lib}
            </button>
          ))}
        </div>

        {/* Search + Category */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search functions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by function category"
            className="px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All Categories' : c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Native Output Drawer (when a function has been invoked) */}
      {lastResult && (
        <div className="p-3.5 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="min-w-0">
              <div className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                {lastResult.module} · Native Output
              </div>
              <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                {lastResult.functionName}
              </div>
            </div>
            <button
              type="button"
              onClick={onClearResult}
              aria-label="Close output"
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {lastResult.image_base64 && (
            <div className="space-y-2">
              <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white p-2 overflow-auto max-h-64">
                <img
                  src={`data:image/png;base64,${lastResult.image_base64}`}
                  alt={`Native output from ${lastResult.functionName}`}
                  className="max-w-full h-auto mx-auto"
                />
              </div>
              <a
                href={`data:image/png;base64,${lastResult.image_base64}`}
                download={`${lastResult.functionName}.png`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Save Native PNG
              </a>
            </div>
          )}

          {lastResult.message && (
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mb-2">
              {lastResult.message}
            </p>
          )}

          {lastResult.result !== undefined && (
            <pre className="p-2.5 rounded-md bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-800 dark:text-slate-200 overflow-auto max-h-48 whitespace-pre-wrap">
              {typeof lastResult.result === 'string'
                ? lastResult.result
                : JSON.stringify(lastResult.result, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Function List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
        {filtered.map((fn) => {
          const isRunning = executingFn === fn.name;
          return (
            <div key={`${fn.module}-${fn.name}`} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    {fn.module === 'bupar' ? 'bupaR' : fn.module}
                  </div>
                  <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5 break-all">
                    {fn.name}
                  </div>
                </div>

                {fn.executable && (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => onExecuteFunction(fn)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3 h-3" />
                    {isRunning ? 'Running…' : 'Call'}
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {fn.description}
              </p>

              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 space-y-0.5 pt-1">
                <div className="truncate">
                  <span className="text-slate-400">fn:</span> {fn.pm4py_function}
                </div>
                <div className="truncate">
                  <span className="text-slate-400">returns:</span> {fn.returns}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
