import crypto from "crypto";
import { config } from "./config.js";

const tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const response = await fetch(`${config.paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`PayPal OAuth failed with HTTP ${response.status}: ${body.error || "unknown_error"}`);
  }

  tokenCache.token = body.access_token;
  tokenCache.expiresAt = Date.now() + Number(body.expires_in || 300) * 1000;
  return tokenCache.token;
}

async function paypal(method, endpoint, payload, extraHeaders = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${config.paypalApiBase}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
      ...extraHeaders
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  if (response.status === 204) {
    return { statusCode: 204, body: null };
  }

  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(`PayPal ${method} ${endpoint} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return { statusCode: response.status, body };
}

function approvalLink(order) {
  return order.links?.find((link) => link.rel === "approve")?.href;
}

export async function createAuthorizeOrder({ amount, currency, title }) {
  const nonce = crypto.randomUUID();
  const returnUrl = `${config.appBaseUrl}/paypal/return?nonce=${encodeURIComponent(nonce)}`;
  const cancelUrl = `${config.appBaseUrl}/paypal/cancel?nonce=${encodeURIComponent(nonce)}`;

  const { body } = await paypal("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: `proofpay-${Date.now()}`,
        description: `ProofPay verification payment for ${title}`,
        amount: {
          currency_code: currency,
          value: amount
        }
      }
    ],
    application_context: {
      brand_name: "ProofPay",
      landing_page: "LOGIN",
      user_action: "PAY_NOW",
      return_url: returnUrl,
      cancel_url: cancelUrl
    }
  }, { Prefer: "return=representation" });

  const href = approvalLink(body);
  if (!href) throw new Error(`PayPal order ${body.id} did not include an approval URL`);
  return { orderId: body.id, approvalUrl: href, pendingNonce: nonce };
}

function getAuthorizationId(authorizeResponse) {
  const authorizations = authorizeResponse.purchase_units
    ?.flatMap((unit) => unit.payments?.authorizations || [])
    .filter(Boolean);
  return authorizations?.[0]?.id;
}

export async function authorizeOrder(orderId) {
  const { body } = await paypal("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, { Prefer: "return=representation" });
  const authorizationId = getAuthorizationId(body);
  if (!authorizationId) throw new Error("PayPal authorize response did not contain an authorization id");
  return { authorizationId, paypalStatus: body.status };
}

export async function captureAuthorization({ authorizationId, amount, currency }) {
  const { body } = await paypal("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    amount: { currency_code: currency, value: amount },
    final_capture: true
  }, { Prefer: "return=representation" });
  return { captureId: body.id, paypalStatus: body.status };
}

export async function voidAuthorization(authorizationId) {
  const { statusCode, body } = await paypal("POST", `/v2/payments/authorizations/${authorizationId}/void`, undefined, { Prefer: "return=representation" });
  return { paypalStatus: body?.status || `HTTP ${statusCode}` };
}

export async function verifyWebhookSignature({ headers, rawBody, event }) {
  if (!config.paypalWebhookId) {
    return { configured: false, verified: false, reason: "PAYPAL_WEBHOOK_ID is not configured" };
  }

  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const transmissionSig = headers["paypal-transmission-sig"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return { configured: true, verified: false, reason: "Missing PayPal signature headers" };
  }

  const { body } = await paypal("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: config.paypalWebhookId,
    webhook_event: event || JSON.parse(rawBody.toString("utf8"))
  });

  return {
    configured: true,
    verified: body.verification_status === "SUCCESS",
    paypalStatus: body.verification_status
  };
}
