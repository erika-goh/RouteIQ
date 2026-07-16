// Vercel Serverless Function — Gemini proxy.
// Keeps GEMINI_API_KEY server-side; the browser never sees it.
// Runs on Vercel's default Node runtime (global fetch available).

// "gemini-flash-latest" is an alias that tracks the current GA Flash model, so
// it won't break when a specific version is retired. Override with GEMINI_MODEL.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No key configured (e.g. local dev) — tell the client to use its fallback.
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

  // Agent calls request strict JSON output for reliable field extraction.
  const wantJson = body && body.json === true;
  const generationConfig = {
    temperature: wantJson ? 0.2 : 0.7,
    maxOutputTokens: 1024,
  };
  if (wantJson) generationConfig.responseMimeType = "application/json";

  try {
    const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("Gemini upstream error:", upstream.status, detail);
      return res.status(502).json({ error: "Upstream AI error" });
    }

    const data = await upstream.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) {
      return res.status(502).json({ error: "Empty AI response" });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Gemini request failed:", err);
    return res.status(500).json({ error: "AI request failed" });
  }
};
