/**
 * library_panel.js
 *
 * Library Benchmarking Panel – renders an accordion-based sidebar panel
 * with four library tabs (pm4py, pm4js, bpmn-js, bupaR), their categorised
 * function cards, and in-panel execution + result display.
 *
 * Depends on:
 *   • api.js  – window.GraphAPI (must expose .executeLibraryFunction(id, params))
 *   • pm4js   – window.pm4js (loaded lazily on first use)
 *   • bpmn-js – window.BpmnJS (loaded lazily on first use)
 *   • app.js  – window.AppState (has .currentSession, .log, .cy, etc.)
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════════════════════ */

const LANG_BADGE = {
  python: { text: "Python", cls: "lib-badge--python" },
  javascript: { text: "JavaScript", cls: "lib-badge--js" },
  R: { text: "R", cls: "lib-badge--r" },
};

const NEEDS_LABEL = {
  log: "event log",
  petri_net: "Petri net",
  bpmn_xml: "BPMN XML",
  process_tree: "process tree",
  bpmn_loaded: "BPMN diagram",
  pm4js_log: "pm4js log",
  pm4js_petri: "pm4js Petri net",
};

/* ═══════════════════════════════════════════════════════════════════════════
   Session-local state
══════════════════════════════════════════════════════════════════════════════ */

const _state = {
  libraries: [], // raw registry from server
  serverState: {}, // { has_log, has_petri, … }
  activeLib: null, // currently displayed library id
  activeNativeLib: null, // id of library currently shown in native view
  pm4jsLog: null,
  pm4jsNet: null,
  bpmnViewer: null,
  bpmnLoaded: false,
  resultCache: {}, // function_id → last result object
};

/* ═══════════════════════════════════════════════════════════════════════════
   Bootstrap
══════════════════════════════════════════════════════════════════════════════ */

