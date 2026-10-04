# ProofPay Devpost Draft

## Project Name

ProofPay

## Tagline

AI verifies the work. You authorise the money. PayPal completes the payment.

## 255-Character Short Summary

ProofPay is an outcome-based payment demo where PayPal authorizes funds, AI verifies submitted work against the brief, a human approves capture, and PayPal confirms payment by webhook.

## One-Paragraph Short Description

ProofPay is a live hackathon prototype for safer outcome-based payments. A buyer authorizes GBP 25.00 with PayPal Sandbox, a supplier submits evidence, deterministic checks and OpenAI semantic verification evaluate the work, and payment capture stays blocked until the buyer explicitly clicks **Approve & Pay**. A real PayPal webhook confirms the final captured state, while an AG Grid Control Room shows the live audit trail.

## Full Long Description

ProofPay demonstrates a trust layer for digital work and agent-assisted commerce. The product separates payment authorization, evidence verification, human approval, and PayPal capture into clear, auditable steps.

In the demo, the buyer authorizes a GBP 25.00 PayPal Sandbox payment for a Verdant Volt Coffee promotional image. The first supplier deliverable is a valid image and passes deterministic checks, but OpenAI semantic verification catches that it still mentions disposable plastic cups, which violates the brief. ProofPay moves the payment to **PAYMENT HELD** and does not capture funds.

The corrected deliverable removes the issue, passes deterministic and semantic checks, and moves to **VERIFIED**. Even then, ProofPay does not capture automatically. The buyer must explicitly click **Approve & Pay**. ProofPay then requests PayPal capture and waits for a real `PAYMENT.CAPTURE.COMPLETED` webhook before showing **CAPTURED**.

The AG Grid Control Room gives judges and operators a sponsor-friendly view of the live transaction: payment state, verification state, deterministic result, AI semantic result, human decision, capture/void state, latest event, and selected-row audit history.

## Inspiration

Digital work often has a trust gap between delivery and payment. Buyers want evidence that the work matches the brief before money is captured, while suppliers want confidence that payment has been authorized. ProofPay was inspired by that gap: what if payment could be authorized up front, verified against evidence, and captured only after explicit human approval?

## What It Does

ProofPay lets a buyer authorize a PayPal payment, submit or review work evidence, run deterministic and AI semantic verification, hold payment when evidence fails, and capture only after the evidence passes and the buyer approves.

It also includes a Control Room built with AG Grid so the live transaction can be audited as it moves through **AUTHORIZED**, **PAYMENT HELD**, **VERIFIED**, and **CAPTURED**.

## How We Built It

ProofPay is built with Node.js, Express, static HTML/CSS/JavaScript, PayPal Sandbox REST APIs, OpenAI semantic verification, AG Grid Community, and local JSON state for the hackathon demo.

The server handles PayPal order authorization, authorization capture, voids, webhook signature verification, deterministic file checks, AI verification, and public state APIs. The browser UI shows the main payment flow and the AG Grid Control Room.

## Challenges We Ran Into

- Keeping AI verification useful while ensuring it could not trigger payment capture on its own.
- Making webhook confirmation reliable through a local HTTPS tunnel.
- Separating deterministic file checks from semantic judgment so failures are explainable.
- Building a Control Room that used real ProofPay state rather than a decorative analytics dashboard.
- Preparing the project for public GitHub without exposing local `.env` values or Sandbox credentials.

## Accomplishments That We're Proud Of

- A complete PayPal authorize, capture, void, and webhook-confirmed flow.
- A real AI semantic verification step with criterion-level reasoning and evidence.
- A strict human approval guard before capture.
- A clear **PAYMENT HELD** path when the submitted evidence fails.
- An AG Grid Control Room tied to real application state and audit events.
- A clean public repository with setup docs, demo docs, tests, and no committed secrets.

## What We Learned

The main lesson was that AI becomes more useful in payment workflows when it is constrained to verification and explanation, rather than direct financial action. PayPal provides the reliable payment rails, AI provides semantic review, and the product should keep a human in control of capture.

We also learned that webhook confirmation is important for trust: the app should not just assume capture is complete because an API call returned. It should listen for PayPal's event and update the audit trail.

## What's Next For ProofPay

- Multi-job persistence with a database.
- Buyer and supplier accounts.
- Agreement templates for different deliverable types.
- Richer evidence uploads and audit exports.
- Marketplace integrations.
- More robust review policies for agent-created deliverables.
- Production-grade webhook and deployment infrastructure.

## Technologies Used

- Node.js
- Express
- JavaScript
- HTML
- CSS
- PayPal Sandbox REST APIs
- PayPal webhooks
- OpenAI semantic verification
- AG Grid Community
- Node test runner

## PayPal Integration Summary

ProofPay uses PayPal Sandbox to create an order with `intent=AUTHORIZE`, redirect the buyer for approval, create an authorization after return, capture only after verification and human approval, void uncaptured authorizations, and verify `PAYMENT.CAPTURE.COMPLETED` webhooks.

## OpenAI Integration Summary

ProofPay uses OpenAI for semantic verification of submitted evidence against the agreement criteria. The result is parsed into criterion, pass/fail status, reasoning, and evidence. Failed or malformed AI output leaves payment held or uncaptured.

## AG Grid / AG Studio Summary

ProofPay includes an AG Grid Control Room at `/control-room`. It shows real transaction state, summary cards, sortable and filterable columns, row selection, and a selected-job audit trail. It also includes a narrow natural-language filter for the demo: "Show held jobs with failed semantic checks."

No separate paid AG Studio service or credentials are required for the current demo.

## Agentic Commerce Relevance

ProofPay acts as a trust layer between automated or agentic work delivery and PayPal payment execution. Agents or suppliers can produce and submit evidence, AI can evaluate the evidence against the brief, and PayPal capture remains gated by explicit human approval.

## GitHub URL

https://github.com/alexandrupop66/ProofPay
