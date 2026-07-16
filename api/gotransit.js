// Vercel Serverless Function — GO Transit (Metrolinx Open Data) proxy.
// Keeps GO_TRANSIT_API_KEY server-side and works around the API's lack of CORS.
//
// The client passes the Open Data path via ?path=..., e.g.
//   /api/gotransit?path=api/V1/Stop/NextService/UN
// and this function forwards it to the Metrolinx host with the key attached.
// Only Metrolinx Open Data paths are allowed (no open proxy).

const BASE = "https://api.openmetrolinx.com/OpenDataAPI/";

module.exports = async (req, res) => {
  const apiKey = process.env.GO_TRANSIT_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "GO Transit not configured" });
  }

  const path = req.query && req.query.path;
  // Only allow the versioned Open Data API paths; block traversal / extra query.
  if (
    !path ||
    typeof path !== "string" ||
    !/^api\/V\d+\/[A-Za-z0-9/_.-]+$/.test(path) ||
    path.includes("..")
  ) {
    return res.status(400).json({ error: "Invalid or missing path" });
  }

  const url = `${BASE}${path}?key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    if (!upstream.ok) {
      console.error("GO Transit upstream error:", upstream.status);
      return res.status(502).json({ error: "Upstream error", status: upstream.status });
    }
    const data = await upstream.json().catch(() => null);
    if (data === null) {
      return res.status(502).json({ error: "Bad upstream JSON" });
    }
    // Short cache — transit data changes but not every second.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(data);
  } catch (err) {
    console.error("GO Transit request failed:", err);
    return res.status(500).json({ error: "Request failed" });
  }
};
