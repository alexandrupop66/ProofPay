# ProofPay Demo Runbook

Use this sequence to record one clean live demo. Keep credentials and `.env` off screen.

## Preflight

1. Open PowerShell in:

```powershell
cd C:\Users\alexa\Desktop\ProofPay
```

2. Confirm local configuration without printing secrets:

```powershell
npm run check
```

3. Start ProofPay:

```powershell
npm start
```

Expected:

```text
ProofPay listening at http://localhost:3000
```

4. In a second terminal, start a Cloudflare tunnel to localhost:

```powershell
cloudflared tunnel --url http://localhost:3000
```

5. Copy the new public HTTPS tunnel origin only, with no trailing slash.

6. Update local `.env`:

```dotenv
PAYPAL_WEBHOOK_URL=https://your-current-public-tunnel
```

7. Create or update the PayPal Sandbox webhook subscription:

```powershell
npm run webhook:create
```

8. Save the returned non-secret `PAYPAL_WEBHOOK_ID` in `.env`.

9. Restart the ProofPay server so the new `.env` values are loaded.

10. Confirm setup:

```powershell
npm run check
```

## Browser Tabs

Prepare these tabs before recording:

- `http://localhost:3000`
- `http://localhost:3000/control-room`
- PayPal Sandbox buyer login page or approval popup when opened
- PayPal Developer dashboard webhook page, only if needed for troubleshooting

Keep `.env`, terminal output with local paths, and account credentials off screen during the recording.

## Clean Recording Sequence

1. Open `http://localhost:3000`.
2. Click **Reset demo**.
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

If verification fails because the AI API is unavailable, keep it simple: reset, confirm `npm run check`, and rerun the same demo. Do not change prompts or product behavior during filming.

### Webhook Delay

If the webhook takes longer than expected, wait up to a few minutes. For the final recorded pass, only count automatic PayPal delivery as the capture confirmation. Manual resend is useful for diagnosis, but not for the final demo take.

### PayPal Login Friction

If the Sandbox login interrupts pacing, trim that transition in editing. Keep the approval visible enough for judges to see that PayPal authorization happened.
