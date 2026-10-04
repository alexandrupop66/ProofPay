import fs from "fs/promises";
import path from "path";
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
  await fs.writeFile(config.statePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

export async function resetState() {
  return saveState(freshState());
}

export function publicState(state) {
  return {
    ...state,
    labels: statusLabels,
    config: {
      webhookConfigured: Boolean(config.paypalWebhookId),
      openAiConfigured: Boolean(config.openAiApiKey),
      paypalConfigured: Boolean(config.paypalClientId && config.paypalClientSecret),
      appBaseUrl: config.appBaseUrl
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
        details
      },
      ...(state.events || [])
    ].slice(0, 30)
  };
}