export async function initLibraryPanel(containerSelector = "#library-panel") {
  const root = document.querySelector(containerSelector);
  if (!root) {
    console.warn("[LibraryPanel] container not found:", containerSelector);
    return;
  }

  _buildShell(root);
  await _loadRegistry();
  await _refreshServerState();
  _renderTabs();
  _startPolling();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Build DOM shell
══════════════════════════════════════════════════════════════════════════════ */

function _buildShell(root) {
  root.innerHTML = `
    <div class="lib-panel" id="lib-panel-inner">
      <div class="lib-panel__header">
        <span class="lib-panel__title">Library Benchmarks</span>
        <button class="lib-panel__collapse-btn" title="Collapse" id="lib-collapse-btn">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 5l5 5 5-5" stroke="currentColor" stroke-width="1.6"
                  fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="lib-panel__state-bar" id="lib-state-bar">
        <span class="lib-state-pill" id="lib-pill-log" title="No event log loaded">No log</span>
        <span class="lib-state-pill" id="lib-pill-petri" title="No Petri net">No Petri</span>
        <span class="lib-state-pill" id="lib-pill-bpmn" title="No BPMN">No BPMN</span>
        <span class="lib-state-pill" id="lib-pill-tree" title="No process tree">No tree</span>
      </div>

      <div class="lib-panel__lib-tabs" id="lib-tabs" role="tablist"></div>

      <div class="lib-panel__body" id="lib-body">
        <div class="lib-loading" id="lib-loading">Loading…</div>
      </div>

      <!-- Native view overlay -->
      <div class="lib-native-overlay" id="lib-native-overlay" hidden>
        <div class="lib-native-overlay__header">
          <span id="lib-native-label">Native View</span>
          <button class="lib-native-close-btn" id="lib-native-close">✕</button>
        </div>
        <div class="lib-native-overlay__body" id="lib-native-body"></div>
      </div>
    </div>`;

  document
    .getElementById("lib-collapse-btn")
    .addEventListener("click", _toggleCollapse);
  document
    .getElementById("lib-native-close")
    .addEventListener("click", _closeNativeView);
}

function _toggleCollapse() {
  const body = document.getElementById("lib-body");
  const btn = document.getElementById("lib-collapse-btn");
  const collapsed = body.classList.toggle("lib-panel__body--hidden");
  btn.classList.toggle("lib-collapse-btn--rotated", !collapsed);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Data fetching
══════════════════════════════════════════════════════════════════════════════ */

async function _loadRegistry() {
  try {
    const res = await fetch("/api/libraries");
    _state.libraries = await res.json();
  } catch (e) {
    console.error("[LibraryPanel] registry fetch failed", e);
    _state.libraries = [];
  }
}

async function _refreshServerState() {
  try {
    const sid = window.AppState?.currentSession ?? "";
    const res = await fetch(`/api/library/state?session=${sid}`);
    _state.serverState = await res.json();
    _updateStatePills();
  } catch (e) {
    /* non-fatal */
  }
}

function _startPolling(intervalMs = 4000) {
  setInterval(_refreshServerState, intervalMs);
}

/* ═══════════════════════════════════════════════════════════════════════════
   State pills
══════════════════════════════════════════════════════════════════════════════ */

function _updateStatePills() {
  const s = _state.serverState;
  _pill("lib-pill-log", s.has_log, "Log ✓", "No log");
  _pill("lib-pill-petri", s.has_petri, "Petri ✓", "No Petri");
  _pill("lib-pill-bpmn", s.has_bpmn, "BPMN ✓", "No BPMN");
  _pill("lib-pill-tree", s.has_process_tree, "Tree ✓", "No tree");

  // also re-render enabled state of all function cards
  document.querySelectorAll(".lib-fn-card").forEach(_refreshCardState);
}

function _pill(id, active, trueText, falseText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = active ? trueText : falseText;
  el.classList.toggle("lib-state-pill--active", !!active);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tab rendering
══════════════════════════════════════════════════════════════════════════════ */

function _renderTabs() {
  const tabBar = document.getElementById("lib-tabs");
  tabBar.innerHTML = "";

  _state.libraries.forEach((lib, i) => {
    const btn = document.createElement("button");
    btn.className = "lib-tab-btn";
    btn.setAttribute("role", "tab");
    btn.dataset.libId = lib.id;
    btn.innerHTML = `
      <span class="lib-tab-name">${lib.label}</span>
      <span class="lib-badge ${LANG_BADGE[lib.language]?.cls ?? ""}">
        ${LANG_BADGE[lib.language]?.text ?? lib.language}
      </span>`;
    if (!lib.available) btn.classList.add("lib-tab-btn--unavailable");
    btn.addEventListener("click", () => _selectLib(lib.id));
    tabBar.appendChild(btn);
  });

  // Auto-select first
  if (_state.libraries.length) _selectLib(_state.libraries[0].id);
}

function _selectLib(libId) {
  _state.activeLib = libId;
  document.querySelectorAll(".lib-tab-btn").forEach((b) => {
    b.classList.toggle("lib-tab-btn--active", b.dataset.libId === libId);
  });
  _renderLibBody(libId);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Library body rendering
══════════════════════════════════════════════════════════════════════════════ */

function _renderLibBody(libId) {
  const lib = _state.libraries.find((l) => l.id === libId);
  const body = document.getElementById("lib-body");
  if (!lib) {
    body.innerHTML = '<div class="lib-empty">Unknown library.</div>';
    return;
  }

  let html = `
    <div class="lib-info">
      <p class="lib-description">${_esc(lib.description)}</p>
      <div class="lib-info-row">
        <a class="lib-link" href="${_esc(lib.homepage)}" target="_blank" rel="noopener">
          Documentation ↗
        </a>`;

  if (lib.native_view) {
    html += `<button class="lib-native-btn" data-lib="${_esc(lib.id)}">
               ◈ Native View
             </button>`;
  }

  if (!lib.available) {
    html += `<span class="lib-unavail-tag">Not available in this runtime</span>`;
  }

  html += `</div></div>`;

  lib.categories.forEach((cat) => {
    html += `
      <details class="lib-category" open>
        <summary class="lib-category__title">${_esc(cat.name)}</summary>
        <div class="lib-fn-list">
          ${cat.functions.map((fn) => _fnCardHtml(fn, lib)).join("")}
        </div>
      </details>`;
  });

  body.innerHTML = html;

  // Native view button
  body
    .querySelector(".lib-native-btn")
    ?.addEventListener("click", (e) =>
      _openNativeView(e.currentTarget.dataset.lib),
    );

  // Wire up all function cards
  body.querySelectorAll(".lib-fn-card").forEach((card) => {
    _refreshCardState(card);
    card
      .querySelector(".lib-fn-run-btn")
      ?.addEventListener("click", () => _runFunction(card));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Function card HTML
══════════════════════════════════════════════════════════════════════════════ */

function _fnCardHtml(fn, lib) {
  const needsHtml = (fn.needs || [])
    .map((n) => `<span class="lib-fn-need">${_esc(NEEDS_LABEL[n] ?? n)}</span>`)
    .join("");

  const paramsHtml = (fn.params || []).map((p) => _paramInputHtml(p)).join("");

  const runnable = fn.executable;
  const langTag =
    lib.language === "R"
      ? '<span class="lib-fn-tag lib-fn-tag--r">R only – reference</span>'
      : fn.client_side
        ? '<span class="lib-fn-tag lib-fn-tag--js">client-side</span>'
        : '<span class="lib-fn-tag lib-fn-tag--py">server-side</span>';

  return `
    <div class="lib-fn-card"
         data-fn-id="${_esc(fn.id)}"
         data-client="${fn.client_side ? "1" : "0"}"
         data-needs="${_esc(JSON.stringify(fn.needs ?? []))}"
         data-executable="${runnable ? "1" : "0"}">
      <div class="lib-fn-card__header">
        <span class="lib-fn-name" title="${_esc(fn.signature)}">${_esc(fn.name)}</span>
        ${langTag}
        ${runnable ? `<button class="lib-fn-run-btn" disabled title="Run">▶ Run</button>` : ""}
      </div>
      <code class="lib-fn-sig">${_esc(fn.signature)}</code>
      <p class="lib-fn-desc">${_esc(fn.description)}</p>
      ${needsHtml ? `<div class="lib-fn-needs">Needs: ${needsHtml}</div>` : ""}
      ${paramsHtml ? `<div class="lib-fn-params">${paramsHtml}</div>` : ""}
      <div class="lib-fn-result" hidden></div>
    </div>`;
}

function _paramInputHtml(p) {
  if (p.type === "select") {
    const opts = p.options
      .map(
        (o) =>
          `<option value="${_esc(o)}" ${o === p.default ? "selected" : ""}>${_esc(o)}</option>`,
      )
      .join("");
    return `<label class="lib-param">
      <span>${_esc(p.label)}</span>
      <select name="${_esc(p.name)}">${opts}</select>
    </label>`;
  }
  if (p.type === "int" || p.type === "float") {
    return `<label class="lib-param">
      <span>${_esc(p.label)}</span>
      <input type="number" name="${_esc(p.name)}" value="${p.default}"
             ${p.min !== undefined ? `min="${p.min}"` : ""}
             ${p.max !== undefined ? `max="${p.max}"` : ""}
             ${p.step !== undefined ? `step="${p.step}"` : p.type === "float" ? 'step="0.05"' : 'step="1"'}>
    </label>`;
  }
  // string
  return `<label class="lib-param">
    <span>${_esc(p.label)}</span>
    <input type="text" name="${_esc(p.name)}" value="${_esc(p.default ?? "")}">
  </label>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Card enable/disable logic
══════════════════════════════════════════════════════════════════════════════ */

function _refreshCardState(card) {
  const executable = card.dataset.executable === "1";
  const clientSide = card.dataset.client === "1";
  const needs = JSON.parse(card.dataset.needs || "[]");
  const btn = card.querySelector(".lib-fn-run-btn");
  if (!btn) return;

  if (!executable) {
    btn.disabled = true;
    return;
  }

  const unmet = needs.filter((n) => !_needMet(n, clientSide));
  btn.disabled = unmet.length > 0;
  btn.title = unmet.length
    ? `Needs: ${unmet.map((n) => NEEDS_LABEL[n] ?? n).join(", ")}`
    : "Run this function";
}

function _needMet(need, clientSide) {
  const ss = _state.serverState;
  switch (need) {
    case "log":
      return ss.has_log;
    case "petri_net":
      return ss.has_petri;
    case "bpmn_xml":
      return ss.has_bpmn;
    case "process_tree":
      return ss.has_process_tree;
    case "bpmn_loaded":
      return _state.bpmnLoaded;
    case "pm4js_log":
      return !!_state.pm4jsLog;
    case "pm4js_petri":
      return !!_state.pm4jsNet;
    default:
      return true;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Function execution
══════════════════════════════════════════════════════════════════════════════ */

async function _runFunction(card) {
  const fnId = card.dataset.fnId;
  const clientSide = card.dataset.client === "1";
  const params = _collectParams(card);
  const resultEl = card.querySelector(".lib-fn-result");
  const runBtn = card.querySelector(".lib-fn-run-btn");

  resultEl.hidden = false;
  resultEl.className = "lib-fn-result lib-fn-result--loading";
  resultEl.textContent = "Running…";
  runBtn.disabled = true;

  try {
    let data;
    if (clientSide) {
      data = await _runClientSide(fnId, params);
    } else {
      data = await _runServerSide(fnId, params);
    }

    _state.resultCache[fnId] = data;
    _showResult(resultEl, data, fnId);
    // After a mutating function (filtering, discovery) refresh state
    if (!clientSide) await _refreshServerState();
  } catch (err) {
    resultEl.className = "lib-fn-result lib-fn-result--error";
    resultEl.textContent = `Error: ${err.message}`;
  } finally {
    _refreshCardState(card);
  }
}

function _collectParams(card) {
  const params = {};
  card.querySelectorAll("input, select").forEach((el) => {
    if (!el.name) return;
    params[el.name] = el.type === "number" ? Number(el.value) : el.value;
  });
  return params;
}

/* ─── Server-side (pm4py) ───────────────────────────────────────────────── */

async function _runServerSide(fnId, params) {
  const sid = window.AppState?.currentSession ?? "";
  const res = await fetch("/api/library/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ function_id: fnId, params, session: sid }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Server error");
  return data;
}

/* ─── Client-side (pm4js / bpmn-js) ────────────────────────────────────── */

async function _runClientSide(fnId, params) {
  // pm4js functions
  if (fnId.startsWith("pm4js.")) return _runPm4js(fnId, params);
  // bpmn-js functions
  if (fnId.startsWith("bpmnjs.")) return _runBpmnJs(fnId, params);
  throw new Error(`Unknown client-side function: ${fnId}`);
}

async function _runPm4js(fnId, params) {
  if (!window.pm4js)
    throw new Error("pm4js is not loaded. Add pm4js to your page.");
  const pm4js = window.pm4js;

  switch (fnId) {
    case "pm4js.import_xes_string": {
      // Fetch XES from server and parse it
      const res = await fetch("/api/export?format=xes");
      const xml = await res.text();
      _state.pm4jsLog = pm4js.importXesString(xml);
      return { ok: true, result: { cases: _state.pm4jsLog.traces.length } };
    }
    case "pm4js.get_variants": {
      const v = pm4js.getVariants(_state.pm4jsLog);
      return { ok: true, result: v };
    }
    case "pm4js.get_start_activities": {
      const r = pm4js.getStartActivities(_state.pm4jsLog);
      return { ok: true, result: r };
    }
    case "pm4js.get_end_activities": {
      const r = pm4js.getEndActivities(_state.pm4jsLog);
      return { ok: true, result: r };
    }
    case "pm4js.discover_dfg": {
      const dfg = pm4js.discoverDfgFromLog(_state.pm4jsLog);
      return { ok: true, result: dfg };
    }
    case "pm4js.discover_petri_net_alpha": {
      const { net, im, fm } = pm4js.discoverPetriNetAlpha(_state.pm4jsLog);
      _state.pm4jsNet = { net, im, fm };
      return {
        ok: true,
        result: {
          places: net.places?.length,
          transitions: net.transitions?.length,
        },
      };
    }
    case "pm4js.discover_petri_net_inductive": {
      const { net, im, fm } = pm4js.discoverPetriNetInductive(_state.pm4jsLog);
      _state.pm4jsNet = { net, im, fm };
      return {
        ok: true,
        result: {
          places: net.places?.length,
          transitions: net.transitions?.length,
        },
      };
    }
    case "pm4js.replay_fitness_token_based": {
      const { net, im, fm } = _state.pm4jsNet;
      const fitness = pm4js.replayFitnessTokenBased(
        _state.pm4jsLog,
        net,
        im,
        fm,
      );
      return { ok: true, result: { fitness } };
    }
    default:
      throw new Error(`Unhandled pm4js function: ${fnId}`);
  }
}

async function _runBpmnJs(fnId, params) {
  const viewer = await _ensureBpmnViewer();

  switch (fnId) {
    case "bpmnjs.importXML": {
      // Pull BPMN XML from server (discovers via pm4py if not already cached)
      let xml = _state.serverState.has_bpmn
        ? await _fetchBpmnXml()
        : await _discoverAndFetchBpmn();
      const { warnings } = await viewer.importXML(xml);
      _state.bpmnLoaded = true;
      _openNativeView("bpmn_js");
      return { ok: true, result: { warnings: warnings.length } };
    }
    case "bpmnjs.saveXML": {
      const { xml } = await viewer.saveXML({ format: true });
      return { ok: true, result: { xml, length: xml.length } };
    }
    case "bpmnjs.saveSVG": {
      const { svg } = await viewer.saveSVG();
      _downloadText(svg, "diagram.svg", "image/svg+xml");
      return { ok: true, result: { length: svg.length } };
    }
    case "bpmnjs.zoom_fit": {
      const canvas = viewer.get("canvas");
      canvas.zoom("fit-viewport");
      return { ok: true, result: { zoom: canvas.zoom() } };
    }
    case "bpmnjs.zoom_in": {
      const canvas = viewer.get("canvas");
      const z = canvas.zoom() * 1.3;
      canvas.zoom(z);
      return { ok: true, result: { zoom: z } };
    }
    case "bpmnjs.zoom_out": {
      const canvas = viewer.get("canvas");
      const z = canvas.zoom() / 1.3;
      canvas.zoom(z);
      return { ok: true, result: { zoom: z } };
    }
    case "bpmnjs.getAll": {
      const reg = viewer.get("elementRegistry");
      const all = reg.getAll().map((e) => ({ id: e.id, type: e.type }));
      return { ok: true, result: all };
    }
    case "bpmnjs.count_tasks": {
      const reg = viewer.get("elementRegistry");
      const count = reg.filter((e) => e.type === "bpmn:Task").length;
      return { ok: true, result: { tasks: count } };
    }
    case "bpmnjs.count_gateways": {
      const reg = viewer.get("elementRegistry");
      const count = reg.filter((e) => /Gateway/.test(e.type)).length;
      return { ok: true, result: { gateways: count } };
    }
    case "bpmnjs.list_lanes": {
      const reg = viewer.get("elementRegistry");
      const lanes = reg
        .filter((e) => /Lane|Participant/.test(e.type))
        .map((e) => ({ id: e.id, type: e.type, name: e.businessObject?.name }));
      return { ok: true, result: lanes };
    }
    case "bpmnjs.highlight_element": {
      const id = params.elementId;
      if (!id) throw new Error("Element ID is required.");
      viewer.get("canvas").addMarker(id, "lib-highlight");
      return { ok: true, result: { highlighted: id } };
    }
    default:
      throw new Error(`Unhandled bpmn-js function: ${fnId}`);
  }
}

/* ─── Result display ────────────────────────────────────────────────────── */

function _showResult(el, data, fnId) {
  el.hidden = false;
  el.className = "lib-fn-result lib-fn-result--ok";

  if (data.image_b64) {
    // Server-side PNG (pm4py native visualisation)
    el.innerHTML = `<img class="lib-fn-image" src="data:image/png;base64,${data.image_b64}" alt="Result">`;
    return;
  }

  const val = data.result ?? data;

  // bpmn_xml: show length only, not full XML
  if (fnId === "pm4py.discover_bpmn_inductive" && val.bpmn_xml) {
    el.innerHTML = `<span class="lib-result-pill lib-result-pill--success">BPMN XML ready (${val.length} chars)</span>
      <button class="lib-load-bpmn-btn">◈ Load in native bpmn-js viewer</button>`;
    el.querySelector(".lib-load-bpmn-btn").addEventListener("click", () =>
      _loadBpmnFromCache(),
    );
    return;
  }

  el.innerHTML = `<pre class="lib-fn-json">${_esc(JSON.stringify(val, null, 2))}</pre>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Native view
══════════════════════════════════════════════════════════════════════════════ */

async function _openNativeView(libId) {
  const overlay = document.getElementById("lib-native-overlay");
  const bodyEl = document.getElementById("lib-native-body");
  const labelEl = document.getElementById("lib-native-label");
  const lib = _state.libraries.find((l) => l.id === libId);

  overlay.hidden = false;
  labelEl.textContent = `${lib?.label ?? libId} – Native View`;
  bodyEl.innerHTML = '<div class="lib-loading">Preparing…</div>';

  _state.activeNativeLib = libId;

  if (libId === "pm4py") {
    await _renderPm4pyNative(bodyEl);
  } else if (libId === "pm4js") {
    await _renderPm4jsNative(bodyEl);
  } else if (libId === "bpmn_js") {
    await _renderBpmnJsNative(bodyEl);
  } else {
    bodyEl.innerHTML =
      '<p class="lib-empty">No native view available for this library in this runtime.</p>';
  }
}

function _closeNativeView() {
  document.getElementById("lib-native-overlay").hidden = true;
  _state.activeNativeLib = null;
}

/* pm4py native – show server-rendered PNGs */
async function _renderPm4pyNative(bodyEl) {
  const ss = _state.serverState;
  if (!ss.has_log) {
    bodyEl.innerHTML =
      '<p class="lib-empty">Load an event log first to generate pm4py views.</p>';
    return;
  }

  bodyEl.innerHTML =
    '<div class="lib-loading">Rendering via pm4py + Graphviz…</div>';

  const renders = [];
  if (ss.has_log) renders.push({ id: "pm4py.view_dfg", label: "DFG" });
  if (ss.has_petri)
    renders.push({ id: "pm4py.view_petri_net", label: "Petri Net" });
  if (ss.has_process_tree)
    renders.push({ id: "pm4py.view_process_tree", label: "Process Tree" });
  if (ss.has_bpmn) renders.push({ id: "pm4py.view_bpmn", label: "BPMN" });

  if (!renders.length) renders.push({ id: "pm4py.view_dfg", label: "DFG" });

  const results = await Promise.all(
    renders.map((r) =>
      _runServerSide(r.id, {}).catch((e) => ({
        ok: false,
        error: e.message,
        label: r.label,
      })),
    ),
  );

  bodyEl.innerHTML = "";
  results.forEach((data, i) => {
    const wrap = document.createElement("div");
    wrap.className = "lib-native-pm4py";
    if (data.image_b64) {
      wrap.innerHTML = `<p class="lib-native-pm4py__label">${_esc(renders[i].label)}</p>
        <img src="data:image/png;base64,${data.image_b64}" class="lib-native-pm4py__img" alt="${_esc(renders[i].label)}">`;
    } else {
      wrap.innerHTML = `<p class="lib-native-pm4py__label lib-native-pm4py__label--err">
        ${_esc(renders[i].label)}: ${_esc(data.error ?? "failed")}</p>`;
    }
    bodyEl.appendChild(wrap);
  });
}

/* pm4js native – DFG rendered on canvas */
async function _renderPm4jsNative(bodyEl) {
  if (!_state.pm4jsLog) {
    bodyEl.innerHTML =
      '<p class="lib-empty">Run "importXesString" first to load the log in pm4js.</p>';
    return;
  }

  bodyEl.innerHTML =
    '<canvas id="lib-pm4js-canvas" class="lib-native-canvas"></canvas>';

  const dfgData = await _runPm4js("pm4js.discover_dfg", {});
  const dfg = dfgData.result;

  _drawDfgOnCanvas(document.getElementById("lib-pm4js-canvas"), dfg);
}

function _drawDfgOnCanvas(canvas, dfg) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.offsetWidth || 600;
  canvas.height = canvas.offsetHeight || 400;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#a0aec0";
  ctx.font = "13px monospace";

  // Simple text representation — a proper D3/cytoscape layout
  // would be wired from graph.js in a real integration.
  const edges = Object.entries(dfg?.dfg?.edges ?? dfg?.result ?? {});
  let y = 30;
  ctx.fillText(`DFG – ${edges.length} edges (pm4js client-side)`, 16, y);
  y += 24;
  edges.slice(0, 20).forEach(([k, v]) => {
    ctx.fillText(`${k}  ×${v}`, 24, y);
    y += 18;
  });
  if (edges.length > 20) {
    ctx.fillStyle = "#718096";
    ctx.fillText(`… and ${edges.length - 20} more`, 24, y);
  }
}

/* bpmn-js native */
async function _renderBpmnJsNative(bodyEl) {
  bodyEl.innerHTML =
    '<div id="lib-bpmnjs-container" class="lib-native-bpmn"></div>';
  const container = bodyEl.querySelector("#lib-bpmnjs-container");

  try {
    const viewer = await _ensureBpmnViewer(container);

    if (!_state.bpmnLoaded) {
      let xml;
      if (_state.serverState.has_bpmn) {
        xml = await _fetchBpmnXml();
      } else if (_state.serverState.has_log) {
        xml = await _discoverAndFetchBpmn();
      } else {
        bodyEl.innerHTML =
          '<p class="lib-empty">Load an event log and run "discover_bpmn_inductive" first.</p>';
        return;
      }
      await viewer.importXML(xml);
      _state.bpmnLoaded = true;
    }

    viewer.get("canvas").zoom("fit-viewport");
  } catch (e) {
    bodyEl.innerHTML = `<p class="lib-empty lib-empty--error">bpmn-js error: ${_esc(e.message)}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   bpmn-js viewer management
══════════════════════════════════════════════════════════════════════════════ */

async function _ensureBpmnViewer(container) {
  if (!window.BpmnJS) {
    throw new Error("BpmnJS is not loaded. Add bpmn-js to your page.");
  }
  if (
    !_state.bpmnViewer ||
    (container && _state.bpmnViewer._container !== container)
  ) {
    _state.bpmnViewer = new window.BpmnJS({
      container: container ?? document.createElement("div"),
    });
  }
  return _state.bpmnViewer;
}

async function _fetchBpmnXml() {
  const sid = window.AppState?.currentSession ?? "";
  const res = await fetch(`/api/library/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      function_id: "pm4py.discover_bpmn_inductive",
      params: {},
      session: sid,
    }),
  });
  const d = await res.json();
  return d.result?.bpmn_xml ?? "";
}

async function _discoverAndFetchBpmn() {
  return _fetchBpmnXml(); // server discovers + caches + returns XML
}

async function _loadBpmnFromCache() {
  const xml = await _fetchBpmnXml();
  _openNativeView("bpmn_js");
  const viewer = await _ensureBpmnViewer();
  await viewer.importXML(xml);
  _state.bpmnLoaded = true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
══════════════════════════════════════════════════════════════════════════════ */

function _esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _downloadText(text, filename, mime) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
