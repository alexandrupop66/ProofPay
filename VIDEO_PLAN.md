# ProofPay Demo Video Plan

Target length: 100 to 120 seconds.

## 0-10 sec: Problem And Agreement

Show ProofPay at the reset state with the Verdant Volt Coffee agreement and GBP 25.00 amount.

Voiceover:

"ProofPay helps buyers authorize payment up front, verify submitted work, and only capture after approval."

## 10-30 sec: PayPal Sandbox Authorize

Click **Authorise with PayPal**, approve the Sandbox payment, and return to ProofPay.

Show:

- State changes to **AUTHORIZED**.
- Copy says payment is authorized but not captured.

Voiceover:

"The buyer authorizes GBP 25 in PayPal Sandbox. The money is not captured yet."

## 30-50 sec: Failing Deliverable Held

Click **Load failing demo**, submit the deliverable, then run verification.

Show:

- Deterministic checks pass.
- AI semantic verification fails because the creative mentions disposable plastic cups.
- State changes to **PAYMENT HELD**.

Voiceover:

"The file is valid, but the semantic check catches a brief violation, so ProofPay holds payment."

## 50-65 sec: Control Room Exception

Open **Control Room**.

Show:

- AG Grid row for the active ProofPay job.
- Held value and exception count.
- Selected-row audit history.

Voiceover:

"The Control Room gives judges and operators a live audit view of the job, payment state, and verification result."

## 65-80 sec: Corrected Deliverable Verified

Return to the main flow. Load the corrected demo, submit it, and run verification again.

Show:

- Deterministic checks pass.
- AI semantic checks pass.
- State changes to **VERIFIED**.

Voiceover:

"The corrected evidence removes the issue, and the payment becomes ready for human approval."

## 80-100 sec: Human Approve And Pay

Click **Approve & Pay**.

Show:

- ProofPay moves to **CAPTURING**.
- PayPal capture request succeeds.

Voiceover:

"Even after AI verification, ProofPay still requires the buyer to explicitly approve capture."

## 100-115 sec: Webhook Confirmed Captured

Wait for PayPal webhook confirmation, then show the captured state and Control Room.

Show:

- `PAYMENT.CAPTURE.COMPLETED`.
- State changes to **CAPTURED**.
- Control Room captured value.

Voiceover:

"PayPal confirms capture by webhook, ProofPay verifies it, and the audit trail is complete."

## 115-120 sec: Closing Line

Voiceover:

"AI verifies the work. You authorise the money. PayPal completes the payment."

## Filming Notes

- Keep the server and HTTPS webhook tunnel running before recording.
- Use the Sandbox buyer account already prepared locally.
- Keep `.env` and credentials off screen.
- If PayPal approval is slow, trim the browser transition in editing.
- Keep the final video under 3 minutes.
