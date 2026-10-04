const currency = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP"
});

const els = {
  grid: document.querySelector("#jobsGrid"),
  refreshChip: document.querySelector("#refreshChip"),
  authorisedValue: document.querySelector("#authorisedValue"),
  heldValue: document.querySelector("#heldValue"),
  capturedValue: document.querySelector("#capturedValue"),
  voidedValue: document.querySelector("#voidedValue"),
  exceptionCount: document.querySelector("#exceptionCount"),
  auditEvents: document.querySelector("#auditEvents"),
  selectedJobTitle: document.querySelector("#selectedJobTitle"),
  selectedDetails: document.querySelector("#selectedDetails"),
  quickFilter: document.querySelector("#quickFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  agentFilter: document.querySelector("#agentFilter"),
  agentFilterButton: document.querySelector("#agentFilterButton"),
  clearFiltersButton: document.querySelector("#clearFiltersButton")
};

let gridApi;
let latestPayload = null;
let selectedJobId = null;

const columnDefs = [
  { field: "job", headerName: "Job", minWidth: 280, flex: 1.4 },
  { field: "amount", headerName: "Amount", width: 120 },
  { field: "paypalState", headerName: "PayPal state", width: 150, cellRenderer: statusRenderer },
  { field: "verificationState", headerName: "Verification state", width: 170, cellRenderer: statusRenderer },
  { field: "deterministicResult", headerName: "Deterministic result", width: 180, cellRenderer: statusRenderer },
  { field: "aiSemanticResult", headerName: "AI semantic result", width: 170, cellRenderer: statusRenderer },
  { field: "humanDecision", headerName: "Human decision", width: 160, cellRenderer: statusRenderer },
  { field: "captureVoidState", headerName: "Capture/Void state", width: 190, cellRenderer: statusRenderer },
  { field: "lastEvent", headerName: "Last event", minWidth: 230, flex: 1 },
  { field: "updatedAtLabel", headerName: "Updated time", width: 190, sort: "desc" }
];

const gridOptions = {
  theme: "legacy",
  columnDefs,
  rowData: [],
  rowSelection: { mode: "singleRow" },
  animateRows: true,
  pagination: false,
  suppressNoRowsOverlay: true,
  defaultColDef: {
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true
  },
  getRowId: (params) => params.data.id,
  onGridReady: (event) => {
    gridApi = event.api;
    refresh();
  },
  onRowSelected: (event) => {
    if (event.node.isSelected()) {
      selectedJobId = event.data.id;
      renderSelection(event.data);
    }
  },
  onFirstDataRendered: (event) => {
    event.api.sizeColumnsToFit();
    selectCurrentRow();
  }
};

if (window.agGrid?.ModuleRegistry && window.agGrid?.AllCommunityModule) {
  window.agGrid.ModuleRegistry.registerModules([window.agGrid.AllCommunityModule]);
}

window.agGrid.createGrid(els.grid, gridOptions);

els.quickFilter.addEventListener("input", applyFilters);
els.statusFilter.addEventListener("change", applyFilters);
els.agentFilterButton.addEventListener("click", applyAgentFilter);
els.agentFilter.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyAgentFilter();
});
els.clearFiltersButton.addEventListener("click", clearFilters);

async function refresh() {
  const response = await fetch("/api/control-room");
  latestPayload = await response.json();

  renderCards(latestPayload.cards);
  els.refreshChip.textContent = `Updated ${new Date(latestPayload.updatedAt).toLocaleTimeString("en-GB")}`;
  gridApi.setGridOption("rowData", latestPayload.rows);
  applyFilters();
  selectCurrentRow();
}

function renderCards(cards) {
  els.authorisedValue.textContent = currency.format(cards.authorised || 0);
  els.heldValue.textContent = currency.format(cards.held || 0);
  els.capturedValue.textContent = currency.format(cards.captured || 0);
  els.voidedValue.textContent = currency.format(cards.voided || 0);
  els.exceptionCount.textContent = String(cards.exceptions || 0);
}

function applyFilters() {
  const quickFilter = els.quickFilter.value.trim();
  const statusFilter = els.statusFilter.value.trim();

  gridApi.setGridOption("quickFilterText", quickFilter);
  gridApi.setFilterModel(statusFilter
    ? { paypalState: { filterType: "text", type: "equals", filter: statusFilter } }
    : null);
  selectCurrentRow();
}

function applyAgentFilter() {
  const text = els.agentFilter.value.trim().toLowerCase();
  if (!text) return;

  if (text.includes("held") && (text.includes("semantic") || text.includes("ai")) && (text.includes("fail") || text.includes("failed"))) {
    els.quickFilter.value = "FAIL";
    els.statusFilter.value = "HELD";
  } else if (text.includes("captured")) {
    els.quickFilter.value = "";
    els.statusFilter.value = "CAPTURED";
  } else if (text.includes("voided") || text.includes("rejected")) {
    els.quickFilter.value = "";
    els.statusFilter.value = "VOIDED";
  } else if (text.includes("authorized") || text.includes("authorised")) {
    els.quickFilter.value = "";
    els.statusFilter.value = "AUTHORIZED";
  } else {
    els.quickFilter.value = text;
    els.statusFilter.value = "";
  }

  applyFilters();
}

function clearFilters() {
  els.quickFilter.value = "";
  els.statusFilter.value = "";
  els.agentFilter.value = "";
  gridApi.setFilterModel(null);
  applyFilters();
}

function selectCurrentRow() {
  if (!latestPayload?.rows?.length) return;
  const idToSelect = selectedJobId || latestPayload.rows[0].id;
  const node = gridApi.getRowNode(idToSelect) || gridApi.getDisplayedRowAtIndex(0);
  if (node) {
    node.setSelected(true);
    renderSelection(node.data);
  }
}

function renderSelection(row) {
  els.selectedJobTitle.textContent = row.job;
  els.selectedDetails.innerHTML = [
    ["PayPal state", row.paypalState],
    ["Verification", row.verificationState],
    ["Deterministic", row.deterministicResult],
    ["AI semantic", row.aiSemanticResult],
    ["Human decision", row.humanDecision],
    ["Capture/Void", row.captureVoidState],
    ["Webhook verified", row.webhookVerified ? "Yes" : "No"],
    ["Order", row.orderId || "Not created"]
  ].map(([term, description]) => `
    <div>
      <dt>${escapeHtml(term)}</dt>
      <dd>${escapeHtml(description)}</dd>
    </div>
  `).join("");
  renderAudit(latestPayload.audit.events);
}

function renderAudit(events) {
  if (!events.length) {
    els.auditEvents.innerHTML = `<div class="audit-event"><strong>No audit events yet.</strong></div>`;
    return;
  }

  els.auditEvents.innerHTML = events.map((event) => `
    <div class="audit-event ${event.severity === "attention" ? "attention" : ""}">
      <time>${escapeHtml(event.atLabel)}</time>
      <strong>${escapeHtml(event.event)}</strong>
      <code>${escapeHtml(JSON.stringify(event.details, null, 2))}</code>
    </div>
  `).join("");
}

function statusRenderer(params) {
  const value = String(params.value || "NONE");
  const className = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<span class="status-cell status-${className}">${escapeHtml(value)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

setInterval(refresh, 3000);
