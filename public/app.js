const stateOrder = [
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZED",
  "DELIVERABLE_SUBMITTED",
  "CHECKING",
  "PAYMENT_HELD",
  "VERIFIED",
  "CAPTURING",
  "CAPTURED"
];

const stepLabels = [
  "Agreement",
  "PayPal authorised",
  "Deliverable submitted",
  "AI semantic failure",
  "Payment held",
  "Corrected and verified",
  "Approve & Pay",
  "Webhook captured"
];

const els = {
  steps: document.querySelector("#steps"),
  statusPill: document.querySelector("#statusPill"),
  paymentNote: document.querySelector("#paymentNote"),
  amountDisplay: document.querySelector("#amountDisplay"),
  jobTitle: document.querySelector("#jobTitle"),
  paymentAmount: document.querySelector("#paymentAmount"),
  criteriaList: document.querySelector("#criteriaList"),
  authorizeButton: document.querySelector("#authorizeButton"),
  failedDemoButton: document.querySelector("#failedDemoButton"),
  correctedDemoButton: document.querySelector("#correctedDemoButton"),
  imageInput: document.querySelector("#imageInput"),
  visibleText: document.querySelector("#visibleText"),
  supplierNotes: document.querySelector("#supplierNotes"),
  previewImage: document.querySelector("#previewImage"),
  submitButton: document.querySelector("#submitButton"),
  verifyButton: document.querySelector("#verifyButton"),
  deterministicChecks: document.querySelector("#deterministicChecks"),
  aiChecks: document.querySelector("#aiChecks"),
  captureButton: document.querySelector("#captureButton"),
  voidButton: document.querySelector("#voidButton"),
  approvalHeading: document.querySelector("#approvalHeading"),
  approvalCopy: document.querySelector("#approvalCopy"),
  events: document.querySelector("#events"),
  resetButton: document.querySelector("#resetButton"),
  toast: document.querySelector("#toast")
};

let currentState = null;
let selectedImageDataUrl = "";
let selectedFileName = "verdant-volt.png";

function initSteps() {
  els.steps.innerHTML = stepLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.verification?.error || `Request failed with HTTP ${response.status}`);
  return body;
}

async function refresh() {
  currentState = await api("/api/state");
  render(currentState);
}

function render(state) {
  const statusText = state.labels[state.status] || state.status;
  els.statusPill.textContent = statusText;
  els.statusPill.className = `status-pill ${statusClass(state.status, state.verification?.overall)}`;
  els.paymentNote.textContent = paymentNote(state);
  els.amountDisplay.textContent = `${state.agreement.currency} ${state.agreement.amount}`;
  els.jobTitle.value = state.agreement.title;
  els.paymentAmount.value = state.agreement.amount;

  els.criteriaList.innerHTML = state.agreement.criteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("");
  renderSteps(state);
  renderChecks(els.deterministicChecks, state.verification.deterministic);
  renderChecks(els.aiChecks, state.verification.ai);
  renderEvents(state.events || []);

  const hasAuth = Boolean(state.paypal.authorizationId);
  const verified = state.verification.overall === "PASS" && state.status === "VERIFIED";
  els.authorizeButton.disabled = Boolean(state.paypal.authorizationId || state.paypal.orderId);
  els.submitButton.disabled = !hasAuth || !selectedImageDataUrl;
  els.verifyButton.disabled = !hasAuth || !state.submission || state.status === "CHECKING";
  els.captureButton.disabled = !verified;
  els.voidButton.disabled = !hasAuth || Boolean(state.paypal.captureId || state.paypal.voidedAt || state.status === "CAPTURED");

  els.approvalHeading.textContent = approvalHeading(state);
  els.approvalCopy.textContent = approvalCopy(state);
}

function renderSteps(state) {
  const nodes = [...els.steps.children];
  const activeIndex = activeStepIndex(state);
  nodes.forEach((node, index) => {
    node.classList.toggle("active", index <= activeIndex);
  });
}

