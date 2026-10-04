import test from "node:test";
import assert from "node:assert/strict";
import { buildControlRoomPayload } from "../src/controlRoom.js";
import { freshState } from "../src/state.js";

test("control room payload projects live ProofPay state without secrets", () => {
  const state = {
    ...freshState(),
    status: "PAYMENT_HELD",
    paypal: {
      ...freshState().paypal,
      orderId: "ORDER-123",
      authorizationId: "AUTH-123"
    },
    verification: {
      deterministic: [{ criterion: "PNG/JPG exists", status: "PASS" }],
      ai: [{ criterion: "Forbidden concept", status: "FAIL" }],
      overall: "FAIL",
      summary: "Payment held.",
      checkedAt: "2026-10-03T16:00:00.000Z",
      error: null
    },
    events: [
      {
        at: "2026-10-03T16:00:00.000Z",
        label: "Payment held after semantic failure",
        details: {}
      }
    ]
  };

  const payload = buildControlRoomPayload(state);
  const row = payload.rows[0];

  assert.equal(row.paypalState, "HELD");
  assert.equal(row.aiSemanticResult, "FAIL");
  assert.equal(row.humanDecision, "PENDING");
  assert.equal(payload.cards.held, 25);
  assert.equal(payload.audit.events[0].event, "Payment held after semantic failure");
  assert.equal(JSON.stringify(payload).includes("CLIENT_SECRET"), false);
  assert.equal(JSON.stringify(payload).includes("OPENAI_API_KEY"), false);
});
