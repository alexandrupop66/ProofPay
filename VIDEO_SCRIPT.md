# ProofPay Video Script

Target length: 100 to 120 seconds. Keep the pacing conversational and trim PayPal page transitions in editing if needed.

## 0-10 sec: Problem + Agreement Screen

Visual: ProofPay reset state, Verdant Volt Coffee agreement, GBP 25.00 amount.

Narration:

"ProofPay is for digital work where payment should depend on proof. The buyer can authorize the money up front, but capture waits until the work is verified and approved."

## 10-30 sec: PayPal Sandbox Authorize

Visual: Click **Authorise with PayPal**, approve the Sandbox payment, return to ProofPay.

Show clearly: **AUTHORIZED** and payment not captured.

Narration:

"Here the buyer authorizes a GBP 25 PayPal Sandbox payment. ProofPay now has an authorization, but no money has been captured."

## 30-50 sec: Failing Deliverable

Visual: Load failing demo, submit deliverable, run verification.

Show clearly:

- Deterministic checks **PASS**
- AI semantic criterion **FAIL**
- **PAYMENT HELD**

Narration:

"The first deliverable is a valid image, so the deterministic checks pass. But the AI semantic check catches a brief violation: the creative still mentions disposable plastic cups. ProofPay holds the payment."

## 50-65 sec: Control Room Held Exception

Visual: Open **Control Room**. Use the natural-language filter:

```text
Show held jobs with failed semantic checks.
```

Show clearly: AG Grid row, held state, failed semantic result, audit trail.

Narration:

"In the Control Room, AG Grid gives an operator view of the live transaction. We can filter straight to held jobs with failed semantic checks and see the audit trail behind the decision."

## 65-80 sec: Corrected Deliverable Verified

Visual: Return to main flow. Load corrected demo, submit, run verification.

Show clearly: deterministic and AI checks **PASS**, **VERIFIED / READY FOR APPROVAL**.

Narration:

"Now the supplier submits corrected evidence. The file checks pass, the semantic checks pass, and ProofPay marks the job verified and ready for approval."

## 80-100 sec: Human Approve & Pay

Visual: Buyer clicks **Approve & Pay**. PayPal capture starts.

Show clearly: capture is triggered by the human click.

Narration:

"Even after AI verification, ProofPay does not capture automatically. The buyer still has to click Approve & Pay before PayPal capture is requested."

## 100-115 sec: Webhook Confirms Captured

Visual: Show `PAYMENT.CAPTURE.COMPLETED`, **CAPTURED** state, then Control Room with captured value and verified audit event.

Show clearly: £25 captured and webhook/audit confirmation.

Narration:

"PayPal sends the real capture completed webhook. ProofPay verifies it, moves the job to captured, and the Control Room shows the captured value and audit event."

## 115-120 sec: Closing Line

Visual: Final ProofPay or Control Room captured state.

Narration:

"AI verifies the work. You authorise the money. PayPal completes the payment."
