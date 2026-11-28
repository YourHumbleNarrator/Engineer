import React, { useRef, useState } from 'react';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import { DFGGraph, GraphKind } from '../types/processMining';
import { parseDotToDfg, parseMermaidToDfg } from '../utils/dfgNotations';
import {
  isCsvEdgeListHeaders,
  isNativeGraphObject,
  isYamlEventLog,
  parseGraphFileClient,
  previewCsvHeaders,
} from '../utils/logParser';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOutput: GraphKind;
  onImportDfg: (dfg: DFGGraph, sourceLabel: string) => void;
  onSubmitFile: (options: {
    file: File;
    isEdgeListCsv: boolean;
    algorithm: 'alpha' | 'inductive' | 'heuristics';
    output: GraphKind;
    caseIdCol: string;
    activityCol: string;
    timestampCol: string;
    useR: boolean;
  }) => Promise<void>;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  defaultOutput,
  onImportDfg,
  onSubmitFile,
}) => {
  const [mode, setMode] = useState<'event_log' | 'dfg'>('event_log');

  // Shared File State
  const [file, setFile] = useState<File | null>(null);
  const [isEdgeListCsv, setIsEdgeListCsv] = useState(false);
  const [isYamlLog, setIsYamlLog] = useState(false);

  // Event Log Discovery options
  const [algorithm, setAlgorithm] = useState<'alpha' | 'inductive' | 'heuristics'>('inductive');
  const [caseIdCol, setCaseIdCol] = useState('case:concept:name');
  const [activityCol, setActivityCol] = useState('concept:name');
  const [timestampCol, setTimestampCol] = useState('time:timestamp');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // DFG Code Window State (always auto-detected)
  const [dfgCode, setDfgCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLTextAreaElement | null>(null);

  if (!isOpen) return null;

  const ext = file?.name.split('.').pop()?.toLowerCase() || '';
  const isEventLogFile =
    !file ||
    ext === 'xes' ||
    (ext === 'csv' && !isEdgeListCsv) ||
    ((ext === 'yaml' || ext === 'yml') && isYamlLog);

  const handleUnifiedFileSelect = async (selected: File | null) => {
    setFile(selected);
    setError(null);
    setCsvHeaders([]);
    setIsEdgeListCsv(false);
    setIsYamlLog(false);
    if (!selected) return;

    const selectedExt = selected.name.split('.').pop()?.toLowerCase() || '';
    if (selectedExt === 'csv') {
      const text = await selected.slice(0, 8192).text();
      const preview = previewCsvHeaders(text);
      setCsvHeaders(preview.headers);
      const edgeList = isCsvEdgeListHeaders(preview.headers);
      setIsEdgeListCsv(edgeList);
      if (edgeList) {
        const fullText = selected.size <= 5 * 1024 * 1024 ? await selected.text() : text;
        setDfgCode(fullText);
        setMode('dfg');
      } else {
        setMode('event_log');
        const lower = preview.headers.map((h) => h.toLowerCase());
        const findMatch = (candidates: string[]) => {
          for (const c of candidates) {
            const idx = lower.indexOf(c);
            if (idx >= 0) return preview.headers[idx];
          }
          return null;
        };
        const cMatch = findMatch(['case:concept:name', 'case_id', 'caseid', 'case', 'trace_id']);
        const aMatch = findMatch(['concept:name', 'activity', 'event', 'task', 'action']);
        const tMatch = findMatch(['time:timestamp', 'timestamp', 'time', 'date', 'start_time']);
        if (cMatch) setCaseIdCol(cMatch);
        if (aMatch) setActivityCol(aMatch);
        if (tMatch) setTimestampCol(tMatch);
      }
      return;
    }

    if (selectedExt === 'xes') {
      setMode('event_log');
      return;
    }

    // DFG & graph formats automatically load into the DFG tab / code window
    const dfgTextExts = [
      'dot',
      'gv',
      'mmd',
      'mermaid',
      'gml',
      'graphml',
      'yaml',
      'yml',
      'txt',
      'json',
    ];
    if (dfgTextExts.includes(selectedExt)) {
      const text = await selected.text();
      if (selectedExt === 'json') {
        try {
          const parsed = JSON.parse(text);
          if (isNativeGraphObject(parsed) && parsed.kind !== 'dfg') {
            setMode('event_log');
            return;
          }
        } catch {
          // Keep as DFG/graph JSON text
        }
      }
      if (selectedExt === 'yaml' || selectedExt === 'yml') {
        if (isYamlEventLog(text)) {
          setIsYamlLog(true);
          setMode('event_log');
          return;
        }
      }
      setDfgCode(text);
      setMode('dfg');
    }
  };

  const parseDfgAuto = (raw: string, filename?: string): DFGGraph => {
    const trimmed = raw.trim();
    const fExt = filename?.split('.').pop()?.toLowerCase() || '';

    if (fExt === 'dot' || fExt === 'gv' || /^\s*(?:di)?graph\b/i.test(trimmed)) {
      return parseDotToDfg(trimmed, filename || 'dfg.dot');
    }
    if (
      fExt === 'mmd' ||
      fExt === 'mermaid' ||
      /^\s*(?:flowchart|graph)\s+(?:LR|TD|TB|RL)/im.test(trimmed)
    ) {
      return parseMermaidToDfg(trimmed, filename || 'dfg.mmd');
    }
    if (fExt === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = parseGraphFileClient(trimmed, filename || 'dfg.json');
      if (parsed.kind !== 'dfg') throw new Error('JSON must represent a DFG graph.');
      return parsed;
    }
    if (fExt === 'graphml' || trimmed.startsWith('<')) {
      const parsed = parseGraphFileClient(trimmed, filename || 'dfg.graphml');
      if (parsed.kind !== 'dfg') throw new Error('XML was not recognized as GraphML.');
      return parsed;
    }
    if (fExt === 'gml' || /^\s*graph\s*\[/i.test(trimmed)) {
      const parsed = parseGraphFileClient(trimmed, filename || 'dfg.gml');
      if (parsed.kind !== 'dfg') throw new Error('Could not parse GML.');
      return parsed;
    }
    if (
      fExt === 'yaml' ||
      fExt === 'yml' ||
      /^\s*(?:---|log\s*:|xes:log\s*:|traces\s*:|events\s*:|graph\s*:|dfg\s*:|activities\s*:|vertices\s*:|nodes\s*:|edges\s*:|links\s*:|arcs\s*:)/im.test(
        trimmed
      )
    ) {
      const parsed = parseGraphFileClient(trimmed, filename || 'dfg.yaml');
      if (parsed.kind !== 'dfg') throw new Error('Could not parse YAML.');
      return parsed;
    }

    const parsed = parseGraphFileClient(trimmed, filename || 'dfg.csv');
    if (parsed.kind !== 'dfg') throw new Error('Could not recognize DFG format.');
    return parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'dfg') {
      const trimmed = dfgCode.trim();
      if (!trimmed && !file) {
        setError('Upload a DFG file or paste DFG notation code.');
        return;
      }
      if (trimmed) {
        try {
          const graph = parseDfgAuto(trimmed, file?.name);
          onImportDfg(graph, file?.name || graph.name);
          onClose();
          return;
        } catch (err) {
          const fExt = file?.name.split('.').pop()?.toLowerCase() || '';
          const looksLikeYamlEventLog =
            (fExt === 'yaml' || fExt === 'yml') &&
            /(?:^|\s)(?:log|trace|traces|event|events|concept:name|concept:instance|time:timestamp)\s*:/im.test(
              trimmed
            );
          // If it's a non-text/binary or backend graph format (like .gexf, .net, .pajek), let submitFile convert it
          if (!file || looksLikeYamlEventLog) {
            setError(
              looksLikeYamlEventLog
                ? 'Could not extract event traces from this YAML log.'
                : err instanceof Error
                ? err.message
                : 'Failed to parse DFG notation.'
            );
            return;
          }
        }
      }
    }

    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitFile({
        file,
        isEdgeListCsv,
        algorithm,
        output: defaultOutput,
        caseIdCol,
        activityCol,
        timestampCol,
        useR: true,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Upload
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload dialog"
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs: Event Log | DFG */}
        <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMode('event_log');
              setError(null);
            }}
            className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              mode === 'event_log'
                ? 'border-blue-700 text-blue-700 dark:border-blue-500 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            Event Log
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('dfg');
              setError(null);
            }}
            className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              mode === 'dfg'
                ? 'border-blue-700 text-blue-700 dark:border-blue-500 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            DFG
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Unified File Dropzone */}
          <label className="flex flex-col items-center justify-center gap-2 p-5 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950/50 hover:border-blue-600 transition-colors cursor-pointer text-center">
            <Upload className="w-6 h-6 text-slate-400" />
            {file ? (
              <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-slate-100">
                <FileText className="w-4 h-4 text-blue-700" />
                <span>{file.name}</span>
                <span className="text-slate-500 font-mono">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {mode === 'event_log'
                    ? 'Choose an event log or graph file to import'
                    : 'Choose a DFG file or paste notation code below'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  .xes, .csv, .gml, .graphml, .gexf, .net, .pajek, .yaml, .txt, .json, .dot, .mmd, .pnml, .bpmn
                </div>
              </>
            )}
            <input
              type="file"
              accept=".xes,.csv,.gml,.graphml,.gexf,.net,.pajek,.yaml,.yml,.txt,.json,.dot,.gv,.mmd,.mermaid,.pnml,.bpmn"
              className="sr-only"
              onChange={(e) => handleUnifiedFileSelect(e.target.files?.[0] || null)}
            />
          </label>

          {mode === 'event_log' ? (
            <>
              {file && !isEventLogFile && (
                <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 text-[11px] text-slate-600 dark:text-slate-300">
                  {isEdgeListCsv
                    ? 'Edge-list CSV detected — it will be converted automatically.'
                    : `Format .${ext} does not match an event log — it will be converted automatically.`}
                </div>
              )}

              {isEventLogFile && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Discovery Miner
                    </label>
                    <select
                      value={algorithm}
                      onChange={(e) =>
                        setAlgorithm(e.target.value as 'alpha' | 'inductive' | 'heuristics')
                      }
                      className="w-full px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="inductive">Inductive Miner</option>
                      <option value="heuristics">Heuristics Miner</option>
                      <option value="alpha">Alpha Miner</option>
                    </select>
                  </div>

                  {(csvHeaders.length > 0 || (file && ext === 'csv' && !isEdgeListCsv)) && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Case ID Column
                        </label>
                        <input
                          type="text"
                          value={caseIdCol}
                          onChange={(e) => setCaseIdCol(e.target.value)}
                          list="csv-headers-list"
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Activity Column
                        </label>
                        <input
                          type="text"
                          value={activityCol}
                          onChange={(e) => setActivityCol(e.target.value)}
                          list="csv-headers-list"
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Timestamp Column
                        </label>
                        <input
                          type="text"
                          value={timestampCol}
                          onChange={(e) => setTimestampCol(e.target.value)}
                          list="csv-headers-list"
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <datalist id="csv-headers-list">
                        {csvHeaders.map((h) => (
                          <option key={h} value={h} />
                        ))}
                      </datalist>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                DFG Code
              </label>
              <textarea
                ref={codeInputRef}
                value={dfgCode}
                onChange={(e) => setDfgCode(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.select();
                  }
                }}
                rows={8}
                spellCheck={false}
                placeholder={
                  'digraph "Order" {\n  "Receive" -> "Check" [label="120"];\n  "Check" -> "Ship" [label="95"];\n}'
                }
                className="w-full p-3 text-xs font-mono rounded-lg border border-slate-700 bg-black text-white placeholder:text-slate-400 select-text focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={(mode === 'event_log' ? !file : !dfgCode.trim() && !file) || isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors"
            >
              {isSubmitting
                ? 'Processing…'
                : mode === 'event_log'
                ? 'Event Log Discovery'
                : 'Load DFG'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
