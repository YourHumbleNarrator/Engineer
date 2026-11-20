import React, { useState } from 'react';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import { GraphKind } from '../types/processMining';
import { previewCsvHeaders } from '../utils/logParser';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOutput: GraphKind;
  onSubmitFile: (options: {
    file: File;
    uploadType: 'event_log' | 'graph_file';
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
  onSubmitFile,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<'event_log' | 'graph_file'>('event_log');
  const [algorithm, setAlgorithm] = useState<'alpha' | 'inductive' | 'heuristics'>('inductive');
  const [caseIdCol, setCaseIdCol] = useState('case:concept:name');
  const [activityCol, setActivityCol] = useState('concept:name');
  const [timestampCol, setTimestampCol] = useState('time:timestamp');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileSelect = async (selected: File | null) => {
    setFile(selected);
    setError(null);
    setCsvHeaders([]);
    if (!selected) return;

    const ext = selected.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xes' || ext === 'csv') {
      setUploadType('event_log');
      if (ext === 'csv') {
        const text = await selected.slice(0, 8192).text();
        const preview = previewCsvHeaders(text);
        setCsvHeaders(preview.headers);
        const lower = preview.headers.map((h) => h.toLowerCase());
        const findMatch = (candidates: string[]) => {
          for (const c of candidates) {
            const idx = lower.indexOf(c);
            if (idx >= 0) return preview.headers[idx];
          }
          return null;
        };
        const cMatch = findMatch(['case:concept:name', 'case_id', 'caseid', 'case']);
        const aMatch = findMatch(['concept:name', 'activity', 'event', 'task']);
        const tMatch = findMatch(['time:timestamp', 'timestamp', 'time', 'date']);
        if (cMatch) setCaseIdCol(cMatch);
        if (aMatch) setActivityCol(aMatch);
        if (tMatch) setTimestampCol(tMatch);
      }
    } else {
      setUploadType('graph_file');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmitFile({
        file,
        uploadType,
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
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Upload Event Log or Graph File
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* File Dropzone */}
          <label className="flex flex-col items-center justify-center gap-2 p-6 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950/50 hover:border-blue-600 transition-colors cursor-pointer text-center">
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
                  Choose a log or graph file to import
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Event logs: .xes, .csv · Graphs: .gml, .graphml, .gexf, .net, .yaml, .txt, .json
                </div>
              </>
            )}
            <input
              type="file"
              accept=".xes,.csv,.gml,.graphml,.gexf,.net,.yaml,.yml,.txt,.json"
              className="sr-only"
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            />
          </label>

          {/* Upload Mode Switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setUploadType('event_log')}
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                uploadType === 'event_log'
                  ? 'border-blue-700 bg-blue-50/70 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              Event Log Discovery
            </button>
            <button
              type="button"
              onClick={() => setUploadType('graph_file')}
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                uploadType === 'graph_file'
                  ? 'border-blue-700 bg-blue-50/70 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              Graph Format Conversion
            </button>
          </div>

          {uploadType === 'event_log' && (
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

              {(csvHeaders.length > 0 || file?.name.toLowerCase().endsWith('.csv')) && (
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

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Processing…' : 'Import & Visualize'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
