# Real transit routing with OpenTripPlanner (OTP)

Today RouteIQ shows OSRM directions to a nearby station + a live departures list.
This stack replaces that with **real multi-leg GO itineraries** (walk → board the
16:45 train → arrive 17:20) computed by OTP from GO's GTFS schedule.

OTP is a stateful JVM service that holds a routing graph in memory, so it **cannot
run on Vercel functions** — it needs an always-on container. Vercel calls it
through `api/plan.js` (set `OTP_URL`).

```
Browser → /api/plan (Vercel) → OTP GraphQL (Fly.io/Render/…) → itineraries
```

## 1. Run locally (test before deploying)

```bash
cd otp
./fetch-data.sh        # downloads GO GTFS + GTA OSM into ./data (needs curl; osmium optional but recommended)
docker compose up      # builds the graph, then serves on http://localhost:8080
```

First build takes a few minutes. When it logs `Grizzly server running`, open
http://localhost:8080 for the debug map, or POST a query to
`http://localhost:8080/otp/routers/default/index/graphql`.

Point the app at it locally:
```bash
# in the repo root
echo 'OTP_URL=http://localhost:8080' >> .env.local
vercel dev             # /api/plan now returns real itineraries
```

## 2. Deploy OTP (recommended: Fly.io)

Fly.io suits a small always-on JVM container. Alternatives: Render, Railway, a
tiny AWS/GCP VM. Whichever you pick, the pattern is: build the graph once, ship
it in the image (or a volume), serve with `--load --serve`.

```bash
# from otp/ , after fetch-data.sh
flyctl launch --no-deploy            # creates fly.toml (pick a name, e.g. routeiq-otp)
# Give the machine ~4GB RAM (GTA-cropped OSM). Set internal port 8080.
flyctl deploy
```

For faster/cheaper starts, prebuild the graph and use `--load`:
```bash
docker run --rm -v "$PWD/data:/var/opentripplanner" opentripplanner/opentripplanner:2.9.0 --build --save
# commit the resulting data/graph.obj into the image, then serve with: --load --serve
```

Then set the proxy target in Vercel:
```bash
vercel env add OTP_URL production      # e.g. https://routeiq-otp.fly.dev
```

## 3. Wire the client (next step)

`api/plan.js` is ready. The remaining work is in `app.js` `findRoutes()`: when a
TRANSIT trip is requested, POST `{from:{lat,lng}, to:{lat,lng}, date, time, arriveBy}`
to `/api/plan` and render the returned `itineraries[]` as route cards (each leg =
a row: mode, route/headsign, board time → arrive time). Keep the current
departures-based flow as the fallback when `/api/plan` returns 503. This is
deferred until OTP is live so it can be tested against real responses.

## Things to verify (don't trust blindly)

- **GO GTFS URL** in `fetch-data.sh` — Metrolinx rotates asset URLs. If it 404s,
  get the current link from https://www.metrolinx.com/en/about-us/open-data .
- **GraphQL schema** — OTP 2.9 also has the newer `planConnection` query;
  `api/plan.js` uses the classic `plan`. Confirm against your build's schema
  (the debug UI's GraphiQL explorer).
- **GTFS-realtime** — `router-config.json` has a commented `stop-time-updater`
  for live delays; fill in the real GO GTFS-rt URL before enabling.
- **Licensing/terms** — Metrolinx Open Data and OSM/Geofabrik each have terms;
  review before production use.
