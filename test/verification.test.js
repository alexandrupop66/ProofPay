import test from "node:test";
import assert from "node:assert/strict";
import { runDeterministicChecks } from "../src/verification.js";

function fakePngDataUrl({ width, height, bytes = 4096 }) {
  const buffer = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

test("deterministic image checks pass for a valid PNG deliverable", () => {
  const result = runDeterministicChecks({
    fileName: "creative.png",
    imageDataUrl: fakePngDataUrl({ width: 1200, height: 675 })
  });

  assert.equal(result.pass, true);
  assert.equal(result.metadata.width, 1200);
  assert.equal(result.metadata.height, 675);
  assert.equal(result.checks.every((check) => check.status === "PASS"), true);
});

test("deterministic image checks fail on undersized image", () => {
  const result = runDeterministicChecks({
    fileName: "creative.png",
    imageDataUrl: fakePngDataUrl({ width: 640, height: 360 })
  });

  assert.equal(result.pass, false);
  assert.equal(result.checks.find((check) => check.criterion.includes("Minimum dimensions")).status, "FAIL");
});
