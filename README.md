# ProofPay

ProofPay is a hackathon vertical slice for outcome-based payments:

**Agreement -> PayPal authorized -> work submitted -> deterministic and AI verification -> human approval -> PayPal capture or void.**

Core demo line:

> AI verifies the work. You authorise the money. PayPal completes the payment.

ProofPay shows how a buyer can authorize funds up front, use AI to verify whether the submitted work satisfies agreed criteria, and still keep payment capture behind an explicit human approval step.

## Problem

Digital work is often paid for before there is a clear, auditable signal that the submitted deliverable matches the brief. That creates friction for buyers and suppliers:

- Buyers want confidence before releasing money.
- Suppliers want proof that payment was authorized.
- Platforms need an audit trail that explains why payment was held, captured, or voided.

## Solution

ProofPay combines PayPal authorization, deterministic deliverable checks, semantic AI review, and a human-in-the-loop approval guard.

In the demo, a supplier submits a Verdant Volt Coffee promotional image. The first submission passes the basic file checks but fails the semantic criterion because it mentions disposable plastic cups. Payment is held, not captured. The corrected submission removes the issue, verification passes, and the buyer can click **Approve & Pay**. PayPal capture is confirmed by webhook before ProofPay marks the transaction as **CAPTURED**.

## Demo Flow

1. Reset the demo.
2. Create and approve a GBP 25.00 PayPal Sandbox authorization.
3. Return to ProofPay and confirm the state is **AUTHORIZED**.
4. Load the failing demo deliverable and submit it.
5. Run verification.
6. Deterministic checks pass, AI semantic verification fails, and ProofPay shows **PAYMENT HELD**.
7. Open **Control Room** to show the held exception in AG Grid.
8. Load the corrected deliverable, submit it, and run verification again.
9. ProofPay shows **VERIFIED**.
10. The buyer clicks **Approve & Pay**.
11. PayPal captures the authorization.
12. PayPal sends `PAYMENT.CAPTURE.COMPLETED`; ProofPay verifies the webhook and shows **CAPTURED**.

To demonstrate the rejection path, reset the demo, authorize a new payment, then click **Reject & Void** before capture.

## PayPal Integration

ProofPay uses PayPal Sandbox REST APIs to:

- Create an order with `intent=AUTHORIZE`.
- Redirect the buyer to approve the order.
- Create an authorization after buyer return.
- Capture only after ProofPay verification passes and the buyer clicks **Approve & Pay**.
- Void an uncaptured authorization when the buyer rejects the work.
- Verify real PayPal webhook signatures for `PAYMENT.CAPTURE.COMPLETED`.

The webhook endpoint is:

```text
POST /webhooks/paypal
```

## AI Verification Architecture

ProofPay separates deterministic checks from semantic checks.

Deterministic checks confirm:

- The deliverable exists.
- The uploaded asset is PNG or JPG.
- The image is at least 800 x 450 pixels.
- The file size is valid for review.

AI semantic checks confirm:

- The creative prominently mentions sustainability.
- The tone is professional and promotional.
- The exact slogan `Brew Better. Waste Less.` is present.
- The creative does not contain or promote disposable plastic cups.

The OpenAI call requests strict JSON output. ProofPay safely parses the model response into criterion, pass/fail status, reasoning, and evidence. Malformed AI output, failed API calls, or failed criteria leave the payment authorized but not captured.

## Human-In-The-Loop Safety

ProofPay deliberately does not let AI capture money by itself.

Capture is blocked unless all of these are true:

- A PayPal authorization exists.
- Deterministic checks pass.
- AI semantic checks pass.
- The buyer explicitly clicks **Approve & Pay**.

This keeps AI in the verification role and the human in the payment decision role.

## AG Grid Control Room

The `/control-room` screen is a sponsor-focused operational view built with AG Grid. It reads real local ProofPay state and shows the active job as it moves through:

```text
AUTHORIZED -> PAYMENT HELD -> VERIFIED -> CAPTURED
```

The grid includes payment state, verification state, deterministic result, AI semantic result, human decision, capture/void state, last event, and update time. It supports sorting, filtering, status filtering, row selection, and a selected-row audit trail.

Summary cards highlight authorized, held, captured, voided, and exception value.

## Technology Stack

- Node.js
- Express
- Static HTML, CSS, and browser JavaScript
- PayPal Sandbox REST APIs
- PayPal webhook signature verification
- OpenAI semantic verification
- AG Grid Community
- Node test runner
- Local JSON state for the hackathon demo

## Local Setup

Install dependencies:

```powershell
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Run environment validation:

```powershell
npm run check
```

Start the app:

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

Control Room:

```text
http://localhost:3000/control-room
```

## Environment Variables

Use placeholders in `.env.example` only. Put real values in local `.env`, which is ignored by Git.

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your-sandbox-rest-app-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-rest-app-client-secret

OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini

APP_BASE_URL=http://localhost:3000
PORT=3000

PAYPAL_WEBHOOK_URL=https://your-public-https-tunnel
PAYPAL_WEBHOOK_ID=your-paypal-sandbox-webhook-id
```

For real webhook delivery, start an HTTPS tunnel to `http://localhost:3000`, set `PAYPAL_WEBHOOK_URL`, then create or update the Sandbox webhook subscription:

```powershell
npm run webhook:create
```

Subscribe at minimum to:

```text
PAYMENT.CAPTURE.COMPLETED
```

## Architecture And State Flow

```text
AUTHORIZATION REQUIRED
  -> PayPal buyer approval
AUTHORIZED
  -> supplier submits deliverable
DELIVERABLE SUBMITTED
  -> deterministic checks + OpenAI semantic verification
PAYMENT HELD
  -> corrected evidence submitted
VERIFIED
  -> buyer clicks Approve & Pay
CAPTURING
  -> PayPal webhook verified
CAPTURED
```

Rejecting before capture moves the authorization to:

```text
VOIDED
```

Demo state is stored locally in:

```text
data/proofpay-state.json
```

That file is generated at runtime and ignored by Git.

## Security Notes

- `.env` is ignored by Git.
- Secrets are not sent to the browser.
- PayPal access tokens are server-side only.
- OpenAI API keys are server-side only.
- Capture is guarded server-side, not only in the UI.
- Webhook signature verification is performed through PayPal when `PAYPAL_WEBHOOK_ID` is configured.
- Webhook delivery changes state to **CAPTURED** only when the event matches the expected capture.

## Known Limitations

- This is a hackathon demo, not a production payment platform.
- State is stored in local JSON rather than a database.
- The demo supports one active job at a time.
- PayPal and OpenAI calls require live credentials.
- Sandbox webhook delivery depends on the current public HTTPS tunnel.

## Future Extensions

- Multi-job persistence with a database.
- Role-based buyer and supplier accounts.
- Multi-criterion agreement templates.
- Supplier evidence uploads backed by object storage.
- Richer audit exports for finance and dispute review.
- Marketplace or platform integrations.

## License

MIT. See [LICENSE](LICENSE).
