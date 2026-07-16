# RouteIQ - Smart Transit Planning Assistant

An intelligent transit planning application for the Greater Toronto Area that uses Google Maps and Gemini AI to provide smart route recommendations with real-time traffic analysis.

## Features

- **Smart Route Finding** - Find multiple routes to different GO Bus terminals
- **Real-time Traffic Analysis** - See traffic conditions for each route (low/medium/heavy)
- **AI Assistant** - Get intelligent recommendations from Gemini AI based on traffic and timing
- **Turn-by-turn Navigation** - Navigate routes with Google Maps integration
- **Bus Schedule Integration** - View departure times and plan your trip
- **CO2 Tracking** - See environmental impact of different travel modes
- **Trip Statistics** - Track your trips and CO2 savings over time

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Map**: Leaflet + CARTO/OpenStreetMap tiles — **free, no API key, no billing**
- **Routing**: OSRM (FOSSGIS public instances) — free, no key
- **Address search**: Photon geocoder — free, no key
- **AI**: Google Generative AI (Gemini) via a serverless proxy (`/api/chat`) — free tier
- **Transit data**: GO Transit API (integrated, handles CORS gracefully)
- **Storage**: Browser LocalStorage for stats persistence
- **Deployment**: Vercel (recommended)

## Cost / billing (important)

This app is designed to run at **$0 with no billing account**:

- **Map, routing, address search** use free OpenStreetMap-based services — no
  API key, no credit card, no Google Cloud billing.
- **Gemini AI** runs on the **free tier**, which requires billing to be
  **disabled** on the Google Cloud project (enabling billing removes the free
  tier). The free tier only covers Flash / Flash-Lite models — set `GEMINI_MODEL`
  to whatever Google AI Studio lists as free for your project.
- If Gemini is unavailable for any reason, the assistant automatically falls
  back to smart, data-driven offline responses.

## AI architecture (important)

The Gemini API key is **never** shipped to the browser. The client (`gemini.js`)
POSTs to the `/api/chat` serverless function, which reads `GEMINI_API_KEY` from
the server environment and calls Gemini. If the key/backend is unavailable
(e.g. plain static hosting or local `http-server`), the assistant automatically
falls back to smart, data-driven offline responses — so the demo never looks
broken.

## Getting Started

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/routeiq.git
cd routeiq
```

2. API keys: **none required** for the map, routing, or search. The only
   optional key is Gemini (server-side) for real AI responses — get one from
   [Google AI Studio](https://aistudio.google.com/apikey) with billing disabled
   (free tier). Without it, the assistant uses its offline fallback.

3. **UI + map preview** (AI uses offline fallback, no key needed):
```bash
npx http-server -p 8000 -c-1
```
Open http://localhost:8000. The map, routing, and address search all work here.

4. **Full local preview with real AI** (runs the `/api/chat` function locally):
```bash
echo "GEMINI_API_KEY=your_key_here" > .env.local   # .env.local is gitignored
npx vercel dev
```

## Deployment

### Option 1: Vercel (Recommended - 1 minute setup)

1. **Push to GitHub** (see instructions below)

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Click "Import"

3. **Add Environment Variable** (in the Vercel account/team that owns the project):
   - Dashboard: Settings → Environment Variables
   - Add `GEMINI_API_KEY` = your Gemini key (server-side — do NOT prefix with `NEXT_PUBLIC`)
   - Apply to Production (and Preview if you use preview URLs) → Save
   - Or via CLI: `vercel env add GEMINI_API_KEY` (must be logged into the owning account/team)

4. **Deploy / Redeploy**:
   - Vercel auto-deploys on push to main
   - Env vars only apply to **new** deployments — redeploy after adding the key
   - Your site is live at `https://routeiq-yourname.vercel.app`

### Option 2: GitHub Pages

1. Update `config.js` with your API keys (or use environment variables)
2. Push to GitHub
3. Go to repository Settings → Pages
4. Select "Deploy from branch" → main branch
5. Your site is live at `https://YOUR_USERNAME.github.io/routeiq`

## File Structure

```
routeiq/
├── index.html          # Main HTML structure
├── styles.css          # UI styling (light, blue-tinted theme)
├── app.js             # Route finding & navigation logic
├── gemini.js          # AI assistant client (calls /api/chat, offline fallback)
├── api/
│   └── chat.js        # Serverless Gemini proxy (holds GEMINI_API_KEY)
├── config.js          # App constants (stations, routes) — no secrets
├── go-transit-api.js  # GO Transit API wrapper
├── package.json       # Project metadata
├── vercel.json        # Vercel configuration
└── README.md          # This file
```

## How It Works

1. **Enter your trip details**: Origin, destination, arrival time, travel mode
2. **Find routes**: Algorithm finds 5 different GO Bus terminals and calculates routes
3. **View options**: See duration, distance, traffic, departure times, CO2 impact
4. **Ask AI**: Chat with Gemini AI for intelligent recommendations
5. **Navigate**: Click "Start Route" to highlight the route on the map

## Key Functions

- `findRoutes()` - Locates 5 nearest GO Bus terminals and calculates routes (OSRM)
- `startRoute(index)` - Draws the route polyline on the Leaflet map
- `sendAIMessage()` - Sends context to the /api/chat Gemini proxy for analysis
- `getBusSchedule()` - Retrieves next departure times
- `displayRoutes()` - Renders route cards with all metrics

## Configuration

Edit `config.js` to:
- Add your API keys
- Modify GO Bus terminal locations
- Adjust bus schedules
- Change travel modes
- Customize CO2 calculations

## License

MIT License - Feel free to use and modify for your own projects

## Support

Having issues? Check:
- The map/routing/search need internet access to OpenStreetMap-based services
  (unpkg for Leaflet, CARTO tiles, routing.openstreetmap.de, photon.komoot.io) —
  no keys required
- For real AI: `GEMINI_API_KEY` is set in Vercel (Production), billing is
  **disabled** on the Google Cloud project (free tier), and `GEMINI_MODEL` points
  at a free Flash model; redeploy after changing env vars
- Location features need you to allow geolocation in the browser
- LocalStorage is enabled in your browser

## Future Enhancements

- Real-time GO Transit API integration
- Multi-destination trip planning
- Saved favorite routes
- Accessibility improvements
- Mobile app version
