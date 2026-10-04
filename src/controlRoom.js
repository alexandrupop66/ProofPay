function resultFromChecks(checks = []) {
  if (!checks.length) return "NOT RUN";
  return checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
}

function humanDecision(state) {
  if (state.paypal?.voidedAt || state.status === "VOIDED") return "REJECTED";
  if (state.paypal?.captureId || state.status === "CAPTURING" || state.status === "CAPTURED") return "APPROVED";
  return "PENDING";
}

function paymentState(state) {
  if (state.status === "VOIDED") return "VOIDED";
  if (state.status === "CAPTURED") return "CAPTURED";
  if (state.status === "CAPTURING") return "CAPTURING";
  if (state.status === "PAYMENT_HELD") return "HELD";
  if (state.paypal?.authorizationId) return "AUTHORIZED";
  if (state.paypal?.orderId) return "AUTHORIZATION REQUIRED";
  return "NOT STARTED";
}

function captureVoidState(state) {
  if (state.paypal?.voidedAt || state.status === "VOIDED") return "VOIDED";
  if (state.paypal?.webhookConfirmedAt || state.status === "CAPTURED") return "CAPTURED";
  if (state.paypal?.captureId || state.status === "CAPTURING") return "CAPTURE REQUESTED";
  if (state.paypal?.authorizationId) return "UNCAPTURED AUTHORIZATION";
  return "NONE";
}

function lastEvent(state) {
  return state.events?.[0]?.label || "No events yet";
}

function lastEventAt(state) {
  return state.events?.[0]?.at || state.updatedAt;
}

function latestSubmissionType(state) {
  const submitted = state.events?.find((event) => event.label === "Deliverable submitted");
  return submitted?.details?.fileName?.includes("corrected") ? "CORRECTED" : submitted ? "INITIAL" : "NONE";
}

function currencyAmount(state) {
  const amount = Number(state.agreement?.amount || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function amountLabel(state) {
  return `${state.agreement?.currency || "GBP"} ${state.agreement?.amount || "0.00"}`;
}

function buildJobRow(state) {
  const deterministicResult = resultFromChecks(state.verification?.deterministic);
  const aiSemanticResult = resultFromChecks(state.verification?.ai);
  const captureState = captureVoidState(state);
  const updatedAt = lastEventAt(state);

  return {
    id: state.paypal?.orderId || "proofpay-demo",
    job: state.agreement?.title || "ProofPay demo transaction",
    amount: amountLabel(state),
    amountValue: currencyAmount(state),
    paypalState: paymentState(state),
    verificationState: state.verification?.overall || "NOT_RUN",
    deterministicResult,
    aiSemanticResult,
    humanDecision: humanDecision(state),
    captureVoidState: captureState,
    lastEvent: lastEvent(state),
    updatedAt,
    updatedAtLabel: updatedAt ? new Date(updatedAt).toLocaleString("en-GB") : "",
    orderId: state.paypal?.orderId || "",
    authorizationPresent: Boolean(state.paypal?.authorizationId),
    capturePresent: Boolean(state.paypal?.captureId),
    webhookVerified: Boolean(state.paypal?.webhookVerified),
    submission: latestSubmissionType(state)
  };
}

function buildCards(row) {
  return {
    authorised: row.authorizationPresent && !row.capturePresent && row.captureVoidState !== "VOIDED" ? row.amountValue : 0,
    held: row.paypalState === "HELD" ? row.amountValue : 0,
    captured: row.captureVoidState === "CAPTURED" ? row.amountValue : 0,
    voided: row.captureVoidState === "VOIDED" ? row.amountValue : 0,
    exceptions: row.paypalState === "HELD" || row.verificationState === "FAIL" ? 1 : 0
  };
}

function buildAuditEvents(state) {
  return (state.events || []).map((event, index) => ({
    id: `${event.at}-${index}`,
    at: event.at,
    atLabel: new Date(event.at).toLocaleString("en-GB"),
    event: event.label,
    details: event.details || {},
    severity: event.label.includes("failed") || event.label.includes("held") ? "attention" : "normal"
  }));
}

export function buildControlRoomPayload(state) {
  const row = buildJobRow(state);
  return {
    rows: [row],
    cards: buildCards(row),
    audit: {
      selectedJobId: row.id,
      events: buildAuditEvents(state)
    },
    updatedAt: state.updatedAt
  };
}
