/**
 * api.js — thin wrappers around the Flask API endpoints.
 * All functions return parsed JSON or throw on HTTP error.
 */

async function _request(url, options = {}) {
  const res = await fetch(url, options);

  // Always read as text first. Calling res.json() directly throws an
  // unhelpful "Unexpected token '<'" when the server returns an HTML error
  // page (Flask 500, proxy error, app startup failure, etc.).
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Server returned non-JSON — surface the status and the first line of
    // the body so the problem is immediately visible in the UI.
    const preview =
      text.split("\n").find((l) => l.trim()) ?? text.slice(0, 120);
    throw new Error(
      `HTTP ${res.status}: server returned non-JSON response — ${preview}`,
    );
  }

  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function uploadGraph(file) {
  const form = new FormData();
  form.append("file", file);
  return _request("/api/upload", { method: "POST", body: form });
}

export async function fetchGraph(sessionId) {
  return _request(`/api/graph/${sessionId}`);
}

export async function fetchLayouts() {
  return _request("/api/layouts");
}

export async function applyLayout(sessionId, algorithm) {
  return _request(`/api/layout/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ algorithm }),
  });
}

export async function simplifyGraph(sessionId, method, params = {}) {
  return _request(`/api/simplify/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
}
