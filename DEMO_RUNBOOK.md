# ProofPay Demo Runbook

Use this sequence to record one clean live demo. Keep credentials and `.env` off screen.

## Judge Preflight (Own Test Credentials)

**No payment or AI credentials are necessary to run automated tests.** Run `npm ci` then `npm test` to exercise the actual Express routes using mocked PayPal and OpenAI responses.

For the optional **real Sandbox** end-to-end walkthrough, do the following on the judge's own computer. This calls PayPal Sandbox and OpenAI and must be initiated deliberately; it is not part of automated testing.

1. Install Node.js 22+, obtain a **PayPal Sandbox REST app** (Client ID and Secret), a separate PayPal Sandbox personal buyer account, and an **OpenAI API key** belonging to the evaluator. Never use or request the developer's credentials.
2. In PowerShell, open the cloned ProofPay folder and install locked dependencies:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
```

3. Set `PAYPAL_ENV=sandbox`, the judge's `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `OPENAI_API_KEY`, `APP_BASE_URL=http://localhost:3000`, and a **unique random** `PROOFPAY_ACCESS_PASSWORD` (at least 16 characters). Keep `.env` private.
4. Start a temporary HTTPS tunnel to the local port in a separate terminal, for example:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

5. Set `PAYPAL_WEBHOOK_URL` to its public HTTPS origin without trailing slash. Create a **Sandbox** webhook subscription for `PAYMENT.CAPTURE.COMPLETED` on the judge's own REST app:

```powershell
npm run webhook:create
```

6. Copy the returned **webhook ID only** into the private `.env` as `PAYPAL_WEBHOOK_ID`. The script creates a remote subscription; do not rerun it unnecessarily. A missing or placeholder ID disables capture confirmation. PayPal’s generic webhook simulator is **not** a substitute for a real app-associated delivery when using the signature-verification REST endpoint; see [PayPal webhook integration](https://developer.paypal.com/api/rest/webhooks/rest/).
7. Check the environment, then start ProofPay:

```powershell
npm run check
npm start
```

8. Visit `http://localhost:3000/login.html`, enter the locally configured demo access password, and continue to `http://localhost:3000`. Use that browser session throughout the PayPal return flow.
9. Keep the tunnel private except for PayPal webhook delivery. The local app binds to `127.0.0.1`; judges should **not** visit the tunnel address or enter passwords through a shared developer instance.

The already submitted video is **1 minute 5 seconds**, within the three-minute limit. No new video or Devpost edit is part of this hardening.

## Browser Tabs

Prepare these tabs before recording:

- `http://localhost:3000`
- `http://localhost:3000/control-room`
- PayPal Sandbox buyer login page or approval popup when opened
- PayPal Developer dashboard webhook page, only if needed for troubleshooting

Keep `.env`, terminal output with local paths, and account credentials off screen during the recording. The buyer must remain signed in to ProofPay for **Approve & Pay** to work.

## Clean Recording Sequence

1. Open `http://localhost:3000`.
2. Click **Reset demo** only when no active PayPal authorisation exists, or after the previous transaction is **CAPTURED** or **VOIDED**.
3. Confirm the main state is **AUTHORIZATION REQUIRED** and amount is GBP 25.00.
4. Click **Authorise with PayPal**.
5. Log in as the PayPal Sandbox buyer.
6. Approve the GBP 25.00 payment.
7. Return to ProofPay.
8. Confirm state is **AUTHORIZED** and the copy says payment is not captured.
9. Click **Load failing demo**.
10. Click **Submit deliverable**.
11. Click **Run verification**.
12. Confirm deterministic checks pass.
13. Confirm at least one AI semantic criterion fails.
14. Confirm state is **PAYMENT HELD**.
15. Open `/control-room`.
16. In the natural-language filter field, enter:

```text
Show held jobs with failed semantic checks.
```

17. Click **Apply**.
18. Show the AG Grid held row, exception value, and selected-row audit.
19. Return to the main ProofPay tab.
20. Click **Load corrected demo**.
21. Click **Submit deliverable**.
22. Click **Run verification**.
23. Confirm deterministic checks pass.
24. Confirm AI semantic checks pass.
25. Confirm state is **VERIFIED** and the approval section is ready.
26. Click **Approve & Pay**.
27. Wait for **CAPTURING** to become **CAPTURED**.
28. Confirm the live trail includes PayPal capture/webhook confirmation.
29. Open `/control-room`.
30. Show £25 captured, the selected row, and the verified webhook audit event.

## Expected Timing

- PayPal approval and return: usually the longest visual transition.
- AI verification: wait on the main page until checks render.
- Capture confirmation: wait for the PayPal webhook; keep Control Room ready for the final state.

## Contingencies

### Tunnel Changes

If the Cloudflare tunnel URL changes, update `PAYPAL_WEBHOOK_URL` in `.env`, rerun `npm run webhook:create`, save the new `PAYPAL_WEBHOOK_ID` if it changes, and restart the server.

### PayPal Webhook URL Is Stale

If capture succeeds but ProofPay stays in **CAPTURING**, check that the PayPal Sandbox webhook points to:

```text
https://your-current-public-tunnel/webhooks/paypal
```

Then restart ProofPay and run a fresh authorization. Do not try to void or reuse an already captured authorization.

### AI Response Failure

If verification fails because the AI API is unavailable, the payment remains authorised and held. Do **not** reset while that authorisation is active. Either wait and resubmit/re-run verification against the same active authorisation, or use **Reject & Void** and wait for PayPal to confirm the void before resetting. Confirm `npm run check` before a fresh demo. Do not change prompts or product behaviour during filming.

### Capture API Error or Timeout

If capture was requested but its outcome is uncertain, ProofPay intentionally remains **CAPTURING** and blocks retries, voids and resets. Inspect the PayPal Sandbox transaction before making any financial decision; do not assume that the lack of webhook means funds were not captured.

A delayed, verified `PAYMENT.CAPTURE.COMPLETED` webhook can safely recover this state only when its capture, authorisation, order, amount and currency correlate to the current transaction. Unmatched or malformed events never settle the local transaction.

### Webhook Delay

If the webhook takes longer than expected, wait up to a few minutes. For the final recorded pass, only count automatic PayPal delivery as the capture confirmation. Manual resend is useful for diagnosis, but not for the final demo take.

### PayPal Login Friction

If the Sandbox login interrupts pacing, trim that transition in editing. Keep the approval visible enough for judges to see that PayPal authorization happened.
