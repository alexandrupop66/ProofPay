import express from "express";
import crypto from "node:crypto";
import { installSecurity } from "./security.js";
import path from "path";
import { config, missingConfig, safeError } from "./config.js";
import { addEvent, loadState, publicState, resetState, saveState, withStateLock } from "./state.js";
import {
  authorizeOrder, captureAuthorization, createAuthorizeOrder, PayPalEvidenceError,
  reconcileAuthorization, reconcileCapture, verifyWebhookSignature, voidAuthorization
} from "./paypal.js";
import { runAiVerification, runDeterministicChecks, semanticCriteria } from "./verification.js";
import { buildControlRoomPayload } from "./controlRoom.js";

export function createApp() {
  const app = express();

  app.post("/webhooks/paypal", express.raw({ type: "application/json", limit: "1mb" }), handlePaypalWebhook);
  app.use(express.json({ limit: "8mb" }));
  const security = installSecurity(app);
  app.use("/vendor/ag-grid", express.static(path.resolve("node_modules", "ag-grid-community")));
  app.use(express.static(config.publicDir));
  app.use("/api", security.requireUser, security.requireCsrf);

  app.get("/api/state", async (_req, res) => {
    res.json(publicState(await loadState()));
  });

  app.get("/api/config-check", (_req, res) => {
    res.json({ missing: missingConfig() });
  });

  app.get("/api/control-room", async (_req, res) => {
    res.json(buildControlRoomPayload(await loadState()));
  });

  app.post("/api/reset", async (_req, res) => withStateLock(async () => {
    const current = await loadState();
    if (current.status === "AUTHORIZING") {
      return res.status(409).json({ error: "Reconcile the uncertain PayPal authorisation before resetting the demo." });
    }
    if (current.paypal.authorizationId && !["CAPTURED", "VOIDED"].includes(current.status)) {
      return res.status(409).json({ error: "Void the active authorisation before resetting the demo." });
    }
    const state = addEvent(await resetState(), "Demo reset");
    res.json(publicState(await saveState(state)));
  }));

  app.post("/api/paypal/create-order", async (req, res) => withStateLock(async () => {
    try {
      const missing = missingConfig().filter((item) => item !== "OPENAI_API_KEY");
      if (missing.length) return res.status(400).json({ error: `Missing PayPal configuration: ${missing.join(", ")}` });

      const state = await loadState();
      if (state.status !== "AUTHORIZATION_REQUIRED" || state.paypal.orderId || state.paypal.authorizationId) {
        return res.status(409).json({ error: "Reset or complete the current payment before creating another order." });
      }
      const agreement = sanitizeAgreement(req.body?.agreement, state.agreement);
      const order = await createAuthorizeOrder(agreement);

      const nextState = await saveState(addEvent({
        ...state,
        status: "AUTHORIZATION_REQUIRED",
        agreement,
        paypal: {
          ...state.paypal,
          ...order,
          authorizationId: null,
          authorizationRequestId: null,
          authorizationOutcome: "NONE",
          captureId: null,
          captureRequestId: null,
          authorisedAt: null,
          capturedAt: null,
          voidedAt: null,
          webhookConfirmedAt: null,
          webhookVerified: false,
          processedWebhookEventIds: [],
          captureOutcome: "NONE"
        }
      }, "PayPal authorisation order created", { orderId: order.orderId }));

      res.json({ approvalUrl: order.approvalUrl, state: publicState(nextState) });
    } catch (error) {
      res.status(500).json({ error: safeError(error) });
    }
  }));

  app.get("/paypal/return", security.requireUser, async (req, res) => withStateLock(async () => {
    let state = await loadState();
    try {
      const token = String(req.query.token || "");
      const nonce = String(req.query.nonce || "");
      if (!token || state.status !== "AUTHORIZATION_REQUIRED" || state.paypal.authorizationId ||
        token !== state.paypal.orderId || !nonce || nonce !== state.paypal.pendingNonce) {
        res.redirect("/?paypal=return-rejected");
        return;
      }

      state = await saveState(addEvent({
        ...state,
        status: "AUTHORIZING",
        paypal: {
          ...state.paypal,
          authorizationRequestId: crypto.randomUUID(),
          authorizationOutcome: "PENDING"
        }
      }, "PayPal authorisation submitted"));
      const authorization = await authorizeOrder(token, state.agreement, state.paypal.authorizationRequestId);
      await saveState(addEvent({
        ...state,
        status: "AUTHORIZED",
        paypal: {
          ...state.paypal,
          authorizationId: authorization.authorizationId,
          authorizationOutcome: "CONFIRMED",
          authorisedAt: new Date().toISOString(),
          pendingNonce: null
        }
      }, "PayPal payment authorised", {
        orderId: token,
        authorizationId: authorization.authorizationId,
        paypalStatus: authorization.paypalStatus
      }));

      res.redirect("/?paypal=authorized");
    } catch (error) {
      state = await loadState();
      if (state.status === "AUTHORIZING") {
        await saveState(addEvent({
          ...state,
          paypal: { ...state.paypal, authorizationOutcome: "UNCERTAIN" }
        }, "PayPal authorisation outcome uncertain; reconciliation required", { error: safeError(error) }));
      }
      res.redirect("/?paypal=authorize-error");
    }
  }));

  app.get("/paypal/cancel", security.requireUser, async (req, res) => withStateLock(async () => {
    const state = await loadState();
    if (!req.query.nonce || req.query.nonce !== state.paypal.pendingNonce) {
      return res.redirect("/?paypal=cancel-rejected");
    }
    await saveState(addEvent(state, "Buyer cancelled PayPal approval"));
    res.redirect("/?paypal=cancelled");
  }));

  app.post("/api/submission", async (req, res) => withStateLock(async () => {
    try {
      const state = await loadState();
      if (!state.paypal.authorizationId || state.paypal.voidedAt || state.paypal.captureId ||
        !["AUTHORIZED", "DELIVERABLE_SUBMITTED", "PAYMENT_HELD", "VERIFIED"].includes(state.status)) {
        return res.status(409).json({ error: "A current, uncaptured PayPal authorisation is required for submission." });
      }
      const submission = sanitizeSubmission(req.body);
      const nextState = await saveState(addEvent({
        ...state,
        status: "DELIVERABLE_SUBMITTED",
        submission,
        verification: {
          deterministic: [],
          ai: [],
          overall: "NOT_RUN",
          summary: "Deliverable received. Verification is ready to run.",
          checkedAt: null,
          error: null
        }
      }, "Deliverable submitted", { fileName: submission.fileName }));
      res.json(publicState(nextState));
    } catch (error) {
      res.status(400).json({ error: safeError(error) });
    }
  }));

  app.post("/api/verify", async (_req, res) => withStateLock(async () => {
    let state = await loadState();
    try {
      if (!state.paypal.authorizationId || state.paypal.voidedAt || state.paypal.captureId ||
        state.status !== "DELIVERABLE_SUBMITTED") {
        return res.status(409).json({ error: "Only a newly submitted deliverable on an active authorisation can be verified." });
      }
      if (!state.submission) return res.status(400).json({ error: "Submit a deliverable before verification." });

      state = await saveState(addEvent({ ...state, status: "CHECKING" }, "Verification started"));
      const deterministic = runDeterministicChecks(state.submission);

      if (!deterministic.pass) {
        const nextState = await saveState(addEvent({
          ...state,
          status: "PAYMENT_HELD",
          verification: {
            deterministic: deterministic.checks,
            ai: [],
            overall: "FAIL",
            summary: "Deterministic checks failed. Payment remains authorised and not captured.",
            checkedAt: new Date().toISOString(),
            error: null
          }
        }, "Payment held after deterministic failure"));
        res.json(publicState(nextState));
        return;
      }

      const ai = await runAiVerification(state.submission, state.agreement);
      const verified = deterministic.pass && ai.pass;
      const nextState = await saveState(addEvent({
        ...state,
        status: verified ? "VERIFIED" : "PAYMENT_HELD",
        verification: {
          deterministic: deterministic.checks,
          ai: ai.checks,
          overall: verified ? "PASS" : "FAIL",
          summary: verified
            ? "All criteria passed. Human approval is required before capture."
            : `${ai.summary} Payment remains authorised and not captured.`,
          checkedAt: new Date().toISOString(),
          error: null
        }
      }, verified ? "Deliverable verified" : "Payment held after semantic failure"));

      res.json(publicState(nextState));
    } catch (error) {
      const nextState = await saveState(addEvent({
        ...state,
        status: "PAYMENT_HELD",
        verification: {
          ...state.verification,
          overall: "FAIL",
          summary: "Verification could not complete. Payment remains authorised and not captured.",
          checkedAt: new Date().toISOString(),
          error: safeError(error)
        }
      }, "Verification error", { error: safeError(error) }));
      res.status(500).json(publicState(nextState));
    }
  }));

  app.post("/api/paypal/reconcile", async (_req, res) => withStateLock(async () => {
    const state = await loadState();
    try {
      if (state.status === "AUTHORIZING" && !state.paypal.authorizationId) {
        const authorization = await reconcileAuthorization({
          orderId: state.paypal.orderId,
          amount: state.agreement.amount,
          currency: state.agreement.currency
        });
        const nextState = await saveState(addEvent({
          ...state,
          status: "AUTHORIZED",
          paypal: {
            ...state.paypal,
            authorizationId: authorization.authorizationId,
            authorizationOutcome: "CONFIRMED",
            authorisedAt: new Date().toISOString(),
            pendingNonce: null
          }
        }, "PayPal authorisation confirmed by read-only reconciliation", {
          paypalStatus: authorization.paypalStatus
        }));
        return res.json(publicState(nextState));
      }

      if (state.status === "CAPTURING" && state.paypal.authorizationId) {
        const capture = await reconcileCapture({
          orderId: state.paypal.orderId,
          authorizationId: state.paypal.authorizationId,
          captureId: state.paypal.captureId,
          amount: state.agreement.amount,
          currency: state.agreement.currency
        });
        const nextState = await saveState(addEvent({
          ...state,
          status: "CAPTURED",
          paypal: {
            ...state.paypal,
            captureId: capture.captureId,
            captureOutcome: "CONFIRMED",
            capturedAt: new Date().toISOString()
          }
        }, "PayPal capture confirmed by read-only reconciliation", {
          paypalStatus: capture.paypalStatus
        }));
        return res.json(publicState(nextState));
      }

      return res.status(409).json({ error: "No uncertain PayPal result is available to reconcile." });
    } catch (error) {
      const status = error instanceof PayPalEvidenceError ? 409 : 502;
      return res.status(status).json({ error: safeError(error) });
    }
  }));

  app.post("/api/paypal/capture", async (req, res) => withStateLock(async () => {
    let state = await loadState();
    try {
      if (req.body?.approve !== true) return res.status(400).json({ error: "Explicit buyer approval is required." });
      if (!state.paypal.authorizationId || !state.paypal.authorisedAt) return res.status(400).json({ error: "No PayPal authorisation is available to capture." });
      if (state.paypal.captureId || state.paypal.voidedAt ||
        state.verification.overall !== "PASS" ||
        state.verification.deterministic?.length !== 3 ||
        !state.verification.deterministic.every((check) => check.status === "PASS") ||
        !hasExactPassingAiCriteria(state.verification.ai) ||
        state.status !== "VERIFIED") {
        return res.status(409).json({ error: "Capture is blocked until verification passes and the buyer approves." });
      }

      state = await saveState(addEvent({
        ...state,
        status: "CAPTURING",
        paypal: { ...state.paypal, captureRequestId: crypto.randomUUID(), captureOutcome: "PENDING" }
      }, "Buyer clicked Approve & Pay"));
      const capture = await captureAuthorization({
        authorizationId: state.paypal.authorizationId,
        amount: state.agreement.amount,
        currency: state.agreement.currency,
        requestId: state.paypal.captureRequestId
      });

      const nextState = await saveState(addEvent({
        ...state,
        paypal: {
          ...state.paypal,
          captureId: capture.captureId,
          captureOutcome: "ACKNOWLEDGED"
        }
      }, "PayPal capture submitted, awaiting verified webhook", { paypalStatus: capture.paypalStatus }));
      res.json(publicState(nextState));
    } catch (error) {
      // The provider may have processed a timed-out capture. Never retry automatically or reopen approval.
      if (state.status === "CAPTURING") {
        await saveState(addEvent({
          ...state,
          paypal: { ...state.paypal, captureOutcome: "UNCERTAIN" }
        }, "Capture outcome uncertain; reconcile in PayPal Sandbox", { error: safeError(error) }));
      }
      res.status(502).json({ error: "Capture was not confirmed. Check PayPal Sandbox before taking another action." });
    }
  }));

  app.post("/api/paypal/void", async (_req, res) => withStateLock(async () => {
    let state = await loadState();
    try {
      if (!state.paypal.authorizationId) return res.status(400).json({ error: "No PayPal authorisation is available to void." });
      if (state.paypal.captureId || state.status === "CAPTURED" || state.status === "CAPTURING") {
        return res.status(409).json({ error: "This authorisation has already been captured and cannot be voided." });
      }

      if (state.paypal.voidedAt || !["AUTHORIZED", "DELIVERABLE_SUBMITTED", "PAYMENT_HELD", "VERIFIED"].includes(state.status)) {
        return res.status(409).json({ error: "The authorisation cannot be voided in its current state." });
      }
      const voidResult = await voidAuthorization(state.paypal.authorizationId);
      const nextState = await saveState(addEvent({
        ...state,
        status: "VOIDED",
        paypal: {
          ...state.paypal,
          voidedAt: new Date().toISOString()
        }
      }, "Buyer rejected work and voided authorisation", voidResult));
      res.json(publicState(nextState));
    } catch (error) {
      const nextState = await saveState(addEvent(state, "PayPal void failed", { error: safeError(error) }));
      res.status(500).json(publicState(nextState));
    }
  }));

  app.get("/control-room", (_req, res) => {
    res.sendFile(path.join(config.publicDir, "control-room.html"));
  });

  app.use((_req, res) => {
    res.sendFile(path.join(config.publicDir, "index.html"));
  });

  return app;
}

