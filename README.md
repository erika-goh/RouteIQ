# RouteIQ - AI-Powered GO Transit Planner

An intelligent transit route planner that integrates Google Maps API, **GO Transit API**, and Google Gemini AI to help you catch your bus or train on time.

![RouteIQ Interface](https://img.shields.io/badge/Version-2.0-blue)
![GO Transit API](https://img.shields.io/badge/GO%20Transit-Integrated-green)

## Features

### 🚌 Smart Route Planning with GO Transit API

- **Real-time GO Transit data**: Direct integration with official GO Transit API
- **Multi-modal routing**: Walk, cycle, drive, or take transit to your GO station
- **Live scheduling**: Real GO Transit timetables and service updates
- **Optimal departure calculation**: Tells you exactly when to leave
- **Multiple route options**: Compare different routes and stations

### 🤖 Gemini AI Assistant

- **Conversational interface**: Ask questions about your trip in natural language
- **Route insights**: Get AI-powered analysis of traffic, timing, and alternatives
- **Smart suggestions**: Optimal departure times based on current conditions
- **Context-aware**: Understands your current trip planning state

### 🗺️ Interactive Map

- **Live location tracking**: Use your current location as origin
- **Traffic overlay**: See real-time traffic conditions
- **Route visualization**: Clear display of your complete journey
- **Dark mode optimized**: Matches your screenshots exactly

### 📊 Personal Statistics

- **Trip counter**: Track how many trips you've planned
- **Minutes Saved**: Calculate efficiency gains
- **CO₂ Saved tracking**: Monitor your environmental impact (kg)
- **Smart Reroutes**: See how often you've optimized your route

## What's Integrated

### ✅ Your GO Transit API (Key: 30026449)

The app is pre-configured with your GO Transit API key and includes:

- Trip planning between GO stations
- Real-time departure times
- Service updates and alerts
- Station stop times

### ✅ Google Maps API

- Already configured with your key: `AIzaSyA_qFnB9Zju3GBTVsRief39CSWa2zkLj_8`
- **⚠️ IMPORTANT**: Please regenerate this key since it's now public!

### 🔧 Needs Setup: Gemini AI (Optional)

- Get your free API key at: [Google AI Studio](https://makersuite.google.com/app/apikey)
- Add it to `config.js`

## Quick Start

1. **Open `index.html`** in your browser
2. **Allow location access** when prompted
3. **Select your destination** (or choose a GO Station)
4. **Click "Find Routes & Leave Times"**
5. **View multiple options** with traffic, CO₂, and timing

That's it! The GO Transit API is already configured.

## Setup Instructions

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Google Maps API key
- Google Gemini API key (optional, for AI features)

### Installation

1. **Clone or download the files**

   ```bash
   git clone <repository-url>
   cd routeiq
   ```

2. **Get API Keys**

   **Google Maps API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable these APIs:
     - Maps JavaScript API
     - Places API
     - Directions API
     - Geocoding API
   - Create credentials (API key)
   - Restrict your key (recommended):
     - Application restrictions: HTTP referrers
     - API restrictions: Select the APIs listed above

   **Gemini API:**
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create an API key
   - Note: The free tier includes generous limits

3. **Configure API Keys**

   Open `config.js` and replace the placeholder values:

   ```javascript
   const CONFIG = {
     GOOGLE_MAPS_API_KEY: "YOUR_ACTUAL_GOOGLE_MAPS_KEY",
     GEMINI_API_KEY: "YOUR_ACTUAL_GEMINI_KEY",
     // ... rest of config
   };
   ```

4. **Update GO Bus Data**

   In `config.js`, update the stations and schedules with your actual data:

   ```javascript
   GO_BUS_STATIONS: [
       { name: 'Your Station', lat: 43.xxxx, lng: -79.xxxx },
       // Add more stations
   ],

   GO_BUS_ROUTES: {
       'route_number': {
           name: 'Route Name',
           weekdaySchedule: ['05:30', '06:00', ...],
           // Add schedules
       }
   }
   ```

5. **Update Google Maps API in HTML**

   In `index.html`, replace the API key in the script tag:

   ```html
   <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_ACTUAL_KEY&libraries=places,geometry"></script>
   ```

6. **Launch the App**

   Simply open `index.html` in your web browser, or use a local server:

   ```bash
   # Python 3
   python -m http.server 8000

   # Or use any other local server
   # Then visit: http://localhost:8000
   ```

## Usage Guide

### Planning a Trip

1. **Set Your Origin**
   - Use current location (GPS)
   - Select a GO Bus station
   - Enter a custom address

2. **Set Your Destination**
   - Enter any address
   - Or select a GO Bus station

3. **Choose Arrival Time**
   - Set when you want to arrive
   - Default is 30 minutes from now

4. **Select Travel Mode**
   - How you'll get to the bus station
   - Options: Walking, Cycling, Driving, Transit

5. **Find Routes**
   - Click "Find Routes"
   - Review multiple options
   - Select your preferred route

6. **Choose Bus Time**
   - See available bus departures
   - App calculates when you need to leave
   - Includes buffer time for safety

### Using the AI Assistant

1. **Open AI Panel**
   - Click "AI Assistant" in the header
   - Or it opens automatically with route insights

2. **Ask Questions**
   - "Which route is fastest?"
   - "Should I leave earlier due to traffic?"
   - "What if I miss this bus?"
   - "Are there any delays on this route?"

3. **Get Insights**
   - AI analyzes your route automatically
   - Provides context-aware suggestions
   - Considers traffic and timing

## File Structure

```
routeiq/
├── index.html          # Main HTML structure
├── styles.css          # Modern UI styling with animations
├── config.js           # API keys and configuration
├── gemini.js          # Gemini AI integration
├── app.js             # Main application logic
└── README.md          # This file
```

## Features Breakdown

### Responsive Design

- Mobile-friendly interface
- Adapts to different screen sizes
- Touch-optimized controls

### Local Storage

- Saves your trip statistics
- Persists between sessions
- No account required

### Smart Defaults

- Automatically sets arrival time
- Selects best route
- Recommends next available bus

### Accessibility

- High contrast dark theme
- Clear typography
- Keyboard navigation support

## Customization

### Adding More Stations

Edit `config.js`:

```javascript
GO_BUS_STATIONS: [
    { name: 'Station Name', lat: 43.xxxx, lng: -79.xxxx },
]
```

### Modifying Bus Schedules

Edit `config.js`:

```javascript
GO_BUS_ROUTES: {
    'route_id': {
        name: 'Route Name',
        weekdaySchedule: ['HH:MM', ...],
        saturdaySchedule: ['HH:MM', ...],
        sundaySchedule: ['HH:MM', ...],
        duration: 30 // minutes
    }
}
```

### Styling Changes

Modify CSS variables in `styles.css`:

```css
:root {
  --accent-blue: #3b82f6;
  --accent-purple: #8b5cf6;
  /* Change colors here */
}
```

## Troubleshooting

### Map Not Loading

- Check if Google Maps API key is correct
- Verify APIs are enabled in Google Cloud Console
- Check browser console for errors

### Location Not Working

- Allow location permissions in browser
- Check if HTTPS is being used (required for geolocation)
- Try entering address manually

### AI Assistant Not Responding

- Verify Gemini API key is correct
- Check API quota limits
- Look for errors in browser console

### Routes Not Appearing

- Ensure both origin and destination are set
- Verify station coordinates are correct
- Check if travel mode is appropriate

## Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Privacy & Data

- All data stored locally in browser
- No external servers (except Google APIs)
- Location data not transmitted anywhere
- No user accounts or tracking

## Future Enhancements

- [ ] Real-time bus tracking
- [ ] Push notifications for departure reminders
- [ ] Favorite routes
- [ ] Multi-day trip planning
- [ ] Weather integration
- [ ] Accessibility route preferences
- [ ] Offline mode
- [ ] Share trip with friends

## Credits

Built with:

- Google Maps JavaScript API
- Google Gemini AI
- Modern JavaScript (ES6+)
- CSS Grid & Flexbox

## License

MIT License - feel free to modify and use for your projects!

## Support

For issues or questions:

1. Check browser console for errors
2. Verify API keys are correct
3. Ensure all files are in same directory
4. Check network connectivity

---

**Made with ❤️ for better transit planning**
