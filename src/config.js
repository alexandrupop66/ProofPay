import path from "path";

const port = Number(process.env.PORT || 3000);

export const config = {
  port,
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
  paypalEnv: process.env.PAYPAL_ENV || "sandbox",
  paypalApiBase: "https://api-m.sandbox.paypal.com",
  paypalClientId: process.env.PAYPAL_CLIENT_ID,
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  statePath: path.resolve("data", "proofpay-state.json"),
  publicDir: path.resolve("public")
};

export function missingConfig() {
  const missing = [];
  if (config.paypalEnv !== "sandbox") missing.push("PAYPAL_ENV must be sandbox");
  if (!config.paypalClientId || config.paypalClientId.includes("replace-with")) missing.push("PAYPAL_CLIENT_ID");
  if (!config.paypalClientSecret || config.paypalClientSecret.includes("replace-with")) missing.push("PAYPAL_CLIENT_SECRET");
  if (!config.openAiApiKey || config.openAiApiKey.includes("replace-with")) missing.push("OPENAI_API_KEY");
  return missing;
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(config.paypalClientSecret || "\u0000", "[redacted]")
    .replaceAll(config.openAiApiKey || "\u0000", "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}
