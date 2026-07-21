// Vercel Serverless Function — AI proxy via Vercel AI Gateway.
//
// Routes through the AI Gateway (unified API, provider failover, cost/usage
// observability, zero-retention) instead of calling a provider SDK directly.
// Auth is automatic on Vercel via the OIDC token (VERCEL_OIDC_TOKEN); for local
// dev run `vercel env pull`. A static AI_GATEWAY_API_KEY also works.
//
// The browser contract is unchanged: POST { prompt: string, json?: boolean }
// -> { reply: string }. So gemini.js needs no changes.
//
// Abuse protection: this endpoint spends money per call, so it is a public cost
// target. Origin allowlist + prompt-length cap + best-effort per-instance rate
// limit stop casual/browser abuse. For durable distributed limits, also set
// per-user limits in the AI Gateway dashboard or enable Vercel WAF Rate Limiting.

// Primary model + gateway failover list. Newest cheap tier as of 2026-07; the
// gateway resolves these to live models, so no more "retired model" breakage.
// Override the primary with GEMINI_MODEL (e.g. google/gemini-3.6-flash).
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "google/gemini-3.5-flash-lite";
const FALLBACK_MODELS = ["google/gemini-3.6-flash"];

const MAX_PROMPT_CHARS = 8000;

// Best-effort in-memory sliding-window limiter. NOTE: serverless instances are
// ephemeral and not shared, so this only throttles bursts hitting a warm
// instance — a speed bump, not a guarantee. Use AI Gateway per-user limits or
// Vercel WAF for real, distributed enforcement.
const RATE_LIMIT = { windowMs: 60_000, max: 20 };
const hits = new Map(); // ip -> number[] (request timestamps)

function isRateLimited(ip, now) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory bound
  return recent.length > RATE_LIMIT.max;
}

// Allowed browser origins. Defaults cover the app's own vercel.app deployments
// and local dev; override/extend with ALLOWED_ORIGINS (comma-separated).
function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser client (no Origin header) — rate limit covers it
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".vercel.app")) return true;
    return extra.some((o) => {
      try {
        return new URL(o).hostname === host;
      } catch {
        return o === host;
      }
    });
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin = req.headers.origin || "";
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd || "")).split(",")[0].trim() || "unknown";
  if (isRateLimited(ip, Date.now())) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many requests" });
  }

  // No gateway auth available (e.g. local dev without `vercel env pull`) — tell
  // the client to use its offline fallback.
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return res.status(503).json({ error: "AI not configured" });
  }

  // Vercel auto-parses JSON bodies, but guard for string bodies too.
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: "Prompt too long" });
  }

  const wantJson = body && body.json === true;

  try {
    // ESM-only package imported dynamically so this file stays CommonJS.
    const { generateText, APICallError } = await import("ai");

    const result = await generateText({
      model: PRIMARY_MODEL, // plain "provider/model" string routes via the gateway
      // Agent calls need strict JSON; nudge the model and keep it terse.
      system: wantJson
        ? "Respond with ONLY a single valid JSON object. No markdown, no code fences, no commentary."
        : undefined,
      prompt,
      temperature: wantJson ? 0.2 : 0.7,
      maxOutputTokens: 1024,
      providerOptions: {
        gateway: {
          models: FALLBACK_MODELS, // failover if the primary is unavailable
          tags: ["app:routeiq", wantJson ? "mode:agent" : "mode:chat"],
        },
      },
    });

    const reply = (result.text || "").trim();
    if (!reply) {
      return res.status(502).json({ error: "Empty AI response" });
    }
    return res.status(200).json({ reply });
  } catch (err) {
    // Map gateway/provider errors to sensible statuses; the client falls back.
    try {
      const { APICallError } = await import("ai");
      if (APICallError.isInstance(err)) {
        const code = err.statusCode;
        if (code === 402 || code === 429 || code === 503) {
          return res.status(code).json({ error: "AI temporarily unavailable" });
        }
      }
    } catch {
      /* ignore */
    }
    console.error("AI Gateway request failed:", err && err.message ? err.message : err);
    return res.status(502).json({ error: "Upstream AI error" });
  }
};
