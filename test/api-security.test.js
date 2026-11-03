import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "proofpay-routes-"));
process.env.PROOFPAY_STATE_PATH = path.join(directory, "isolated-state.json");
process.env.PROOFPAY_ACCESS_PASSWORD = "test-local-access-very-long-password";
process.env.PAYPAL_ENV = "sandbox";
process.env.PAYPAL_CLIENT_ID = "mock-client-id";
process.env.PAYPAL_CLIENT_SECRET = "mock-client-secret";
process.env.PAYPAL_WEBHOOK_ID = "mock-webhook-id";
process.env.OPENAI_API_KEY = "mock-openai-key";
process.env.APP_BASE_URL = "http://localhost:3000";

const { createApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const { loadState, saveState } = await import("../src/state.js");
const realFetch = globalThis.fetch;
const provider = {
  order: null,
  orders: 0,
  authorizations: 0,
  captures: 0,
  voids: 0,
  failCapture: false,
  timeoutAfterCapture: false,
  timeoutAfterAuthorization: false,
  reconciliationAmount: null,
  extraCapture: false,
  failVoid: false,
  failAi: false,
  aiMode: "valid"
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "api.openai.com") {
    if (provider.failAi) return jsonResponse(503, { error: { message: "Mock service unavailable" } });
    const request = JSON.parse(init.body);
    const prompt = request.input[0].content[0].text;
    const failing = prompt.includes("Disposable plastic cups included.");
    const criteria = [
      "Prominently mentions sustainability",
      "Uses a professional promotional tone",
      "Includes the exact slogan: Brew Better. Waste Less.",
      "Does not contain or promote disposable plastic cups"
    ];
    const checks = criteria.map((criterion, i) => ({
      criterion, status: failing && i === 3 ? "FAIL" : "PASS",
      reasoning: "Mocked semantic review", evidence: "Mocked test evidence"
    }));
    if (provider.aiMode === "duplicate") checks[3].criterion = checks[0].criterion;
    if (provider.aiMode === "substituted") checks[3].criterion = "Looks visually attractive";
    if (provider.aiMode === "malformed") checks[2].reasoning = "";
    return jsonResponse(200, {
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        overallStatus: failing ? "FAIL" : "PASS",
        summary: failing ? "The creative violates the brief." : "The creative meets the brief.",
        checks: provider.aiMode === "missing" ? checks.slice(0, 3) : checks
      }) }] }]
    });
  }
  if (url.hostname !== "api-m.sandbox.paypal.com") {
    throw new Error(`Unexpected external request: ${url.hostname}`);
  }
  if (url.pathname.endsWith("/v1/oauth2/token")) {
    return jsonResponse(200, { access_token: "mock-access-token", expires_in: 3600 });
  }
  if (url.pathname === "/v2/checkout/orders" && init.method === "POST") {
    const request = JSON.parse(init.body);
    provider.orders += 1;
    provider.order = {
      id: `ORDER-${provider.orders}`,
      amount: request.purchase_units[0].amount,
      nonce: new URL(request.application_context.return_url).searchParams.get("nonce"),
      authorizationId: null,
      captureId: null,
      captureAmount: null
    };
    return jsonResponse(201, {
      id: provider.order.id,
      links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${provider.order.id}` }]
    });
  }
  if (url.pathname.endsWith("/authorize")) {
    const id = url.pathname.split("/")[4];
    provider.authorizations += 1;
    assert.ok(init.headers["PayPal-Request-Id"], "Authorisation must use a persisted idempotency request ID");
    provider.order.authorizationId = `AUTH-${id}`;
    provider.order.authorizationRequestId = init.headers["PayPal-Request-Id"];
    if (provider.timeoutAfterAuthorization) throw new Error("Simulated timeout after provider authorised order");
    return jsonResponse(201, {
      id, intent: "AUTHORIZE", status: "COMPLETED",
      purchase_units: [{ payments: { authorizations: [{
        id: `AUTH-${id}`, status: "CREATED", amount: provider.order.amount
      }] } }]
    });
  }
  if (url.pathname.endsWith("/capture")) {
    provider.captures += 1;
    const amount = JSON.parse(init.body).amount;
    provider.order.captureId = `CAPTURE-${provider.captures}`;
    provider.order.captureAmount = amount;
    if (provider.timeoutAfterCapture) throw new Error("Simulated timeout after provider completed capture");
    if (provider.failCapture) return jsonResponse(500, { error: "Simulated upstream capture failure" });
    assert.ok(init.headers["PayPal-Request-Id"], "Server must send a stable idempotency request ID");
    return jsonResponse(201, { id: provider.order.captureId, status: "COMPLETED", amount });
  }
  if (init.method === "GET" && url.pathname.startsWith("/v2/checkout/orders/")) {
    const amount = provider.reconciliationAmount
      ? { ...provider.order.amount, value: provider.reconciliationAmount }
      : provider.order.amount;
    const payments = {};
    if (provider.order.authorizationId) {
      payments.authorizations = [{
        id: provider.order.authorizationId,
        status: provider.order.captureId ? "CAPTURED" : "CREATED",
        amount: provider.order.amount
      }];
    }
    if (provider.order.captureId) {
      payments.captures = [{
        id: provider.order.captureId,
        status: "COMPLETED",
        amount: provider.order.captureAmount
      }];
      if (provider.extraCapture) payments.captures.push({
        id: "CAPTURE-AMBIGUOUS",
        status: "COMPLETED",
        amount: provider.order.captureAmount
      });
    }
    return jsonResponse(200, {
      id: provider.order.id,
      intent: "AUTHORIZE",
      status: provider.order.authorizationId ? "COMPLETED" : "APPROVED",
      purchase_units: [{ amount, payments }]
    });
  }
  if (url.pathname.endsWith("/void")) {
    provider.voids += 1;
    if (provider.failVoid) return jsonResponse(422, { error: "Simulated upstream void failure" });
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/v1/notifications/verify-webhook-signature") {
    const request = JSON.parse(init.body);
    return jsonResponse(200, {
      verification_status: request.transmission_sig === "valid" ? "SUCCESS" : "FAILURE"
    });
  }
  throw new Error(`Unexpected PayPal mock endpoint: ${url.pathname}`);
};

function fakePngDataUrl() {
  const buffer = Buffer.alloc(4096);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(1200, 16);
  buffer.writeUInt32BE(675, 20);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

const contentFor = (corrected) => corrected
  ? "Verdant Volt Coffee. Brew Better. Waste Less. Sustainable launch campaign. Reusable cup programme included."
  : "Verdant Volt Coffee. Brew Better. Waste Less. Sustainable launch campaign. Disposable plastic cups included.";

test("real Express routes enforce payment security and preserve the demo journey (mocked providers)", async (t) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  let csrf = "";
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
    await rm(directory, { recursive: true, force: true });
  });

  async function request(url, { method = "GET", body, auth = true, token = true, crossSite = false } = {}) {
    const headers = {};
    if (auth && cookie) headers.Cookie = cookie;
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      if (token && csrf) headers["X-CSRF-Token"] = csrf;
    }
    if (crossSite) { headers.Origin = "https://evil.example"; headers["Sec-Fetch-Site"] = "cross-site"; }
    const response = await realFetch(origin + url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual"
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  const post = (url, body = {}, options = {}) => request(url, { method: "POST", body, ...options });
  const state = async () => (await request("/api/state")).data;

  async function authorise() {
    const created = await post("/api/paypal/create-order", { agreement: { title: "Verdant Volt Coffee campaign", amount: "25.00" } });
    assert.equal(created.status, 200);
    assert.equal(created.data.state.status, "AUTHORIZATION_REQUIRED");
    const returned = await request(`/paypal/return?token=${provider.order.id}&nonce=${provider.order.nonce}`);
    assert.equal(returned.status, 302);
    assert.match(returned.headers.get("location"), /paypal=authorized/);
    assert.equal((await state()).status, "AUTHORIZED");
  }

  async function submitAndVerify(corrected) {
    const submission = await post("/api/submission", {
      fileName: corrected ? "verdant-volt-corrected.png" : "verdant-volt-failing.png",
      imageDataUrl: fakePngDataUrl(), visibleText: contentFor(corrected),
      notes: corrected ? "Corrected reusable packaging." : "Initial creative."
    });
    assert.equal(submission.status, 200);
    assert.equal(submission.data.status, "DELIVERABLE_SUBMITTED");
    const verified = await post("/api/verify");
    assert.equal(verified.status, 200);
    assert.equal(verified.data.verification.deterministic.every((check) => check.status === "PASS"), true);
    return verified.data;
  }

  function webhook(id, resourceId, signature = "valid", eventType = "PAYMENT.CAPTURE.COMPLETED", headersEnabled = true, overrides = {}) {
    const event = { id, event_type: eventType, resource: {
      id: resourceId,
      status: "COMPLETED",
      amount: { currency_code: "GBP", value: "25.00" },
      supplementary_data: { related_ids: {
        order_id: provider.order?.id
      } },
      final_capture: true,
      ...overrides
    } };
    const headers = { "Content-Type": "application/json" };
    if (headersEnabled) Object.assign(headers, {
      "paypal-transmission-id": `TRANSMISSION-${id}`,
      "paypal-transmission-time": new Date().toISOString(),
      "paypal-transmission-sig": signature,
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
      "paypal-auth-algo": "SHA256withRSA"
    });
    return realFetch(origin + "/webhooks/paypal", { method: "POST", headers, body: JSON.stringify(event) });
  }

  await t.test("unauthorised reads and all state-changing API routes fail closed", async () => {
    for (const endpoint of ["/api/state", "/api/control-room", "/api/config-check"]) {
      assert.equal((await request(endpoint, { auth: false })).status, 401);
    }
    for (const endpoint of ["/api/reset", "/api/submission", "/api/verify", "/api/paypal/create-order", "/api/paypal/capture", "/api/paypal/void", "/api/paypal/reconcile"]) {
      assert.equal((await post(endpoint, { approve: true }, { auth: false })).status, 401);
    }
    assert.equal((await post("/api/login", { password: "incorrect" }, { auth: false })).status, 401);
    const originalPassword = config.accessPassword;
    config.accessPassword = "replace-with-your-own-long-random-password";
    assert.equal((await post("/api/login", { password: config.accessPassword }, { auth: false })).status, 503);
    config.accessPassword = originalPassword;
    const login = await post("/api/login", { password: process.env.PROOFPAY_ACCESS_PASSWORD }, { auth: false });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    csrf = login.data.csrfToken;
    assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
    assert.equal((await post("/api/reset", {}, { token: false })).status, 403);
    assert.equal((await post("/api/reset", {}, { crossSite: true })).status, 403);
    assert.equal((await request("/api/state", { auth: false })).status, 401);
  });

  await t.test("create authorisation; reject direct API bypass and reset", async () => {
    assert.equal((await post("/api/submission", { fileName: "x.png" })).status, 409);
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 400);
    await authorise();
    assert.equal((await post("/api/paypal/create-order", {})).status, 409);
    assert.equal((await post("/api/reset")).status, 409);
    assert.equal((await post("/api/verify")).status, 409);
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await request("/paypal/return?token=WRONG&nonce=WRONG")).status, 302);
    assert.equal((await state()).status, "AUTHORIZED");
    const json = JSON.stringify((await request("/api/state")).data);
    const control = JSON.stringify((await request("/api/control-room")).data);
    for (const sensitive of ["AUTH-ORDER", provider.order.id, provider.order.nonce, "mock-client-secret", "mock-openai-key"]) {
      assert.equal(json.includes(sensitive), false);
      assert.equal(control.includes(sensitive), false);
    }
  });

  await t.test("failing creative is held; AI outage cannot unlock capture", async () => {
    const failing = await submitAndVerify(false);
    assert.equal(failing.status, "PAYMENT_HELD");
    assert.equal(failing.verification.overall, "FAIL");
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    const control = (await request("/api/control-room")).data;
    assert.equal(control.rows[0].paypalState, "HELD");
    assert.equal(control.rows[0].aiSemanticResult, "FAIL");
    assert.equal(control.cards.exceptions, 1);

    const next = await post("/api/submission", {
      fileName: "verdant-volt-corrected.png", imageDataUrl: fakePngDataUrl(),
      visibleText: contentFor(true), notes: "Replaced forbidden material."
    });
    assert.equal(next.status, 200);
    provider.failAi = true;
    assert.equal((await post("/api/verify")).status, 500);
    assert.equal((await state()).status, "PAYMENT_HELD");
    provider.failAi = false;
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    const incomplete = await post("/api/submission", {
      fileName: "creative.png", imageDataUrl: fakePngDataUrl(),
      visibleText: contentFor(true), notes: "Corrected creative."
    });
    assert.equal(incomplete.status, 200);
    provider.aiMode = "missing";
    assert.equal((await post("/api/verify")).status, 500);
    provider.aiMode = "valid";
    assert.equal((await state()).status, "PAYMENT_HELD");
  });

  await t.test("duplicate, substituted and malformed AI criteria cannot unlock capture", async () => {
    for (const mode of ["duplicate", "substituted", "malformed"]) {
      const submitted = await post("/api/submission", {
        fileName: `${mode}.png`, imageDataUrl: fakePngDataUrl(),
        visibleText: contentFor(true), notes: "Corrected creative."
      });
      assert.equal(submitted.status, 200);
      provider.aiMode = mode;
      assert.equal((await post("/api/verify")).status, 500);
      provider.aiMode = "valid";
      assert.equal((await state()).status, "PAYMENT_HELD");
      assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    }

    const valid = await submitAndVerify(true);
    assert.equal(valid.status, "VERIFIED");
    const tampered = await loadState();
    tampered.verification.ai[3].criterion = tampered.verification.ai[0].criterion;
    await saveState(tampered);
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409,
      "The capture guard must independently reject persisted duplicate criteria");
  });

  await t.test("corrected creative requires explicit approval; only verified matching webhook captures", async () => {
    const corrected = await submitAndVerify(true);
    assert.equal(corrected.status, "VERIFIED");
    assert.equal(corrected.verification.overall, "PASS");
    assert.equal((await post("/api/paypal/capture", {})).status, 400);
    assert.equal((await webhook("EARLY", "CAPTURE-1")).status, 202);
    assert.equal((await state()).status, "VERIFIED");

    const competing = await Promise.all([
      post("/api/paypal/capture", { approve: true }),
      post("/api/paypal/capture", { approve: true })
    ]);
    assert.deepEqual(competing.map((result) => result.status).sort(), [200, 409]);
    assert.equal(provider.captures, 1);
    assert.equal((await state()).status, "CAPTURING");
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await post("/api/paypal/void")).status, 409);
    assert.equal((await post("/api/submission")).status, 409);
    assert.equal((await post("/api/verify")).status, 409);
    assert.equal((await post("/api/reset")).status, 409);

    assert.equal((await realFetch(origin + "/webhooks/paypal", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad-json"
    })).status, 400);
    const captureId = `CAPTURE-${provider.captures}`;
    const previousConfig = config.paypalWebhookId;
    config.paypalWebhookId = "";
    assert.equal((await webhook("MISSING-CONFIG", captureId)).status, 503);
    config.paypalWebhookId = previousConfig;
    assert.equal((await state()).status, "CAPTURING");
    assert.equal((await webhook("UNSIGNED", captureId, "valid", "PAYMENT.CAPTURE.COMPLETED", false)).status, 401);
    assert.equal((await webhook("BAD-SIGNATURE", captureId, "invalid")).status, 401);
    assert.equal((await webhook("MISMATCH", "OTHER-CAPTURE")).status, 202);
    assert.equal((await webhook("WRONG-TYPE", captureId, "valid", "PAYMENT.CAPTURE.DENIED")).status, 202);
    assert.equal((await state()).status, "CAPTURING");

    assert.equal((await webhook("FINAL", captureId)).status, 200);
    const captured = await state();
    assert.equal(captured.status, "CAPTURED");
    assert.equal(captured.paypal.webhookVerified, true);
    const eventCount = captured.events.length;
    assert.equal((await webhook("FINAL", captureId)).status, 200);
    assert.equal((await state()).events.length, eventCount);
    assert.equal((await webhook("REPLAY-OTHER-ID", captureId)).status, 200);
    assert.equal((await state()).status, "CAPTURED");
    assert.equal((await post("/api/paypal/void")).status, 409);
    assert.equal((await request("/api/control-room")).data.cards.captured, 25);
  });

  await t.test("Reject & Void uses real route and does not succeed on failed PayPal call", async () => {
    assert.equal((await post("/api/reset")).status, 200);
    await authorise();
    provider.failVoid = true;
    assert.equal((await post("/api/paypal/void")).status, 500);
    assert.equal((await state()).status, "AUTHORIZED");
    provider.failVoid = false;
    assert.equal((await post("/api/paypal/void")).status, 200);
    assert.equal((await state()).status, "VOIDED");
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await request("/api/control-room")).data.cards.voided, 25);
  });

  await t.test("authorisation timeout is locked and recovered only by read-only order reconciliation", async () => {
    assert.equal((await post("/api/reset")).status, 200);
    const created = await post("/api/paypal/create-order", {
      agreement: { title: "Verdant Volt Coffee campaign", amount: "25.00" }
    });
    assert.equal(created.status, 200);
    const callback = `/paypal/return?token=${provider.order.id}&nonce=${provider.order.nonce}`;
    const authorizationsBefore = provider.authorizations;
    provider.timeoutAfterAuthorization = true;
    const returned = await request(callback);
    provider.timeoutAfterAuthorization = false;
    assert.equal(returned.status, 302);
    assert.match(returned.headers.get("location"), /paypal=authorize-error/);
    assert.equal(provider.authorizations, authorizationsBefore + 1);
    assert.equal((await state()).status, "AUTHORIZING");
    assert.equal((await state()).paypal.authorizationOutcome, "UNCERTAIN");
    assert.equal((await post("/api/reset")).status, 409);
    assert.equal((await post("/api/paypal/create-order", {})).status, 409);
    const duplicate = await request(callback);
    assert.equal(duplicate.status, 302);
    assert.match(duplicate.headers.get("location"), /paypal=return-rejected/);
    assert.equal(provider.authorizations, authorizationsBefore + 1, "Duplicate callback must not repeat authorisation");
    const privateState = await loadState();
    assert.equal(privateState.paypal.authorizationRequestId, provider.order.authorizationRequestId);
    assert.equal(JSON.stringify(await state()).includes(provider.order.authorizationRequestId), false);

    provider.reconciliationAmount = "99.00";
    assert.equal((await post("/api/paypal/reconcile")).status, 409);
    assert.equal((await state()).status, "AUTHORIZING");
    assert.equal((await post("/api/reset")).status, 409);
    provider.reconciliationAmount = null;
    assert.equal((await post("/api/paypal/reconcile")).status, 200);
    assert.equal((await state()).status, "AUTHORIZED");
    assert.equal((await state()).paypal.authorizationOutcome, "CONFIRMED");
    assert.equal((await post("/api/paypal/reconcile")).status, 409);
    assert.equal((await post("/api/paypal/void")).status, 200);
    assert.equal((await state()).status, "VOIDED");
  });

  await t.test("provider-success capture timeout recovers only from fully correlated verified evidence", async () => {
    assert.equal((await post("/api/reset")).status, 200);
    await authorise();
    const corrected = await submitAndVerify(true);
    assert.equal(corrected.status, "VERIFIED");
    provider.timeoutAfterCapture = true;
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 502);
    provider.timeoutAfterCapture = false;
    assert.equal((await state()).status, "CAPTURING");
    assert.equal((await state()).paypal.captureId, false);
    assert.equal((await state()).paypal.captureOutcome, "UNCERTAIN");
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await post("/api/paypal/void")).status, 409);
    assert.equal((await post("/api/reset")).status, 409);
    const completedCapture = `CAPTURE-${provider.captures}`;
    assert.equal((await webhook("MISMATCHED-ORDER", completedCapture, "valid", "PAYMENT.CAPTURE.COMPLETED", true, {
      supplementary_data: { related_ids: { order_id: "OTHER-ORDER" } }
    })).status, 202);
    assert.equal((await webhook("INVALID-AMOUNT", completedCapture, "valid", "PAYMENT.CAPTURE.COMPLETED", true, {
      amount: { currency_code: "GBP", value: "250.00" }
    })).status, 202);
    provider.extraCapture = true;
    assert.equal((await webhook("AMBIGUOUS-CAPTURES", completedCapture)).status, 202);
    provider.extraCapture = false;
    assert.notEqual((await state()).status, "CAPTURED");
    assert.equal((await webhook("RECOVERY", completedCapture)).status, 200);
    assert.equal((await state()).status, "CAPTURED");
    assert.equal((await state()).paypal.captureOutcome, "CONFIRMED");
    assert.equal((await webhook("RECOVERY", completedCapture)).status, 200);
    assert.equal((await webhook("DELAYED-DUPLICATE", completedCapture)).status, 200);
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await post("/api/paypal/void")).status, 409);
  });

  await t.test("manual read-only capture reconciliation records a later genuine-style webhook", async () => {
    assert.equal((await post("/api/reset")).status, 200);
    await authorise();
    assert.equal((await submitAndVerify(true)).status, "VERIFIED");
    provider.timeoutAfterCapture = true;
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 502);
    provider.timeoutAfterCapture = false;
    assert.equal((await post("/api/paypal/reconcile")).status, 200);
    const reconciled = await state();
    assert.equal(reconciled.status, "CAPTURED");
    assert.equal(reconciled.paypal.webhookVerified, false);
    assert.equal((await webhook("DELAYED-AFTER-RECONCILIATION", `CAPTURE-${provider.captures}`)).status, 200);
    assert.equal((await state()).paypal.webhookVerified, true);
  });
});
