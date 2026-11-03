import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";
import { config } from "./config.js";

export const statusLabels = {
  AUTHORIZATION_REQUIRED: "AUTHORIZATION REQUIRED",
  AUTHORIZED: "AUTHORIZED",
  DELIVERABLE_SUBMITTED: "DELIVERABLE SUBMITTED",
  CHECKING: "CHECKING",
  PAYMENT_HELD: "PAYMENT HELD",
  VERIFIED: "VERIFIED",
  READY_FOR_APPROVAL: "READY FOR APPROVAL",
  CAPTURING: "CAPTURING",
  CAPTURED: "CAPTURED",
  VOIDED: "VOIDED"
};

export function freshState() {
  return {
    version: 1,
    status: "AUTHORIZATION_REQUIRED",
    updatedAt: new Date().toISOString(),
    agreement: {
      title: "Create a promotional image for Verdant Volt Coffee",
      amount: "25.00",
      currency: "GBP",
      criteria: [
        "PNG or JPG deliverable exists",
        "Image is at least 800 x 450 pixels",
        "File size is valid for review",
        "Prominently mentions sustainability",
        "Uses a professional promotional tone",
        "Includes the slogan: Brew Better. Waste Less.",
        "Does not contain: disposable plastic cups"
      ]
    },
    paypal: {
      orderId: null,
      authorizationId: null,
      captureId: null,
      captureRequestId: null,
      approvalUrl: null,
      pendingNonce: null,
      authorisedAt: null,
      capturedAt: null,
      voidedAt: null,
      webhookConfirmedAt: null,
      webhookVerified: false,
      lastWebhookEventId: null
    },
    submission: null,
    verification: {
      deterministic: [],
      ai: [],
      overall: "NOT_RUN",
      summary: "No deliverable has been checked yet.",
      checkedAt: null,
      error: null
    },
    events: []
  };
}

export async function ensureStateFile() {
  await fs.mkdir(path.dirname(config.statePath), { recursive: true });
  try {
    await fs.access(config.statePath);
  } catch {
    await saveState(freshState());
  }
}

export async function loadState() {
  await ensureStateFile();
  const raw = await fs.readFile(config.statePath, "utf8");
  return JSON.parse(raw);
}

export async function saveState(state) {
  const nextState = { ...state, updatedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(config.statePath), { recursive: true });
  const temporary = `${config.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(nextState, null, 2), { mode: 0o600 });
    await fs.rename(temporary, config.statePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return nextState;
}

export async function resetState() {
  return saveState(freshState());
}

// Single-process serialisation prevents competing requests and webhooks from
// overwriting one another. This prototype must run as ONE Node process.
let stateQueue = Promise.resolve();
export async function withStateLock(action) {
  const previous = stateQueue;
  let release;
  stateQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

const privateDetailKeys = /^(orderId|authorizationId|captureId|eventId|resourceId|pendingNonce|captureRequestId|approvalUrl|token|secret|password)$/i;

export function publicEventDetails(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return Object.fromEntries(Object.entries(details).map(([key, value]) =>
    [key, privateDetailKeys.test(key) ? "[redacted]" : value]
  ));
}

export function publicState(state) {
  return {
    status: state.status,
    updatedAt: state.updatedAt,
    agreement: state.agreement,
    paypal: {
      orderId: Boolean(state.paypal?.orderId),
      authorizationId: Boolean(state.paypal?.authorizationId),
      captureId: Boolean(state.paypal?.captureId),
      authorisedAt: state.paypal?.authorisedAt || null,
      capturedAt: state.paypal?.capturedAt || null,
      voidedAt: state.paypal?.voidedAt || null,
      webhookConfirmedAt: state.paypal?.webhookConfirmedAt || null,
      webhookVerified: Boolean(state.paypal?.webhookVerified)
    },
    submission: state.submission
      ? { fileName: state.submission.fileName, submittedAt: state.submission.submittedAt }
      : null,
    verification: state.verification,
    events: (state.events || []).map((event) => ({
      at: event.at, label: event.label, details: publicEventDetails(event.details)
    })),
    labels: statusLabels,
    config: {
      webhookConfigured: Boolean(config.paypalWebhookId),
      openAiConfigured: Boolean(config.openAiApiKey),
      paypalConfigured: Boolean(config.paypalClientId && config.paypalClientSecret)
    }
  };
}

export function addEvent(state, label, details = {}) {
  return {
    ...state,
    events: [
      {
        at: new Date().toISOString(),
        label,
        details: publicEventDetails(details)
      },
      ...(state.events || [])
    ].slice(0, 30)
  };
}
