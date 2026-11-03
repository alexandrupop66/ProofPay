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

The OpenAI call requests strict JSON output. ProofPay requires each of the four predefined semantic criteria exactly once, with a valid pass/fail status and non-empty reasoning and evidence. Missing, duplicate, substituted, inconsistent or malformed criteria, failed API calls, and failed criteria leave the payment authorised but not captured.

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
npm ci
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

In the local `.env`, replace every placeholder with your OWN Sandbox, AI and access-password values. `PROOFPAY_ACCESS_PASSWORD` must be at least 16 characters. Do not share developer credentials with judges.

Run environment validation:

```powershell
npm run check
```

Start the app:

```powershell
npm start
```

Open and sign in with the local access password:

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
PROOFPAY_ACCESS_PASSWORD=replace-with-your-own-long-random-password
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

- Local single-operator password authentication protects state reads and every payment-changing API endpoint. The password is never embedded in browser JavaScript.
- A random, HttpOnly, SameSite=Lax session cookie and per-session CSRF token protect changes from cross-site requests; login attempts are rate limited.
- PayPal buyer approval still occurs through PayPal Sandbox. The signed-in operator must separately click **Approve & Pay** to request capture.
- All state mutations are serialised in one Node process. Reset cannot discard an active or uncertain authorisation; an uncertain authorisation or capture remains locked until an OAuth-authenticated, read-only PayPal Show Order reconciliation confirms the result.
- A verified `PAYMENT.CAPTURE.COMPLETED` webhook is correlated to the known capture ID, order, completed status, final-capture flag, amount and currency. If a capture response timed out before its ID was stored, ProofPay additionally requires read-only PayPal order evidence tying exactly one completed capture to the original authorisation. A bad signature, mismatch, ambiguity or unexpected event cannot confirm capture; duplicates are idempotent.
- Sensitive PayPal identifiers, callback nonces, uploaded image data and secrets are not exposed by state or Control Room APIs. `.env` is ignored by Git.
- The server binds to `127.0.0.1` for local use. An HTTPS tunnel is needed only when actively receiving real Sandbox webhooks. Do **not** publish the local tunnel as a judge login link.

## Judge Reproduction (Own Credentials)

The safest judge experience is to clone this repository, run `npm ci` and `npm test` (no credentials, transactions or external API calls), review the submitted 1-minute-5-second demonstration, and optionally reproduce the **real** PayPal + OpenAI scenario locally using independently obtained credentials.

For full live reproduction, a judge must supply their own PayPal Sandbox REST app client ID and secret, Sandbox personal buyer account, OpenAI API key, `PROOFPAY_ACCESS_PASSWORD`, and a public HTTPS webhook tunnel. They must register `PAYMENT.CAPTURE.COMPLETED` for their own app and set its own `PAYPAL_WEBHOOK_ID`. The latter is mandatory and missing verification never counts as success. Read [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the full sequence.

`npm test` uses **mocked provider responses** to exercise the real Express routes. It cannot demonstrate real Sandbox authorisation, an actual OpenAI result or real webhook delivery. The pre-recorded demonstration is evidence of the original workflow, not a substitute for a fresh integration test on this hardening branch.

## Known Limitations

- Hackathon prototype with **one** local operator and one active job; no multi-user identity, buyer/supplier role separation, encrypted-at-rest persistence or production-grade session store.
- Local JSON state and in-memory sessions require a single Node process. Sessions are lost on restart; an active payment needs manual reconciliation if the process fails mid-capture.
- The app does not cryptographically bind the local operator to the PayPal payer, so the local password must only be given to the authorised demo buyer.
- AI semantic judgement can be incorrect or influenced by untrusted supplier evidence. Human approval and review remain essential.
- Failed or timed-out PayPal capture requests might still have succeeded remotely. ProofPay deliberately blocks automatic retries and voids until Sandbox reconciliation.
- Real PayPal and OpenAI integrations require the evaluator's own credentials, internet access and (for webhooks) a temporary HTTPS tunnel; OpenAI requests may incur charges.
- This has not been assessed or deployed as a production payment system.

## Future Extensions

- Multi-job persistence with a database.
- Role-based buyer and supplier accounts.
- Multi-criterion agreement templates.
- Supplier evidence uploads backed by object storage.
- Richer audit exports for finance and dispute review.
- Marketplace or platform integrations.

## License

MIT. See [LICENSE](LICENSE).
