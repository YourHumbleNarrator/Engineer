/**
 * ui.js — small helpers for updating DOM state.
 */

export function setMeta(nodeCount, edgeCount) {
  document.getElementById("graphMeta").textContent =
    `${nodeCount} nodes · ${edgeCount} edges`;
}

export function setStatus(msg, isError = false) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className = "panel__status" + (isError ? " error" : "");
}

export function enableControls(sessionId) {
  document.getElementById("layoutSelect").disabled = false;
  document.getElementById("applyLayoutBtn").disabled = false;
  document.getElementById("methodSelect").disabled = false;
  document.getElementById("paramInput").disabled = false;
  document.getElementById("simplifyBtn").disabled = false;
}

export function populateLayouts(layouts) {
  const select = document.getElementById("layoutSelect");
  select.innerHTML = "";
  for (const name of layouts) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}