function activeStepIndex(state) {
  if (state.status === "CAPTURED") return 7;
  if (state.status === "CAPTURING") return 6;
  if (state.status === "VERIFIED") return 5;
  if (state.status === "PAYMENT_HELD") return 4;
  if (state.verification?.overall === "FAIL") return 3;
  if (state.status === "DELIVERABLE_SUBMITTED" || state.status === "CHECKING") return 2;
  if (state.status === "AUTHORIZED") return 1;
  return 0;
}

function statusClass(status, overall) {
  if (["VERIFIED", "CAPTURED"].includes(status)) return "pass";
  if (["PAYMENT_HELD", "VOIDED"].includes(status) || overall === "FAIL") return "fail";
  if (["AUTHORIZED", "CHECKING", "CAPTURING"].includes(status)) return "info";
  return "";
}

function paymentNote(state) {
  if (state.status === "CAPTURED") return "Webhook confirmed the PayPal capture.";
  if (state.status === "CAPTURING") return "Capture sent to PayPal; waiting for webhook confirmation.";
  if (state.status === "VOIDED") return "The uncaptured authorization was voided and funds were released.";
  if (state.status === "PAYMENT_HELD") return "Payment is authorised but not captured.";
  if (state.status === "VERIFIED") return "Verified. Buyer approval is required before capture.";
  if (state.paypal.authorizationId) return "PayPal payment is authorised, not captured.";
  return "Buyer authorization is required before work can be paid.";
}

function approvalHeading(state) {
  if (state.status === "VERIFIED") return "Ready for approval";
  if (state.status === "PAYMENT_HELD") return "Payment held";
  if (state.status === "CAPTURING") return "Capture submitted";
  if (state.status === "CAPTURED") return "Captured by PayPal";
  if (state.status === "VOIDED") return "Authorization voided";
  return "Verification required before payment capture";
}

function approvalCopy(state) {
  if (state.status === "VERIFIED") return "The buyer can now approve the payment capture, or reject and void the authorization.";
  if (state.status === "PAYMENT_HELD") return "At least one criterion failed. The authorization remains uncaptured.";
  if (state.status === "CAPTURING") return "ProofPay has requested capture after explicit buyer approval.";
  if (state.status === "CAPTURED") return "PayPal sent PAYMENT.CAPTURE.COMPLETED and ProofPay verified the webhook signature when configured.";
  if (state.status === "VOIDED") return "The supplier was not paid because the buyer rejected the deliverable.";
  return "ProofPay can only capture after verification passes and the buyer clicks Approve & Pay.";
}

function renderChecks(container, checks) {
  if (!checks?.length) {
    container.innerHTML = `<div class="check-item"><p>No result yet.</p></div>`;
    return;
  }
  container.innerHTML = checks.map((check) => `
    <div class="check-item">
      <div class="check-top">
        <strong>${escapeHtml(check.criterion)}</strong>
        <span class="mini-status ${check.status === "PASS" ? "pass" : "fail"}">${escapeHtml(check.status)}</span>
      </div>
      <p>${escapeHtml(check.reasoning)}</p>
      <div class="evidence">${escapeHtml(check.evidence)}</div>
    </div>
  `).join("");
}

function renderEvents(events) {
  if (!events.length) {
    els.events.innerHTML = `<div class="event"><strong>No events yet.</strong></div>`;
    return;
  }
  els.events.innerHTML = events.map((event) => `
    <div class="event">
      <time>${new Date(event.at).toLocaleString()}</time>
      <div>
        <strong>${escapeHtml(event.label)}</strong>
        <code>${escapeHtml(JSON.stringify(event.details || {}, null, 2))}</code>
      </div>
    </div>
  `).join("");
}

function getAgreementPayload() {
  return {
    title: els.jobTitle.value,
    amount: els.paymentAmount.value
  };
}

function getSubmissionPayload() {
  return {
    fileName: selectedFileName,
    imageDataUrl: selectedImageDataUrl,
    visibleText: els.visibleText.value,
    notes: els.supplierNotes.value
  };
}

