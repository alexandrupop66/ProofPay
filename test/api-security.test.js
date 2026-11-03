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
const realFetch = globalThis.fetch;
const provider = {
  order: null,
  orders: 0,
  captures: 0,
  voids: 0,
  failCapture: false,
  failVoid: false,
  failAi: false,
  incompleteAi: false
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
    return jsonResponse(200, {
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        overallStatus: failing ? "FAIL" : "PASS",
        summary: failing ? "The creative violates the brief." : "The creative meets the brief.",
        checks: provider.incompleteAi ? checks.slice(0, 2) : checks
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
      nonce: new URL(request.application_context.return_url).searchParams.get("nonce")
    };
    return jsonResponse(201, {
      id: provider.order.id,
      links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${provider.order.id}` }]
    });
  }
  if (url.pathname.endsWith("/authorize")) {
    const id = url.pathname.split("/")[4];
    return jsonResponse(201, {
      id, intent: "AUTHORIZE", status: "COMPLETED",
      purchase_units: [{ payments: { authorizations: [{
        id: `AUTH-${id}`, status: "CREATED", amount: provider.order.amount
      }] } }]
    });
  }
  if (url.pathname.endsWith("/capture")) {
    provider.captures += 1;
    if (provider.failCapture) return jsonResponse(500, { error: "Simulated upstream capture failure" });
    const amount = JSON.parse(init.body).amount;
    assert.ok(init.headers["PayPal-Request-Id"], "Server must send a stable idempotency request ID");
    return jsonResponse(201, { id: `CAPTURE-${provider.captures}`, status: "COMPLETED", amount });
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

  function webhook(id, resourceId, signature = "valid", eventType = "PAYMENT.CAPTURE.COMPLETED", headersEnabled = true) {
    const event = { id, event_type: eventType, resource: { id: resourceId } };
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
    for (const endpoint of ["/api/reset", "/api/submission", "/api/verify", "/api/paypal/create-order", "/api/paypal/capture", "/api/paypal/void"]) {
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
    provider.incompleteAi = true;
    assert.equal((await post("/api/verify")).status, 500);
    provider.incompleteAi = false;
    assert.equal((await state()).status, "PAYMENT_HELD");
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
    assert.equal((await webhook("REPLAY-OTHER-ID", captureId)).status, 202);
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

  await t.test("failed capture remains unresolved; cannot be retried, voided or reset blindly", async () => {
    assert.equal((await post("/api/reset")).status, 200);
    await authorise();
    const corrected = await submitAndVerify(true);
    assert.equal(corrected.status, "VERIFIED");
    provider.failCapture = true;
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 502);
    provider.failCapture = false;
    assert.equal((await state()).status, "CAPTURING");
    assert.equal((await state()).paypal.captureId, false);
    assert.equal((await post("/api/paypal/capture", { approve: true })).status, 409);
    assert.equal((await post("/api/paypal/void")).status, 409);
    assert.equal((await post("/api/reset")).status, 409);
    assert.equal((await webhook("UNKNOWN-CAPTURE", "CAPTURE-ANY")).status, 202);
    assert.notEqual((await state()).status, "CAPTURED");
  });
});
