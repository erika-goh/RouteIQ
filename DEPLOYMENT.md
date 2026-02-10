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
- **APIs**: 
  - Google Maps API v3 (directions, geocoding, autocomplete)
  - Google Generative AI (Gemini 2.0 Flash)
  - GO Transit API (integrated, handles CORS gracefully)
- **Storage**: Browser LocalStorage for stats persistence
- **Deployment**: Vercel (recommended)

## Getting Started

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/routeiq.git
cd routeiq
```

2. Get API Keys:
   - [Google Maps API Key](https://developers.google.com/maps/documentation/javascript)
   - [Google Generative AI API Key](https://ai.google.dev/tutorials/setup)

3. Update `config.js` with your API keys:
```javascript
const CONFIG = {
  GOOGLE_MAPS_API_KEY: "YOUR_GOOGLE_MAPS_API_KEY",
  GEMINI_API_KEY: "YOUR_GEMINI_API_KEY",
  // ... rest of config
};
```

4. Start a local server:
```bash
npx http-server -p 8000
```

5. Open http://localhost:8000 in your browser

## Deployment

### Option 1: Vercel (Recommended - 1 minute setup)

1. **Push to GitHub** (see instructions below)

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Click "Import"

3. **Add Environment Variables**:
   - In Vercel dashboard: Settings → Environment Variables
   - Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with your Google Maps API key
   - Add `NEXT_PUBLIC_GEMINI_API_KEY` with your Gemini API key
   - Click "Save"

4. **Deploy**:
   - Vercel auto-deploys when you push to main branch
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
├── styles.css          # UI styling and themes
├── app.js             # Route finding & navigation logic
├── gemini.js          # AI assistant integration
├── config.js          # API keys & constants
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
5. **Navigate**: Click "Start Route" to get turn-by-turn directions on Google Maps

## Key Functions

- `findRoutes()` - Locates 5 nearest GO Bus terminals and calculates routes
- `startRoute(index)` - Launches Google Maps navigation
- `sendAIMessage()` - Sends context to Gemini for analysis
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
- API keys are valid in `config.js`
- Google Maps API has Directions, Geocoding, and Places APIs enabled
- Gemini API model `gemini-2.0-flash` is available in your region
- LocalStorage is enabled in your browser

## Future Enhancements

- Real-time GO Transit API integration
- Multi-destination trip planning
- Saved favorite routes
- Accessibility improvements
- Mobile app version
