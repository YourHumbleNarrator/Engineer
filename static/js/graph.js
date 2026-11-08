/**
 * graph.js — Cytoscape initialisation and render helpers.
 */

let cy = null;

const CY_STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "#5b8af5",
      label: "data(id)",
      color: "#d4d8e8",
      "font-size": "10px",
      "text-valign": "center",
      "text-halign": "center",
      width: 28,
      height: 28,
    },
  },
  {
    selector: "edge",
    style: {
      "line-color": "#2a2d3a",
      "target-arrow-color": "#2a2d3a",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      width: 1.5,
      label: "data(weight)",
      "font-size": "9px",
      color: "#636880",
    },
  },
  {
    selector: "node:selected",
    style: { "border-width": 2, "border-color": "#fff" },
  },
];

export function initCytoscape(containerId) {
  cy = window.cytoscape({
    container: document.getElementById(containerId),
    style: CY_STYLE,
    elements: [],
    layout: { name: "preset" },
  });
  return cy;
}

/** Replace all elements and run a named layout. */
export function renderElements(elements, layoutName = "preset") {
  cy.elements().remove();
  cy.add(elements);
  cy.layout({ name: layoutName, animate: true }).run();
  cy.fit(undefined, 40);
}

/** Update node positions from { nodeId: {x, y} } without re-adding edges. */
export function applyPositions(positions) {
  cy.batch(() => {
    for (const [id, pos] of Object.entries(positions)) {
      const node = cy.getElementById(id);
      if (node) node.position(pos);
    }
  });
  cy.fit(undefined, 40);
}
