/**
 * main.js — application entry point.
 * Wires DOM events to api.js calls and graph.js renders.
 */
import {
  uploadGraph,
  fetchGraph,
  fetchLayouts,
  applyLayout,
  simplifyGraph,
} from "./api.js";
import { initCytoscape, renderElements, applyPositions } from "./graph.js";
import { setMeta, setStatus, enableControls, populateLayouts } from "./ui.js";

// ── State ──────────────────────────────────────────────────────────
let sessionId = null;

// ── Init ───────────────────────────────────────────────────────────
initCytoscape("cy");

fetchLayouts()
  .then(({ layouts }) => populateLayouts(layouts))
  .catch(console.error);

// ── File upload ────────────────────────────────────────────────────
document.getElementById("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus("Loading…");
  try {
    const meta = await uploadGraph(file);
    sessionId = meta.session_id;
    setMeta(meta.node_count, meta.edge_count);
    enableControls(sessionId);

    const data = await fetchGraph(sessionId);
    renderElements(data.elements);
    setStatus("Graph loaded.");
  } catch (err) {
    setStatus(err.message, true);
  }
});

// ── Layout ─────────────────────────────────────────────────────────
document
  .getElementById("applyLayoutBtn")
  .addEventListener("click", async () => {
    if (!sessionId) return;
    const algo = document.getElementById("layoutSelect").value;
    setStatus("Computing layout…");
    try {
      const { positions } = await applyLayout(sessionId, algo);
      applyPositions(positions);
      setStatus(`Layout "${algo}" applied.`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

// ── Simplification ─────────────────────────────────────────────────
document.getElementById("simplifyBtn").addEventListener("click", async () => {
  if (!sessionId) return;
  const method = document.getElementById("methodSelect").value;
  const param = parseFloat(document.getElementById("paramInput").value);
  const params =
    method === "edge_weight"
      ? { min_weight: param }
      : method === "k_core"
        ? { k: Math.round(param) }
        : {};
  setStatus("Simplifying…");
  try {
    const result = await simplifyGraph(sessionId, method, params);
    setMeta(result.node_count, result.edge_count);
    renderElements(result.elements.elements);
    setStatus(
      `Done. ${result.node_count} nodes, ${result.edge_count} edges remain.`,
    );
  } catch (err) {
    setStatus(err.message, true);
  }
});
