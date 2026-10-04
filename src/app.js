import express from "express";
import path from "path";
import { config, missingConfig, safeError } from "./config.js";
import { addEvent, loadState, publicState, resetState, saveState } from "./state.js";
import { authorizeOrder, captureAuthorization, createAuthorizeOrder, verifyWebhookSignature, voidAuthorization } from "./paypal.js";
import { runAiVerification, runDeterministicChecks } from "./verification.js";
import { buildControlRoomPayload } from "./controlRoom.js";

export function createApp() {
  const app = express();

  app.post("/webhooks/paypal", express.raw({ type: "*/*" }), handlePaypalWebhook);
  app.use(express.json({ limit: "8mb" }));
  app.use("/vendor/ag-grid", express.static(path.resolve("node_modules", "ag-grid-community")));
  app.use(express.static(config.publicDir));

  app.get("/api/state", async (_req, res) => {
    res.json(publicState(await loadState()));
  });

  app.get("/api/config-check", (_req, res) => {
    res.json({ missing: missingConfig() });
  });

  app.get("/api/control-room", async (_req, res) => {
    res.json(buildControlRoomPayload(await loadState()));
  });

  app.post("/api/reset", async (_req, res) => {
    const state = addEvent(await resetState(), "Demo reset");
    res.json(publicState(await saveState(state)));
  });

  app.post("/api/paypal/create-order", async (req, res) => {
    try {
      const missing = missingConfig().filter((item) => item !== "OPENAI_API_KEY");
      if (missing.length) return res.status(400).json({ error: `Missing PayPal configuration: ${missing.join(", ")}` });

      const state = await loadState();
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
          captureId: null,
          authorisedAt: null,
          capturedAt: null,
          voidedAt: null,
          webhookConfirmedAt: null,
          webhookVerified: false
        }
      }, "PayPal authorize order created", { orderId: order.orderId }));

      res.json({ approvalUrl: order.approvalUrl, state: publicState(nextState) });
    } catch (error) {
      res.status(500).json({ error: safeError(error) });
    }
  });

  app.get("/paypal/return", async (req, res) => {
    try {
      const state = await loadState();
      const token = String(req.query.token || "");
      const nonce = String(req.query.nonce || "");
      if (!token || token !== state.paypal.orderId || nonce !== state.paypal.pendingNonce) {
        res.redirect("/?paypal=return-rejected");
        return;
      }

      const authorization = await authorizeOrder(token);
      await saveState(addEvent({
        ...state,
        status: "AUTHORIZED",
        paypal: {
          ...state.paypal,
          authorizationId: authorization.authorizationId,
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
      const state = await loadState();
      await saveState(addEvent(state, "PayPal authorization failed", { error: safeError(error) }));
      res.redirect("/?paypal=authorize-error");
    }
  });

  app.get("/paypal/cancel", async (_req, res) => {
    const state = await loadState();
    await saveState(addEvent(state, "Buyer cancelled PayPal approval"));
    res.redirect("/?paypal=cancelled");
  });

  app.post("/api/submission", async (req, res) => {
    try {
      const state = await loadState();
      const submission = sanitizeSubmission(req.body);
      const nextState = await saveState(addEvent({
        ...state,
        status: state.status === "AUTHORIZED" || state.status === "PAYMENT_HELD" || state.status === "VERIFIED" || state.status === "READY_FOR_APPROVAL"
          ? "DELIVERABLE_SUBMITTED"
          : state.status,
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
  });

  app.post("/api/verify", async (_req, res) => {
    let state = await loadState();
    try {
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
  });

  app.post("/api/paypal/capture", async (_req, res) => {
    let state = await loadState();
    try {
      if (!state.paypal.authorizationId) return res.status(400).json({ error: "No PayPal authorization is available to capture." });
      if (state.verification.overall !== "PASS" || !["VERIFIED", "READY_FOR_APPROVAL"].includes(state.status)) {
        return res.status(409).json({ error: "Capture is blocked until verification passes and the buyer approves." });
      }

      state = await saveState(addEvent({ ...state, status: "CAPTURING" }, "Buyer clicked Approve & Pay"));
      const capture = await captureAuthorization({
        authorizationId: state.paypal.authorizationId,
        amount: state.agreement.amount,
        currency: state.agreement.currency
      });

      const nextState = await saveState(addEvent({
        ...state,
        paypal: {
          ...state.paypal,
          captureId: capture.captureId,
          capturedAt: new Date().toISOString()
        }
      }, "PayPal capture submitted", capture));
      res.json(publicState(nextState));
    } catch (error) {
      const nextState = await saveState(addEvent({ ...state, status: "VERIFIED" }, "PayPal capture failed", { error: safeError(error) }));
      res.status(500).json(publicState(nextState));
    }
  });

  app.post("/api/paypal/void", async (_req, res) => {
    let state = await loadState();
    try {
      if (!state.paypal.authorizationId) return res.status(400).json({ error: "No PayPal authorization is available to void." });
      if (state.paypal.captureId || state.status === "CAPTURED") {
        return res.status(409).json({ error: "This authorization has already been captured and cannot be voided." });
      }

      const voidResult = await voidAuthorization(state.paypal.authorizationId);
      const nextState = await saveState(addEvent({
        ...state,
        status: "VOIDED",
        paypal: {
          ...state.paypal,
          voidedAt: new Date().toISOString()
        }
      }, "Buyer rejected work and voided authorization", voidResult));
      res.json(publicState(nextState));
    } catch (error) {
      const nextState = await saveState(addEvent(state, "PayPal void failed", { error: safeError(error) }));
      res.status(500).json(publicState(nextState));
    }
  });

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
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const event = JSON.parse(rawBody.toString("utf8"));
    const verification = await verifyWebhookSignature({ headers: req.headers, rawBody, event });
    const state = await loadState();

    const matchesCapture = event.event_type === "PAYMENT.CAPTURE.COMPLETED"
      && state.paypal.captureId
      && event.resource?.id === state.paypal.captureId;

    const nextState = matchesCapture && (!verification.configured || verification.verified)
      ? {
          ...state,
          status: "CAPTURED",
          paypal: {
            ...state.paypal,
            webhookConfirmedAt: new Date().toISOString(),
            webhookVerified: verification.verified,
            lastWebhookEventId: event.id
          }
        }
      : state;

    await saveState(addEvent(nextState, "PayPal webhook received", {
      eventType: event.event_type,
      eventId: event.id,
      resourceId: event.resource?.id,
      verified: verification.verified,
      verificationConfigured: verification.configured,
      matchesCapture
    }));

    res.sendStatus(200);
  } catch (error) {
    const state = await loadState().catch(() => null);
    if (state) {
      await saveState(addEvent(state, "PayPal webhook handling failed", { error: safeError(error) }));
    }
    res.sendStatus(200);
  }
}
