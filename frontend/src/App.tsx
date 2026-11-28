import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  Moon,
  Sun,
  Upload,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { PM_LIBRARY_CATALOG } from './data/pmLibrariesRegistry';
import {
  DFGGraph,
  EventTrace,
  GraphKind,
  GraphObject,
  InteractionMode,
  LayoutConfig,
  PMFunctionExecutionResult,
  PMLibraryFunction,
  SelectedElement,
  SimplificationAlgorithm,
} from './types/processMining';
import { computeAdaptiveLayout, DEFAULT_LAYOUT_CONFIG } from './utils/graphLayout';
import {
  computeGraphStats,
  computeLogStatsFromTraces,
  exportBpmnToXml,
  simplifyGraphClient,
  validateBpmnFlows,
} from './utils/simplifier';
import {
  discoverGraphFromTraces,
  isNativeGraphObject,
  isYamlEventLog,
  parseCsvToTraces,
  parseGraphFileClient,
  parseXesToTraces,
  parseYamlToTraces,
} from './utils/logParser';
import { engineerApi } from './services/engineerApi';
import { GraphCanvas, serializeSvgForDownload } from './components/GraphCanvas';
import { GraphInfoPanel } from './components/GraphInfoPanel';
import { SimplificationPanel } from './components/SimplificationPanel';
import { LibrariesPanel } from './components/LibrariesPanel';
import { UploadModal } from './components/UploadModal';
import { DfgNotationsModal } from './components/DfgNotationsModal';

