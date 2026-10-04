import "dotenv/config";

const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

const {
  PAYPAL_ENV = "sandbox",
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_URL
} = process.env;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (PAYPAL_ENV !== "sandbox") fail("PAYPAL_ENV must be sandbox for this demo.");
if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID.includes("replace-with")) fail("Set PAYPAL_CLIENT_ID in local .env first.");
if (!PAYPAL_CLIENT_SECRET || PAYPAL_CLIENT_SECRET.includes("replace-with")) fail("Set PAYPAL_CLIENT_SECRET in local .env first.");
if (!PAYPAL_WEBHOOK_URL) fail("Set PAYPAL_WEBHOOK_URL to your public HTTPS tunnel URL first.");

const listenerUrl = PAYPAL_WEBHOOK_URL.replace(/\/$/, "") + "/webhooks/paypal";

async function token() {
  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`PayPal OAuth failed with HTTP ${response.status}: ${body.error || "unknown_error"}`);
  return body.access_token;
}

const accessToken = await token();
const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/webhooks`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: listenerUrl,
    event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }]
  })
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  fail(`Webhook creation failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
}

console.log(`Webhook listener URL: ${listenerUrl}`);
console.log(`Add this non-secret value to .env as PAYPAL_WEBHOOK_ID=${body.id}`);
console.log("No client secret or access token was printed.");