async function drawDemoImage(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext("2d");
  const corrected = kind === "corrected";

  ctx.fillStyle = "#f8fbf4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#15362d";
  ctx.fillRect(0, 0, 460, canvas.height);
  ctx.fillStyle = "#2bb178";
  ctx.fillRect(62, 72, 250, 250);
  ctx.fillStyle = "#f8fbf4";
  ctx.beginPath();
  ctx.arc(187, 197, 86, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#15362d";
  ctx.font = "700 58px Arial";
  ctx.fillText("VV", 123, 218);
  ctx.fillStyle = "#f6cf65";
  ctx.fillRect(74, 392, 300, 18);
  ctx.fillRect(74, 430, 220, 18);

  ctx.fillStyle = "#15362d";
  ctx.font = "800 70px Arial";
  ctx.fillText("Verdant Volt Coffee", 520, 128);
  ctx.font = "700 46px Arial";
  ctx.fillText("Brew Better. Waste Less.", 520, 210);
  ctx.fillStyle = "#2b5f51";
  ctx.font = "34px Arial";
  wrapText(ctx, "Carbon-conscious beans for a brighter morning.", 520, 292, 590, 42);
  ctx.fillStyle = corrected ? "#0b7f67" : "#b42318";
  ctx.font = "700 36px Arial";
  wrapText(ctx, corrected ? "Reusable cup program included." : "Disposable plastic cups included.", 520, 438, 590, 44);
  ctx.fillStyle = "#18212b";
  ctx.font = "28px Arial";
  ctx.fillText("Sustainable launch campaign", 520, 594);

  selectedImageDataUrl = canvas.toDataURL("image/png");
  selectedFileName = corrected ? "verdant-volt-corrected.png" : "verdant-volt-failing.png";
  els.previewImage.src = selectedImageDataUrl;
  els.visibleText.value = corrected
    ? "Verdant Volt Coffee. Brew Better. Waste Less. Carbon-conscious beans for a brighter morning. Reusable cup program included. Sustainable launch campaign."
    : "Verdant Volt Coffee. Brew Better. Waste Less. Carbon-conscious beans for a brighter morning. Disposable plastic cups included. Sustainable launch campaign.";
  els.supplierNotes.value = corrected
    ? "Corrected promotional image for an eco-friendly coffee brand. The creative removes disposable plastic and uses a reusable cup program."
    : "First promotional image draft. The layout is polished and sustainability is visible, but the image still mentions disposable plastic cups.";
  render(currentState);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const testLine = `${line}${word} `;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = `${word} `;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

function readUploadedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

async function runAction(label, action) {
  try {
    setBusy(true);
    await action();
    await refresh();
  } catch (error) {
    toast(error.message);
    await refresh().catch(() => {});
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  document.body.classList.toggle("busy", busy);
}

els.authorizeButton.addEventListener("click", () => runAction("authorize", async () => {
  const result = await api("/api/paypal/create-order", {
    method: "POST",
    body: JSON.stringify({ agreement: getAgreementPayload() })
  });
  window.location.href = result.approvalUrl;
}));

els.failedDemoButton.addEventListener("click", () => drawDemoImage("failed"));
els.correctedDemoButton.addEventListener("click", () => drawDemoImage("corrected"));

els.imageInput.addEventListener("change", async () => {
  const file = els.imageInput.files?.[0];
  if (!file) return;
  selectedImageDataUrl = await readUploadedImage(file);
  selectedFileName = file.name;
  els.previewImage.src = selectedImageDataUrl;
  render(currentState);
});

els.submitButton.addEventListener("click", () => runAction("submit", async () => {
  await api("/api/submission", {
    method: "POST",
    body: JSON.stringify(getSubmissionPayload())
  });
}));

els.verifyButton.addEventListener("click", () => runAction("verify", async () => {
  await api("/api/verify", { method: "POST", body: "{}" });
}));

els.captureButton.addEventListener("click", () => runAction("capture", async () => {
  await api("/api/paypal/capture", { method: "POST", body: "{}" });
}));

els.voidButton.addEventListener("click", () => runAction("void", async () => {
  await api("/api/paypal/void", { method: "POST", body: "{}" });
}));

els.resetButton.addEventListener("click", () => runAction("reset", async () => {
  selectedImageDataUrl = "";
  selectedFileName = "verdant-volt.png";
  els.previewImage.removeAttribute("src");
  els.visibleText.value = "";
  els.supplierNotes.value = "";
  await api("/api/reset", { method: "POST", body: "{}" });
}));

initSteps();
await refresh();
setInterval(refresh, 4000);
