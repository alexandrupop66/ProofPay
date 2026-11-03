import "dotenv/config";
import { createApp } from "./src/app.js";
import { config, missingConfig } from "./src/config.js";
import { ensureStateFile } from "./src/state.js";

if (process.argv.includes("--check-env")) {
  const missing = missingConfig();
  if (missing.length) {
    console.log(`Missing local configuration: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Local sandbox and AI configuration present. Secrets were not printed.");
  process.exit(0);
}

await ensureStateFile();

const app = createApp();

app.listen(config.port, "127.0.0.1", () => {
  console.log(`ProofPay listening at http://localhost:${config.port}`);
  console.log("Sandbox only, bound to loopback. Secrets and tokens are not logged.");
});
