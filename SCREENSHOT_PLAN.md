# ProofPay Screenshot Plan

Recommended Devpost screenshots for a five-image gallery.

## 1. AUTHORIZED State

Exact state: **AUTHORIZED**

What must be visible:

- ProofPay main flow
- GBP 25.00 amount
- State pill showing **AUTHORIZED**
- Text explaining payment is authorized but not captured
- Agreement criteria

Suggested caption:

"The buyer has authorized GBP 25.00 with PayPal, but ProofPay has not captured payment."

Recommended crop/viewport:

- Desktop viewport, 1440 x 900 or similar
- Crop to include the left workflow rail, state header, amount, and agreement panel

## 2. PAYMENT HELD With Semantic Failure

Exact state: **PAYMENT HELD**

What must be visible:

- Deterministic checks showing **PASS**
- AI semantic checks showing at least one **FAIL**
- Failure evidence or reasoning mentioning the disposable plastic cups criterion
- State pill showing **PAYMENT HELD**
- Human approval buttons still blocked or capture not available

Suggested caption:

"The file is valid, but AI semantic verification catches a brief violation and holds payment."

Recommended crop/viewport:

- Desktop viewport, 1440 x 900 or similar
- Crop around the state header and verification panels

## 3. Control Room Held Exception

Exact state: **PAYMENT HELD**

What must be visible:

- `/control-room`
- AG Grid active jobs table
- Row showing GBP 25.00, held/payment exception state, deterministic pass, AI semantic fail
- Held value or exception count summary card
- Natural-language filter text: "Show held jobs with failed semantic checks."
- Selected job audit panel

Suggested caption:

"AG Grid Control Room shows the held exception and audit trail for the active ProofPay job."

Recommended crop/viewport:

- Desktop viewport, 1440 x 900 or wider
- Crop to include summary cards, AG Grid row, and selected audit details

## 4. VERIFIED / Ready For Approval

Exact state: **VERIFIED**

What must be visible:

- State pill showing **VERIFIED**
- Deterministic checks **PASS**
- AI semantic checks **PASS**
- Human approval section showing **Ready for approval**
- **Approve & Pay** button available

Suggested caption:

"Corrected evidence passes verification, but human approval is still required before capture."

Recommended crop/viewport:

- Desktop viewport, 1440 x 900 or similar
- Crop around verification panels and human approval section

## 5. CAPTURED + Control Room Audit

Exact state: **CAPTURED**

What must be visible:

- Control Room or main flow showing **CAPTURED**
- £25 captured summary
- `PAYMENT.CAPTURE.COMPLETED` or PayPal webhook event in the audit trail
- Webhook verified field or audit detail visible
- Selected row for the active job

Suggested caption:

"PayPal confirms capture by webhook, and ProofPay records the verified captured state."

Recommended crop/viewport:

- Desktop viewport, 1440 x 900 or wider
- Crop to include the captured summary card, AG Grid row, and selected audit panel
