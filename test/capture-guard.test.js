import test from "node:test";
import assert from "node:assert/strict";

test("capture eligibility requires passed verification and verified state", () => {
  const canCapture = (state) => {
    return Boolean(state.paypal.authorizationId)
      && state.verification.overall === "PASS"
      && ["VERIFIED", "READY_FOR_APPROVAL"].includes(state.status);
  };

  assert.equal(canCapture({
    status: "PAYMENT_HELD",
    paypal: { authorizationId: "AUTH-123" },
    verification: { overall: "FAIL" }
  }), false);

  assert.equal(canCapture({
    status: "VERIFIED",
    paypal: { authorizationId: "AUTH-123" },
    verification: { overall: "PASS" }
  }), true);
});
