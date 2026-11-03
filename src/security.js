import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE = "proofpay_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const failedLogins = new Map();

function sameOrigin(req) {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

function cookieValue(req) {
  const entry = (req.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  return entry ? entry.slice(COOKIE.length + 1) : null;
}

function getSession(req) {
  const token = cookieValue(req);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function passwordMatches(supplied) {
  if (typeof supplied !== "string" || !config.accessPassword || config.accessPassword.length < 16 || config.accessPassword.startsWith("replace-with")) return false;
  const expected = crypto.createHash("sha256").update(config.accessPassword).digest();
  const actual = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expected, actual);
}

export function installSecurity(app) {
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (_req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/session", (req, res) => {
    const session = getSession(req);
    res.json({ authenticated: Boolean(session), csrfToken: session?.csrfToken || null });
  });

  app.post("/api/login", (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Cross-site login is not permitted." });
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON is required." });
    if (!config.accessPassword || config.accessPassword.length < 16 || config.accessPassword.startsWith("replace-with")) {
      return res.status(503).json({ error: "Set a local PROOFPAY_ACCESS_PASSWORD of at least 16 characters." });
    }

    const key = req.ip || "unknown";
    const attempt = failedLogins.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 5) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    if (!passwordMatches(req.body?.password)) {
      const count = attempt?.until > Date.now() ? attempt.count + 1 : 1;
      failedLogins.set(key, { count, until: Date.now() + 15 * 60_000 });
      return res.status(401).json({ error: "Incorrect access password." });
    }

    failedLogins.delete(key);
    const token = crypto.randomBytes(32).toString("hex");
    const session = { csrfToken: crypto.randomBytes(32).toString("hex"), expiresAt: Date.now() + SESSION_MS };
    sessions.set(token, session);
    const https = req.secure || req.get("x-forwarded-proto") === "https";
    res.set("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${https ? "; Secure" : ""}`);
    res.json({ authenticated: true, csrfToken: session.csrfToken });
  });

  function requireUser(req, res, next) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Sign in to access ProofPay." });
    req.proofpaySession = session;
    next();
  }

  function requireCsrf(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (!sameOrigin(req)) return res.status(403).json({ error: "Cross-site requests are blocked." });
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON is required." });
    const sent = req.get("x-csrf-token");
    const expected = req.proofpaySession?.csrfToken;
    if (!sent || !expected || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
      return res.status(403).json({ error: "Invalid request token." });
    }
    next();
  }

  return { requireUser, requireCsrf };
}