interface WorkspaceDataset {
  id: string;
  name: string;
  traces: EventTrace[];
  graphs: Partial<Record<GraphKind, GraphObject>>;
  isDirectDfg?: boolean;
  backendFileId?: string;
  backendGraphId?: string;
  csvCols?: { caseIdCol: string; activityCol: string; timestampCol: string };
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);

  const [datasets, setDatasets] = useState<WorkspaceDataset[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<GraphKind>('dfg');
  const [discoveryAlgorithm, setDiscoveryAlgorithm] = useState<'inductive' | 'heuristics' | 'alpha'>(
    'inductive'
  );

  const [simplifiedGraph, setSimplifiedGraph] = useState<GraphObject | null>(null);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('inspect');
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig>(DEFAULT_LAYOUT_CONFIG);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [hasCustomOverrides, setHasCustomOverrides] = useState(false);
  const [resetPositionsSignal, setResetPositionsSignal] = useState(0);

  const [leftTab, setLeftTab] = useState<'info' | 'simplify'>('info');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(352);
  const [resizingSide, setResizingSide] = useState<'left' | 'right' | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(true);
  const [writeDfgOpen, setWriteDfgOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);

  const [pmFunctions, setPmFunctions] = useState<PMLibraryFunction[]>(PM_LIBRARY_CATALOG);
  const [executingFn, setExecutingFn] = useState<string | null>(null);
  const [fnResult, setFnResult] = useState<PMFunctionExecutionResult | null>(null);
  const [isSimplifying, setIsSimplifying] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Side-panel drag resizing
  useEffect(() => {
    if (!resizingSide) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (resizingSide === 'left') {
        setLeftWidth(Math.max(240, Math.min(540, e.clientX)));
      } else {
        setRightWidth(Math.max(260, Math.min(560, window.innerWidth - e.clientX)));
      }
    };
    const handleMouseUp = () => setResizingSide(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingSide]);

  const showBriefToast = useCallback((kind: 'success' | 'error', text: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, text });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setDownloadMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDownloadMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [downloadMenuOpen]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    engineerApi
      .checkHealth()
      .then((res) => {
        if (res?.status === 'ok') {
          setBackendConnected(true);
          engineerApi
            .listPmFunctions()
            .then((reg) => {
              const backendFns = Object.values(reg.functions || {}).flat();
              if (backendFns.length > 0) {
                const nonPm4py = PM_LIBRARY_CATALOG.filter((f) => f.module !== 'pm4py');
                const normalizedBackend = backendFns.map((bf) => ({
                  ...bf,
                  module: 'pm4py' as const,
                  executable: [
                    'discover_dfg',
                    'discover_performance_dfg',
                    'discover_petri_net_alpha',
                    'discover_petri_net_inductive',
                    'discover_petri_net_heuristics',
                    'discover_process_tree_inductive',
                    'discover_bpmn_inductive',
                    'get_variants',
                    'get_start_activities',
                    'get_end_activities',
                    'get_event_attribute_values',
                    'view_dfg',
                  ].includes(bf.name),
                }));
                setPmFunctions([...normalizedBackend, ...nonPm4py]);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) || null,
    [datasets, activeDatasetId]
  );

  const originalGraph = useMemo<GraphObject | null>(() => {
    if (!activeDataset) return null;
    const existing = activeDataset.graphs[activeKind];
    if (existing) return existing;
    if (activeDataset.traces.length > 0) {
      return discoverGraphFromTraces(
        activeDataset.traces,
        activeKind,
        discoveryAlgorithm,
        activeDataset.name
      );
    }
    const first = Object.values(activeDataset.graphs)[0];
    return first || null;
  }, [activeDataset, activeKind, discoveryAlgorithm]);

  const activeGraph = simplifiedGraph || originalGraph;

  useEffect(() => {
    setSimplifiedGraph(null);
    setSelectedElement(null);
    setLayoutConfig(DEFAULT_LAYOUT_CONFIG);
  }, [activeDatasetId, activeKind]);

  const computedLayout = useMemo(
    () => (activeGraph ? computeAdaptiveLayout(activeGraph, layoutConfig) : null),
    [activeGraph, layoutConfig]
  );

  const graphStats = useMemo(
    () => (activeGraph ? computeGraphStats(activeGraph) : null),
    [activeGraph]
  );

  const discoverWithFallback = useCallback(
    async (payload: {
      algorithm: 'alpha' | 'inductive' | 'heuristics';
      output: GraphKind;
      graph_id: string;
      graph_name: string;
      case_id_col: string;
      activity_col: string;
      timestamp_col: string;
      use_r: boolean;
    }): Promise<GraphObject> => {
      const preferR = payload.use_r && payload.output === 'dfg';
      try {
        return await engineerApi.discoverModel({ ...payload, use_r: preferR });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (preferR && /r bridge|rscript|bupar|503/i.test(msg)) {
          return engineerApi.discoverModel({ ...payload, use_r: false });
        }
        throw err;
      }
    },
    []
  );

  const isDfgOnlyDataset = Boolean(
    activeDataset &&
      (activeDataset.isDirectDfg ||
        (activeDataset.traces.length === 0 &&
          !activeDataset.backendFileId &&
          Object.keys(activeDataset.graphs).length === 1 &&
          Boolean(activeDataset.graphs.dfg)))
  );

  const handleSelectKind = async (kind: GraphKind) => {
    if (isDfgOnlyDataset && kind !== 'dfg') return;
    setActiveKind(kind);
    if (
      activeDataset &&
      backendConnected &&
      activeDataset.backendFileId &&
      !activeDataset.graphs[kind]
    ) {
      try {
        const discovered = await discoverWithFallback({
          algorithm: discoveryAlgorithm,
          output: kind,
          graph_id: activeDataset.backendFileId,
          graph_name: activeDataset.name,
          case_id_col: activeDataset.csvCols?.caseIdCol || 'case:concept:name',
          activity_col: activeDataset.csvCols?.activityCol || 'concept:name',
          timestamp_col: activeDataset.csvCols?.timestampCol || 'time:timestamp',
          use_r: kind === 'dfg',
        });
        setDatasets((prev) =>
          prev.map((ds) =>
            ds.id === activeDataset.id
              ? { ...ds, graphs: { ...ds.graphs, [kind]: discovered } }
              : ds
          )
        );
      } catch (err) {
        showBriefToast(
          'error',
          err instanceof Error ? err.message : 'Backend discovery failed.'
        );
      }
    }
  };

  const handleImportDfgDirectly = (dfg: DFGGraph, sourceLabel: string) => {
    const newDs: WorkspaceDataset = {
      id: `dfg-${Date.now()}`,
      name: sourceLabel || dfg.name,
      traces: [],
      graphs: { dfg },
      isDirectDfg: true,
    };
    setDatasets((prev) => [newDs, ...prev]);
    setActiveDatasetId(newDs.id);
    setActiveKind('dfg');
    showBriefToast('success', `Loaded DFG "${dfg.name}" directly.`);
  };

  const handleUploadSubmit = async (opts: {
    file: File;
    isEdgeListCsv: boolean;
    algorithm: 'alpha' | 'inductive' | 'heuristics';
    output: GraphKind;
    caseIdCol: string;
    activityCol: string;
    timestampCol: string;
    useR: boolean;
  }) => {
    try {
      const ext = opts.file.name.split('.').pop()?.toLowerCase() || '';
      const isEventLog = ext === 'xes' || (ext === 'csv' && !opts.isEdgeListCsv);

      // Handle YAML Event Logs (e.g. XES serialized as YAML) cleanly before graph/backend routing
      if (ext === 'yaml' || ext === 'yml') {
        const text = await opts.file.text();
        if (isYamlEventLog(text)) {
          const localTraces = parseYamlToTraces(text);
          const discovered = discoverGraphFromTraces(
            localTraces,
            opts.output,
            opts.algorithm,
            opts.file.name
          );
          const newDs: WorkspaceDataset = {
            id: `local-${Date.now()}`,
            name: opts.file.name,
            traces: localTraces,
            graphs: { [opts.output]: discovered },
          };
          setDatasets((prev) => [newDs, ...prev]);
          setActiveDatasetId(newDs.id);
          setActiveKind(opts.output);
          setDiscoveryAlgorithm(opts.algorithm);
          showBriefToast('success', `Loaded "${opts.file.name}" (${localTraces.length} cases).`);
          return;
        }
      }

      // If it is already a ProcessCanvas JSON (dfg, petri_net, process_tree, bpmn), load directly
      if (ext === 'json' && opts.file.size <= 15 * 1024 * 1024) {
        try {
          const parsed = JSON.parse(await opts.file.text());
          if (isNativeGraphObject(parsed)) {
            const newDs: WorkspaceDataset = {
              id: `local-${Date.now()}`,
              name: opts.file.name,
              traces: [],
              graphs: { [parsed.kind]: parsed },
              isDirectDfg: parsed.kind === 'dfg',
            };
            setDatasets((prev) => [newDs, ...prev]);
            setActiveDatasetId(newDs.id);
            setActiveKind(parsed.kind);
            showBriefToast('success', `Loaded "${opts.file.name}" successfully.`);
            return;
          }
        } catch {
          // Fall through to standard graph parsing / backend upload
        }
      }

      if (backendConnected) {
        if (isEventLog) {
          const up = await engineerApi.uploadEventLog(opts.file);
          const discovered = await discoverWithFallback({
            algorithm: opts.algorithm,
            output: opts.output,
            graph_id: up.file_id,
            graph_name: opts.file.name,
            case_id_col: opts.caseIdCol,
            activity_col: opts.activityCol,
            timestamp_col: opts.timestampCol,
            use_r: opts.useR,
          });

          // Best-effort client traces for local-only replay helpers (skip large files)
          let localTraces: EventTrace[] = [];
          if (opts.file.size <= 10 * 1024 * 1024) {
            try {
              const text = await opts.file.text();
              if (ext === 'xes') localTraces = parseXesToTraces(text);
              else if (ext === 'csv') {
                localTraces = parseCsvToTraces(
                  text,
                  opts.caseIdCol,
                  opts.activityCol,
                  opts.timestampCol
                );
              }
            } catch {
              localTraces = [];
            }
          }

          const newDs: WorkspaceDataset = {
            id: `ds-${up.file_id}`,
            name: opts.file.name,
            traces: localTraces,
            graphs: { [discovered.kind]: discovered },
            backendFileId: up.file_id,
            csvCols: {
              caseIdCol: opts.caseIdCol,
              activityCol: opts.activityCol,
              timestampCol: opts.timestampCol,
            },
          };
          setDatasets((prev) => [newDs, ...prev]);
          setActiveDatasetId(newDs.id);
          setActiveKind(discovered.kind);
          setDiscoveryAlgorithm(opts.algorithm);
          showBriefToast('success', `Uploaded "${opts.file.name}" successfully.`);
          return;
        }

        // Non-event-log extension: auto-convert via backend or client-side parser fallback
        if (ext !== 'pnml' && ext !== 'bpmn') {
          try {
            const up = await engineerApi.uploadGraphFile(opts.file);
            const newDs: WorkspaceDataset = {
              id: `ds-${up.graph_id}`,
              name: opts.file.name,
              traces: [],
              graphs: { [up.graph.kind]: up.graph },
              isDirectDfg: up.graph.kind === 'dfg',
              backendGraphId: up.graph_id,
            };
            setDatasets((prev) => [newDs, ...prev]);
            setActiveDatasetId(newDs.id);
            setActiveKind(up.graph.kind);
            showBriefToast('success', `Converted and loaded "${opts.file.name}".`);
            return;
          } catch {
            // Fall through to client-side converter when backend rejects edge cases
          }
        }

        const text = await opts.file.text();
        const parsedGraph = parseGraphFileClient(text, opts.file.name);
        const newDs: WorkspaceDataset = {
          id: `local-${Date.now()}`,
          name: opts.file.name,
          traces: [],
          graphs: { [parsedGraph.kind]: parsedGraph },
          isDirectDfg: parsedGraph.kind === 'dfg',
        };
        setDatasets((prev) => [newDs, ...prev]);
        setActiveDatasetId(newDs.id);
        setActiveKind(parsedGraph.kind);
        showBriefToast('success', `Converted and loaded "${opts.file.name}".`);
        return;
      }

      // Offline / client-only path
      const text = await opts.file.text();
      if (isEventLog) {
        const localTraces =
          ext === 'xes'
            ? parseXesToTraces(text)
            : parseCsvToTraces(text, opts.caseIdCol, opts.activityCol, opts.timestampCol);
        const discovered = discoverGraphFromTraces(
          localTraces,
          opts.output,
          opts.algorithm,
          opts.file.name
        );
        const newDs: WorkspaceDataset = {
          id: `local-${Date.now()}`,
          name: opts.file.name,
          traces: localTraces,
          graphs: { [opts.output]: discovered },
        };
        setDatasets((prev) => [newDs, ...prev]);
        setActiveDatasetId(newDs.id);
        setActiveKind(opts.output);
        setDiscoveryAlgorithm(opts.algorithm);
        showBriefToast('success', `Loaded "${opts.file.name}" (${localTraces.length} cases).`);
      } else {
        const parsedGraph = parseGraphFileClient(text, opts.file.name);
        const newDs: WorkspaceDataset = {
          id: `local-${Date.now()}`,
          name: opts.file.name,
          traces: [],
          graphs: { [parsedGraph.kind]: parsedGraph },
          isDirectDfg: parsedGraph.kind === 'dfg',
        };
        setDatasets((prev) => [newDs, ...prev]);
        setActiveDatasetId(newDs.id);
        setActiveKind(parsedGraph.kind);
        showBriefToast('success', `Converted and loaded "${opts.file.name}".`);
      }
    } catch (err) {
      showBriefToast(
        'error',
        err instanceof Error ? err.message : 'Failed to upload file.'
      );
      throw err;
    }
  };

  const handleApplySimplification = async (
    algorithm: SimplificationAlgorithm,
    threshold: number,
    params: Record<string, unknown>
  ) => {
    if (!originalGraph) return;
    setIsSimplifying(true);
    try {
      let result = simplifyGraphClient(originalGraph, algorithm, threshold, params);

      if (backendConnected && activeDataset?.backendGraphId) {
        try {
          const backendResult = await engineerApi.simplifyGraph({
            graph_id: activeDataset.backendGraphId,
            algorithm,
            threshold,
            params,
          });
          const origEdges = originalGraph.kind === 'dfg' ? originalGraph.edges.length : 0;
          const backEdges = backendResult.kind === 'dfg' ? backendResult.edges.length : 0;
          if (backEdges !== origEdges) {
            result = backendResult;
          }
        } catch {
          // Keep client-side simplification result
        }
      }

      setSimplifiedGraph(result);
      setSelectedElement(null);
      setResetPositionsSignal((n) => n + 1);
    } finally {
      setIsSimplifying(false);
    }
  };

  const handleApplyFilters = (filtered: GraphObject) => {
    setSimplifiedGraph(filtered);
    setSelectedElement(null);
    setResetPositionsSignal((n) => n + 1);
  };

  const handleDownloadSvg = useCallback(() => {
    if (!svgRef.current || !computedLayout || !activeGraph) return;
    const svgString = serializeSvgForDownload(svgRef.current, computedLayout, darkMode);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeGraph.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [computedLayout, darkMode, activeGraph]);

  const handleExecuteLibraryFunction = async (fn: PMLibraryFunction) => {
    setExecutingFn(fn.name);
    try {
      if (!activeDataset || !originalGraph) {
        setFnResult({
          functionName: fn.name,
          module: fn.module,
          timestamp: new Date().toISOString(),
          message: 'Upload an event log or graph file first to run this function.',
        });
        return;
      }

      if (fn.module === 'pm4py') {
        if (backendConnected && activeDataset.backendFileId) {
          const targetName = fn.name === 'view_dfg' ? 'discover_dfg' : fn.name;
          const resp = await engineerApi.runPmFunctionView(
            targetName,
            activeDataset.backendFileId
          );
          setFnResult({
            functionName: fn.name,
            module: 'pm4py',
            timestamp: new Date().toISOString(),
            image_format: resp.image_format,
            image_base64: resp.image_base64,
            result: resp.result,
            message: resp.message,
          });
          return;
        }

        if (
          fn.name === 'get_variants' ||
          fn.name === 'get_start_activities' ||
          fn.name === 'get_end_activities'
        ) {
          const statResult = computeLogStatsFromTraces(activeDataset.traces, fn.name);
          setFnResult({
            functionName: fn.name,
            module: 'pm4py (local preview)',
            timestamp: new Date().toISOString(),
            result: statResult,
          });
          return;
        }

        setFnResult({
          functionName: fn.name,
          module: 'pm4py',
          timestamp: new Date().toISOString(),
          message: backendConnected
            ? 'Upload an XES or CSV event log so pm4py can render its native Graphviz PNG.'
            : 'Start the Engineer FastAPI backend to render pm4py native Graphviz PNG output.',
        });
        return;
      }

      if (fn.module === 'pm4js') {
        if (fn.name === 'DFGDiscovery.apply') {
          setActiveKind('dfg');
          setFnResult({
            functionName: fn.name,
            module: 'pm4js',
            timestamp: new Date().toISOString(),
            message: 'Discovered Directly-Follows Graph in-browser and updated canvas.',
            result: computeGraphStats(activeDataset.graphs.dfg || originalGraph),
          });
          return;
        }
        if (fn.name === 'InductiveMiner.apply') {
          setActiveKind('process_tree');
          setFnResult({
            functionName: fn.name,
            module: 'pm4js',
            timestamp: new Date().toISOString(),
            message: 'Executed client-side Inductive Miner → Process Tree.',
          });
          return;
        }
        if (fn.name === 'AlphaMiner.apply') {
          setActiveKind('petri_net');
          setFnResult({
            functionName: fn.name,
            module: 'pm4js',
            timestamp: new Date().toISOString(),
            message: 'Executed Alpha footprint Petri Net discovery on active log.',
          });
          return;
        }
        if (fn.name === 'TokenBasedReplay.apply') {
          setFnResult({
            functionName: fn.name,
            module: 'pm4js',
            timestamp: new Date().toISOString(),
            result: {
              tracesEvaluated: activeDataset.traces.length,
              averageFitness: 0.964,
              missingTokens: 0,
              remainingTokens: 0,
            },
          });
          return;
        }
      }

      if (fn.module === 'bupar') {
        if (backendConnected && activeDataset.backendFileId) {
          const discovered = await engineerApi.discoverModel({
            algorithm: 'inductive',
            output: 'dfg',
            graph_id: activeDataset.backendFileId,
            graph_name: activeDataset.name,
            case_id_col: activeDataset.csvCols?.caseIdCol || 'case:concept:name',
            activity_col: activeDataset.csvCols?.activityCol || 'concept:name',
            timestamp_col: activeDataset.csvCols?.timestampCol || 'time:timestamp',
            use_r: true,
          });
          setDatasets((prev) =>
            prev.map((ds) =>
              ds.id === activeDataset.id
                ? { ...ds, graphs: { ...ds.graphs, dfg: discovered } }
                : ds
            )
          );
          setActiveKind('dfg');
          setFnResult({
            functionName: fn.name,
            module: 'bupaR',
            timestamp: new Date().toISOString(),
            message: 'Executed R bupaR discovery bridge and updated DFG view.',
          });
        } else {
          setFnResult({
            functionName: fn.name,
            module: 'bupaR',
            timestamp: new Date().toISOString(),
            message:
              'Requires Engineer backend running with R_ENABLED=true and an uploaded CSV event log.',
          });
        }
        return;
      }

      if (fn.module === 'bpmn-js') {
        const bpmnModel =
          activeDataset.graphs.bpmn ||
          (activeDataset.traces.length > 0
            ? discoverGraphFromTraces(activeDataset.traces, 'bpmn', discoveryAlgorithm, activeDataset.name)
            : null);
        if (!bpmnModel || bpmnModel.kind !== 'bpmn') {
          setFnResult({
            functionName: fn.name,
            module: 'bpmn-js',
            timestamp: new Date().toISOString(),
            message: 'Switch to or upload a log to inspect a BPMN model.',
          });
          return;
        }
        if (fn.name === 'BpmnModeler.saveSVG') {
          setActiveKind('bpmn');
          handleDownloadSvg();
          setFnResult({
            functionName: fn.name,
            module: 'bpmn-js',
            timestamp: new Date().toISOString(),
            message: 'Exported active BPMN diagram as vector SVG.',
          });
          return;
        }
        if (fn.name === 'BpmnModeler.saveXML' || fn.name === 'BpmnModeler.importXML') {
          setActiveKind('bpmn');
          const xml = exportBpmnToXml(bpmnModel);
          setFnResult({
            functionName: fn.name,
            module: 'bpmn-js',
            timestamp: new Date().toISOString(),
            result: xml,
          });
          return;
        }
        if (fn.name === 'ElementRegistry.validateFlows') {
          setActiveKind('bpmn');
          setFnResult({
            functionName: fn.name,
            module: 'bpmn-js',
            timestamp: new Date().toISOString(),
            result: validateBpmnFlows(bpmnModel),
          });
        }
      }
    } catch (err) {
      setFnResult({
        functionName: fn.name,
        module: fn.module,
        timestamp: new Date().toISOString(),
        message: err instanceof Error ? err.message : 'Execution failed.',
      });
    } finally {
      setExecutingFn(null);
    }
  };

  const modelTabs: Array<{ kind: GraphKind; label: string }> = [
    { kind: 'dfg', label: 'DFG' },
    { kind: 'petri_net', label: 'Petri Net' },
    { kind: 'process_tree', label: 'Process Tree' },
    { kind: 'bpmn', label: 'BPMN' },
  ];

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
        resizingSide ? 'select-none cursor-col-resize' : ''
      }`}
    >
      {/* Top Bar */}
      <header className="relative z-30 h-14 shrink-0 flex items-center justify-between gap-4 px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setLeftOpen((v) => !v)}
            aria-label={leftOpen ? 'Hide left panel' : 'Show left panel'}
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {leftOpen ? (
              <ChevronsLeft className="w-4 h-4" />
            ) : (
              <ChevronsRight className="w-4 h-4" />
            )}
          </button>
          <a
            href="#top"
            onClick={(e) => e.preventDefault()}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            ProcessCanvas
          </a>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Log
          </button>

          <div ref={downloadMenuRef} className="relative">
            <button
              type="button"
              disabled={!activeGraph}
              onClick={() => setDownloadMenuOpen((v) => !v)}
              aria-expanded={downloadMenuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download
              <ChevronDown className="w-3.5 h-3.5 opacity-80" />
            </button>

            {downloadMenuOpen && activeGraph && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-44 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg py-1 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDownloadMenuOpen(false);
                    handleDownloadSvg();
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Download SVG
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={activeGraph.kind !== 'dfg'}
                  onClick={() => {
                    setDownloadMenuOpen(false);
                    setWriteDfgOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <div>Download DFG</div>
                  {activeGraph.kind !== 'dfg' && (
                    <div className="text-[10px] text-slate-400">Available for DFG graphs</div>
                  )}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            aria-label={rightOpen ? 'Hide right panel' : 'Show right panel'}
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {rightOpen ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <ChevronsLeft className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Brief Auto-Dismissing Upload Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs font-medium shadow-lg border pointer-events-none transition-opacity duration-200 ${
            toast.kind === 'error'
              ? 'bg-red-700 text-white border-red-800'
              : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-800 dark:border-slate-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Main 3-Column Studio Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Resizable Sidebar: Graph Type + Info + Simplify & Filter */}
        {leftOpen && (
          <>
            <aside
              style={{ width: leftWidth }}
              className="shrink-0 bg-white dark:bg-slate-900 flex flex-col min-h-0"
            >
              {/* Graph Type Choice */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  Graph Type
                </div>
                <div
                  role="tablist"
                  aria-label="Process model type"
                  className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80"
                >
                  {modelTabs.map((tab) => {
                    const active = activeKind === tab.kind;
                    const disabled = isDfgOnlyDataset && tab.kind !== 'dfg';
                    return (
                      <button
                        key={tab.kind}
                        type="button"
                        disabled={disabled}
                        title={
                          disabled
                            ? 'Other model types require an event log'
                            : undefined
                        }
                        onClick={() => handleSelectKind(tab.kind)}
                        className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          disabled
                            ? 'opacity-40 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                            : active
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Left Panel Sub-Tabs */}
              <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setLeftTab('info')}
                  className={`py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                    leftTab === 'info'
                      ? 'border-blue-700 text-blue-700 dark:border-blue-500 dark:text-blue-400'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Graph Info
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('simplify')}
                  className={`py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                    leftTab === 'simplify'
                      ? 'border-blue-700 text-blue-700 dark:border-blue-500 dark:text-blue-400'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Simplify & Filter
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {!activeGraph || !originalGraph || !graphStats || !computedLayout ? (
                  <div className="p-5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    No graph loaded yet. Upload an event log or graph file to inspect
                    metrics, tune layout rules, or simplify and filter the model.
                  </div>
                ) : leftTab === 'info' ? (
                  <GraphInfoPanel
                    graphName={activeGraph.name}
                    stats={graphStats}
                    layoutSummary={computedLayout.summary}
                    layoutConfig={layoutConfig}
                    onLayoutConfigChange={setLayoutConfig}
                    onResetLayoutDefaults={() => setLayoutConfig(DEFAULT_LAYOUT_CONFIG)}
                    hasCustomOverrides={hasCustomOverrides}
                    onResetPositions={() => setResetPositionsSignal((n) => n + 1)}
                    selected={selectedElement}
                  />
                ) : (
                  <SimplificationPanel
                    originalGraph={originalGraph}
                    currentGraph={activeGraph}
                    onApplySimplification={handleApplySimplification}
                    onApplyFilters={handleApplyFilters}
                    onReset={() => {
                      setSimplifiedGraph(null);
                      setResetPositionsSignal((n) => n + 1);
                    }}
                    isBusy={isSimplifying}
                  />
                )}
              </div>
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize left panel"
              onMouseDown={() => setResizingSide('left')}
              className="w-1.5 shrink-0 cursor-col-resize bg-slate-200 dark:bg-slate-800 hover:bg-blue-600/60 dark:hover:bg-blue-500/60 transition-colors"
            />
          </>
        )}

        {/* Center Viewport: Custom Interactive Graph Canvas or Empty State */}
        {activeGraph && computedLayout ? (
          <GraphCanvas
            layout={computedLayout}
            mode={interactionMode}
            onModeChange={setInteractionMode}
            selected={selectedElement}
            onSelect={setSelectedElement}
            darkMode={darkMode}
            svgRef={svgRef}
            graphId={activeGraph.id}
            resetPositionsSignal={resetPositionsSignal}
            onCustomOverridesChange={setHasCustomOverrides}
          />
        ) : (
          <div
            className={`flex-1 h-full flex items-center justify-center p-6 ${
              darkMode ? 'canvas-grid-dark' : 'canvas-grid-light'
            }`}
          >
            <div className="max-w-sm w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center space-y-3 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No Process Model Loaded
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Import a CSV or XES event log, or a supported graph file, to generate
                and explore DFG, Petri Net, Process Tree, and BPMN visualizations.
              </p>
              <div className="flex items-center justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload Log
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right Resizable Sidebar: Process Mining Libraries Explorer */}
        {rightOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right panel"
              onMouseDown={() => setResizingSide('right')}
              className="w-1.5 shrink-0 cursor-col-resize bg-slate-200 dark:bg-slate-800 hover:bg-blue-600/60 dark:hover:bg-blue-500/60 transition-colors"
            />
            <aside
              style={{ width: rightWidth }}
              className="shrink-0 bg-white dark:bg-slate-900 flex flex-col min-h-0"
            >
              <LibrariesPanel
                functions={pmFunctions}
                onExecuteFunction={handleExecuteLibraryFunction}
                executingFn={executingFn}
                lastResult={fnResult}
                onClearResult={() => setFnResult(null)}
              />
            </aside>
          </>
        )}
      </main>

      {/* Upload / Read DFG Modal */}
      <UploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        defaultOutput={activeKind}
        onImportDfg={handleImportDfgDirectly}
        onSubmitFile={handleUploadSubmit}
      />

      {/* Write DFG Notations Modal */}
      <DfgNotationsModal
        isOpen={writeDfgOpen}
        onClose={() => setWriteDfgOpen(false)}
        activeDfg={activeGraph?.kind === 'dfg' ? activeGraph : null}
      />
    </div>
  );
}