function sanitizeAgreement(input, fallback) {
  const amount = String(input?.amount || fallback.amount).trim();
  if (!/^\d+(\.\d{2})$/.test(amount)) throw new Error("Amount must use two decimal places.");
  return {
    title: String(input?.title || fallback.title).trim().slice(0, 120),
    amount,
    currency: "GBP",
    criteria: fallback.criteria
  };
}

function sanitizeSubmission(input) {
  const submission = {
    fileName: String(input?.fileName || "deliverable.png").trim().slice(0, 120),
    imageDataUrl: String(input?.imageDataUrl || ""),
    visibleText: String(input?.visibleText || "").trim().slice(0, 3000),
    notes: String(input?.notes || "").trim().slice(0, 1500),
    submittedAt: new Date().toISOString()
  };
  if (!submission.imageDataUrl.startsWith("data:image/")) throw new Error("A PNG or JPG deliverable is required.");
  if (!submission.visibleText) throw new Error("Visible text or image description is required for cited AI verification.");
  return submission;
}

async function handlePaypalWebhook(req, res) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    if (!event || typeof event.id !== "string" || !event.id ||
        typeof event.event_type !== "string") return res.sendStatus(400);

    return await withStateLock(async () => {
      const state = await loadState();
      const verification = await verifyWebhookSignature({ headers: req.headers, rawBody, event });
      if (!verification.verified) {
        await saveState(addEvent(state, "PayPal webhook rejected", {
          eventType: event.event_type, reason: verification.reason || "Invalid signature"
        }));
        return res.sendStatus(verification.configured ? 401 : 503);
      }

      const processedIds = state.paypal.processedWebhookEventIds ||
        (state.paypal.lastWebhookEventId ? [state.paypal.lastWebhookEventId] : []);
      if (processedIds.includes(event.id)) {
        return res.sendStatus(200); // Idempotent duplicate, no state transition.
      }

      const resource = event.resource;
      const related = resource?.supplementary_data?.related_ids;
      const baseMatches = event.event_type === "PAYMENT.CAPTURE.COMPLETED" &&
        ["CAPTURING", "CAPTURED"].includes(state.status) &&
        resource?.status === "COMPLETED" && typeof resource?.id === "string" && Boolean(resource.id) &&
        resource.final_capture === true &&
        related?.order_id === state.paypal.orderId &&
        resource.amount?.currency_code === state.agreement.currency &&
        resource.amount?.value === state.agreement.amount;
      const knownCaptureMatches = Boolean(state.paypal.captureId) && resource?.id === state.paypal.captureId;

      if (!baseMatches || (state.paypal.captureId && !knownCaptureMatches)) {
        await saveState(addEvent(state, "Verified PayPal webhook ignored (unexpected state or capture)", {
          eventType: event.event_type, matchesCapture: false
        }));
        return res.sendStatus(202);
      }

      if (state.status === "CAPTURED" && state.paypal.webhookVerified) {
        return res.sendStatus(200); // A delayed duplicate completion cannot change settled state.
      }

      let reconciledUnknownCapture = false;
      if (!state.paypal.captureId) {
        try {
          const capture = await reconcileCapture({
            orderId: state.paypal.orderId,
            authorizationId: state.paypal.authorizationId,
            captureId: resource.id,
            amount: state.agreement.amount,
            currency: state.agreement.currency
          });
          if (capture.captureId !== resource.id) throw new PayPalEvidenceError("PayPal reconciliation returned another capture.");
          reconciledUnknownCapture = true;
        } catch (error) {
          if (!(error instanceof PayPalEvidenceError)) throw error;
          await saveState(addEvent(state, "Verified PayPal webhook ignored after inconclusive reconciliation", {
            eventType: event.event_type, matchesCapture: false
          }));
          return res.sendStatus(202);
        }
      }

      const nextState = {
        ...state,
        status: "CAPTURED",
        paypal: {
          ...state.paypal,
          captureId: resource.id,
          capturedAt: new Date().toISOString(),
          webhookConfirmedAt: new Date().toISOString(),
          webhookVerified: true,
          lastWebhookEventId: event.id,
          processedWebhookEventIds: [...processedIds, event.id].slice(-50),
          captureOutcome: "CONFIRMED"
        }
      };
      await saveState(addEvent(nextState, "PayPal capture confirmed by verified webhook", {
        eventType: event.event_type, verified: true, matchesCapture: true,
        reconciledUnknownCapture
      }));
      return res.sendStatus(200);
    });
  } catch (_error) {
    // PayPal can retry failed deliveries; an outage is never evidence of capture.
    return res.sendStatus(503);
  }
}

function hasExactPassingAiCriteria(checks) {
  if (!Array.isArray(checks) || checks.length !== semanticCriteria.length) return false;
  const seen = new Set();
  return checks.every((check) => {
    if (!check || check.status !== "PASS" || !semanticCriteria.includes(check.criterion) ||
        seen.has(check.criterion) || !String(check.reasoning || "").trim() ||
        !String(check.evidence || "").trim()) return false;
    seen.add(check.criterion);
    return true;
  }) && semanticCriteria.every((criterion) => seen.has(criterion));
}
