// Vercel Serverless Function — trip-planning proxy to OpenTripPlanner (OTP).
//
// Turns a simple request into an OTP GTFS-GraphQL `plan` query and returns
// simplified multi-leg itineraries (walk -> train 16:45 -> arrive 17:20).
// Set OTP_URL to your deployed OTP base, e.g.
//   OTP_URL=https://routeiq-otp.fly.dev
// Degrades gracefully: if OTP_URL is unset or upstream fails, returns 503 so the
// client falls back to its current departures-based flow.
//
// NOTE: OTP 2.9 also exposes the newer `planConnection` query. This uses the
// classic `plan` field; verify it against your OTP build's GraphQL schema.

const GRAPHQL_PATH = "/otp/routers/default/index/graphql";

const QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String, $time: String, $arriveBy: Boolean, $num: Int) {
  plan(from: $from, to: $to, date: $date, time: $time, arriveBy: $arriveBy, numItineraries: $num,
       transportModes: [{mode: TRANSIT}, {mode: WALK}]) {
    itineraries {
      startTime
      endTime
      duration
      walkDistance
      legs {
        mode
        startTime
        endTime
        distance
        duration
        from { name lat lon }
        to { name lat lon }
        route { shortName longName }
        trip { tripHeadsign }
      }
    }
  }
}`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const base = process.env.OTP_URL;
  if (!base) {
    return res.status(503).json({ error: "Trip planner not configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const { from, to, date, time, arriveBy } = body || {};
  const valid = (p) =>
    p && typeof p.lat === "number" && typeof p.lng === "number";
  if (!valid(from) || !valid(to)) {
    return res.status(400).json({ error: "from/to {lat,lng} required" });
  }

  const variables = {
    from: { lat: from.lat, lon: from.lng },
    to: { lat: to.lat, lon: to.lng },
    date: typeof date === "string" ? date : undefined, // YYYY-MM-DD
    time: typeof time === "string" ? time : undefined, // HH:MM
    arriveBy: arriveBy === true,
    num: 3,
  };

  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}${GRAPHQL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (!upstream.ok) {
      console.error("OTP upstream error:", upstream.status);
      return res.status(502).json({ error: "Trip planner error" });
    }
    const json = await upstream.json();
    const itineraries = json?.data?.plan?.itineraries;
    if (!Array.isArray(itineraries)) {
      const detail = json?.errors?.[0]?.message || "no itineraries";
      return res.status(502).json({ error: "Trip planner error", detail });
    }

    // Simplify for the client (epoch millis -> ISO; drop OTP internals).
    const simplified = itineraries.map((it) => ({
      startTime: new Date(it.startTime).toISOString(),
      endTime: new Date(it.endTime).toISOString(),
      durationMin: Math.round(it.duration / 60),
      walkMeters: Math.round(it.walkDistance || 0),
      legs: (it.legs || []).map((l) => ({
        mode: l.mode,
        start: new Date(l.startTime).toISOString(),
        end: new Date(l.endTime).toISOString(),
        from: l.from?.name || null,
        to: l.to?.name || null,
        route: l.route?.shortName || l.route?.longName || null,
        headsign: l.trip?.tripHeadsign || null,
        distanceMeters: Math.round(l.distance || 0),
      })),
    }));

    // Transit data changes but not per-second; brief edge cache.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ itineraries: simplified });
  } catch (err) {
    console.error("OTP request failed:", err && err.message ? err.message : err);
    return res.status(502).json({ error: "Trip planner unreachable" });
  }
};
