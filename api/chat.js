// Vercel Serverless Function — AI proxy calling Google's Gemini API directly.
//
// Uses the Generative Language REST endpoint with a GEMINI_API_KEY (free tier,
// no credit card) instead of the Vercel AI Gateway, which refuses requests
// until a card is on file. Get a key at https://aistudio.google.com/apikey and
// set GEMINI_API_KEY locally (.env.local) and in the Vercel project env.
//
// The browser contract is unchanged: POST { prompt: string, json?: boolean }
// -> { reply: string }. So gemini.js needs no changes.
//
// Abuse protection: this endpoint spends your Gemini quota per call, so it is a
// public target. Origin allowlist + prompt-length cap + best-effort per-instance
// rate limit stop casual/browser abuse. For durable distributed limits, enable
// Vercel WAF Rate Limiting.

// Primary + fallback Gemini models (Google Generative Language API names).
// gemini-flash-latest auto-tracks the current GA flash model. Override with
// GEMINI_MODEL. gemini-3.5-flash is the pinned fallback if the primary 404s.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-3.5-flash"];

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

  // No key configured — tell the client to use its offline fallback.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
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

  // One call to Google's Generative Language REST API for a given model.
  // Returns { reply } on success or { status } so the caller can try a fallback.
  async function callGemini(model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`;

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: wantJson ? 0.2 : 0.7,
        maxOutputTokens: 1024,
        // Agent calls need strict JSON — ask the model for JSON directly.
        ...(wantJson ? { responseMimeType: "application/json" } : {}),
      },
      ...(wantJson
        ? {
            systemInstruction: {
              parts: [
                {
                  text: "Respond with ONLY a single valid JSON object. No markdown, no code fences, no commentary.",
                },
              ],
            },
          }
        : {}),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      let detail = "";
      try {
        detail = (await resp.json())?.error?.message || "";
      } catch {
        /* ignore */
      }
      return { status: resp.status, detail };
    }

    const data = await resp.json();
    const reply = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    // A safety/recitation block returns candidates without text.
    if (!reply) {
      const blocked = data.promptFeedback?.blockReason;
      return { status: blocked ? 400 : 502, detail: blocked || "empty" };
    }
    return { reply };
  }

  try {
    let result = await callGemini(PRIMARY_MODEL);
    // Retry once on a fallback model if the primary is missing/unavailable.
    if (!result.reply && (result.status === 404 || result.status === 503)) {
      for (const fb of FALLBACK_MODELS) {
        result = await callGemini(fb);
        if (result.reply) break;
      }
    }

    if (result.reply) {
      return res.status(200).json({ reply: result.reply });
    }

    const code = result.status || 502;
    if (code === 429 || code === 503) {
      return res.status(code).json({ error: "AI temporarily unavailable" });
    }
    console.error("Gemini request failed:", code, result.detail || "");
    return res.status(502).json({ error: "Upstream AI error" });
  } catch (err) {
    console.error("Gemini request threw:", err && err.message ? err.message : err);
    return res.status(502).json({ error: "Upstream AI error" });
  }
};
