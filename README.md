# RouteIQ — AI-Powered GO Transit Planner

A smart transit planner for the Greater Toronto Area. Describe your trip in plain
English and a **Gemini agent** fills in the fields, pulls **live GO Transit
(Metrolinx) departures**, ranks your options by real travel time, and maps the
journey — all on a free, open mapping stack with **no billing account required**.

**Live demo:** https://route-iq-coral.vercel.app

---

## Features

- **Conversational AI agent** — say *"from Oakville GO to Hamilton GO"* and the
  assistant sets the origin/destination, asks for anything missing, runs the
  search, and answers follow-up questions. It only fills fields and gives advice
  grounded in real data — it never invents times or routes.
- **Live GO Transit data** — real departure times pulled from the Metrolinx Open
  Data API (e.g. `16:45, 17:01, 17:15`), including real-time (delay-adjusted)
  times and service alerts. Cards show a **● Live** badge when live data is used.
- **Ranked route options** — distinct options (nearest stations, or travel modes
  for a fixed station) ranked from shortest to longest travel time.
- **Route on the map** — the full journey is drawn in red on a dark map.
- **Free, keyless mapping** — Leaflet + OpenStreetMap/CARTO tiles, OSRM routing,
  and the Photon geocoder. No Google Maps, no API key, no billing.
- **Local persistence, no database** — trip stats (trips, minutes saved, CO₂,
  reroutes) and your sidebar width are stored in `localStorage`.
- **Sharp dark UI** — minimalist black/grey theme with a dark-purple accent,
  monospace data, resizable sidebar, and inline SVG icons.

## Architecture

API keys never reach the browser — two Vercel serverless functions proxy the
upstream services and read keys from the server environment:

```
Browser (index.html + app.js)
  ├── Leaflet + CARTO/OSM tiles        (no key)
  ├── OSRM routing (routing.openstreetmap.de)   (no key)
  ├── Photon geocoding (photon.komoot.io)       (no key)
  ├── /api/chat        → Gemini            (GEMINI_API_KEY, server-side)
  └── /api/gotransit   → Metrolinx Open Data (GO_TRANSIT_API_KEY, server-side)
```

Both proxies degrade gracefully: if a key or upstream is unavailable, the AI
falls back to smart offline responses and schedules fall back to bundled data,
so the app never hard-breaks. Live data is fetched per request (30s cache), so
the site stays current day to day with no maintenance.

## Tech stack

- **Frontend:** vanilla HTML/CSS/JS (ES6+), Leaflet
- **Map/routing/search:** OpenStreetMap + CARTO tiles, OSRM, Photon
- **Transit data:** Metrolinx Open Data (GO Transit) REST API
- **AI:** Google Gemini (`gemini-flash-lite-latest`) via a serverless proxy
- **Hosting:** Vercel (static site + Node serverless functions)
- **Storage:** browser `localStorage`

## Running locally

```bash
git clone <repo-url> && cd RouteIQ

# UI + map + routing + search (AI uses offline fallback, no keys needed):
npx http-server -p 8000 -c-1
# open http://localhost:8000

# Full local run with real AI + live GO data (runs the serverless functions):
printf "GEMINI_API_KEY=your_key\nGO_TRANSIT_API_KEY=your_key\n" > .env.local  # gitignored
npx vercel dev
```

## Deploying (Vercel)

1. Import the repo into Vercel (or `vercel --prod`).
2. Add environment variables (Settings → Environment Variables):

   | Variable | Purpose |
   | --- | --- |
   | `GEMINI_API_KEY` | Gemini API key ([AI Studio](https://aistudio.google.com/apikey)). Keep Google Cloud **billing disabled** to stay on the free tier. |
   | `GO_TRANSIT_API_KEY` | Metrolinx Open Data (GO Transit) API key. |
   | `GEMINI_MODEL` *(optional)* | Override the model; defaults to `gemini-flash-lite-latest`. |

3. Redeploy — env vars only apply to new deployments.

Everything runs within free tiers, so the running cost is **$0**.

## Project structure

```
RouteIQ/
├── index.html          # Layout
├── styles.css          # Sharp dark theme
├── app.js              # Map (Leaflet), routing (OSRM), agent field-control, UI
├── gemini.js           # AI client: agent (JSON actions) + offline fallback
├── go-transit-api.js   # Metrolinx client (live departures + alerts) via proxy
├── config.js           # Stations + constants (no secrets)
├── api/
│   ├── chat.js         # Gemini proxy (GEMINI_API_KEY)
│   └── gotransit.js    # Metrolinx proxy (GO_TRANSIT_API_KEY)
└── vercel.json         # Static + functions config
```

## License

MIT
