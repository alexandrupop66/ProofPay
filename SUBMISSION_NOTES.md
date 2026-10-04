# ProofPay Submission Notes

Reusable positioning for judges and sponsor prize writeups.

## Core Framing

ProofPay separates the payment lifecycle into four auditable steps:

```text
payment authorization -> evidence verification -> human approval -> PayPal capture
```

AI verifies and recommends. Human approval remains mandatory before financial capture.

ProofPay does not claim autonomous payment capture. The buyer must explicitly click **Approve & Pay** before PayPal capture is requested.

## Overall / Grand Prize

ProofPay is a complete, live vertical slice of a safer outcome-based payment workflow. It combines PayPal authorization and capture, OpenAI semantic verification, real webhook confirmation, and an AG Grid operational Control Room into one demoable product.

The key value is not just automation. It is controlled automation: funds can be authorized, work can be checked, exceptions can be held, and final capture remains an explicit human decision.

## Most Creative

ProofPay turns a familiar payment moment into an evidence-backed workflow. Instead of treating payment as a simple checkout, it uses AI to inspect whether the work actually satisfies the brief before giving the buyer the final capture decision.

The demo makes the idea tangible: a polished creative asset passes deterministic file checks but fails the semantic brief, then becomes payable only after corrected evidence is submitted.

## Most Impactful

ProofPay addresses a real trust gap in digital work, creator marketplaces, service marketplaces, and agent-assisted delivery. Buyers need confidence that work matches the brief; suppliers need confidence that payment has been authorized.

By holding capture until verification and explicit approval, ProofPay gives both sides a clearer audit trail and a safer path from delivery to payment.

## Best Demo Delivery

The demo is designed as a clear under-3-minute story:

1. PayPal authorizes GBP 25.00 but does not capture it.
2. A failing deliverable passes file checks but fails AI semantic verification.
3. Payment is held.
4. The Control Room shows the held exception in AG Grid.
5. Corrected evidence passes verification.
6. The buyer clicks **Approve & Pay**.
7. PayPal capture is confirmed by `PAYMENT.CAPTURE.COMPLETED` webhook.

Every state change is visible in the product and the audit trail.

## Best Use Of PayPal + AI

ProofPay uses PayPal for the financial primitives and AI for evidence evaluation.

PayPal handles:

- Buyer authorization
- Authorization capture
- Authorization void
- Real Sandbox webhook confirmation

OpenAI handles:

- Semantic review of the submitted deliverable
- Criterion-level pass/fail reasoning
- Evidence-backed verification output

The two systems are deliberately separated. AI cannot move money on its own; it can only produce verification results that inform the buyer's approval decision.

## Best Use Of Agentic Commerce

ProofPay is a trust layer between automated or agentic work delivery and PayPal payment execution.

As agents increasingly create deliverables, place orders, or coordinate services, payment needs an auditable checkpoint between "work was produced" and "money was captured." ProofPay demonstrates that layer: an agent or supplier can submit evidence, AI can verify it against the agreement, and PayPal capture still requires a human decision.

That makes ProofPay relevant to agentic commerce without claiming autonomous capture or unsupervised financial action.

## AG Grid / AG Studio Sponsor Prize

ProofPay's Control Room uses AG Grid as the primary operational interface, not decoration.

It shows real ProofPay state for the active transaction, including job, amount, PayPal state, verification state, deterministic result, AI semantic result, human decision, capture/void state, last event, and updated time.

Useful grid behavior includes:

- Sorting
- Filtering
- Status filtering
- Column resizing
- Row selection
- Selected-row audit details
- A narrow natural-language filter: "Show held jobs with failed semantic checks."

The Control Room makes the live payment state auditable for judges, operators, and sponsors.
