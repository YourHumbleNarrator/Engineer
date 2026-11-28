import React, { useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { DFGGraph } from '../types/processMining';
import {
  DFG_NOTATION_FORMATS,
  DfgNotationFormat,
  serializeDfgToNotation,
} from '../utils/dfgNotations';

interface DfgNotationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeDfg: DFGGraph | null;
}

export const DfgNotationsModal: React.FC<DfgNotationsModalProps> = ({
  isOpen,
  onClose,
  activeDfg,
}) => {
  const [writeFormat, setWriteFormat] = useState<DfgNotationFormat>('dot');
  const codeAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const serialized = useMemo(() => {
    if (!activeDfg) return '';
    return serializeDfgToNotation(activeDfg, writeFormat);
  }, [activeDfg, writeFormat]);

  if (!isOpen || !activeDfg) return null;

  const selectedMeta =
    DFG_NOTATION_FORMATS.find((f) => f.id === writeFormat) || DFG_NOTATION_FORMATS[0];

  const handleDownload = () => {
    if (!serialized || !activeDfg) return;
    const blob = new Blob([serialized], {
      type: `${selectedMeta.mimeType};charset=utf-8`,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = activeDfg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.download = `${base}.${selectedMeta.extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleModalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      codeAreaRef.current?.focus();
      codeAreaRef.current?.select();
    }
  };

  return (
    <div
      onKeyDown={handleModalKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Download DFG
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Download DFG dialog"
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {DFG_NOTATION_FORMATS.map((fmt) => (
              <div key={fmt.id} className="relative group">
                <button
                  type="button"
                  title={fmt.readSupported}
                  onClick={() => setWriteFormat(fmt.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    writeFormat === fmt.id
                      ? 'border-blue-700 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-500'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {fmt.label} (.{fmt.extension})
                </button>
                <div className="pointer-events-none absolute left-0 top-full mt-1.5 z-30 w-60 rounded-md bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  {fmt.readSupported}
                </div>
              </div>
            ))}
          </div>

          <textarea
            ref={codeAreaRef}
            readOnly
            value={serialized}
            rows={13}
            spellCheck={false}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.select();
              }
            }}
            aria-label="Generated DFG code"
            className="w-full p-3 rounded-lg bg-slate-950 text-slate-100 text-[11px] font-mono border border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
          />

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Download .{selectedMeta.extension}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
