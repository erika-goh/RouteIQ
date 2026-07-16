// Configuration file for GO Transit API and app data.
// NOTE: The Gemini API key is NOT here — it lives server-side in the
// /api/chat proxy (Vercel env var GEMINI_API_KEY) and never reaches the
// browser. The Google Maps key is loaded in index.html and should be
// restricted by HTTP referrer in the Google Cloud console.
const CONFIG = {
  // GO Transit API Configuration
  GO_TRANSIT_API: {
    BASE_URL: "https://api.gotransit.com/api",
    KEY: " ",
    // Common endpoints
    ENDPOINTS: {
      PLAN_TRIP: "/ServiceataGlance/TripPlanner/PlanTrip",
      STOPS: "/ServiceataGlance/Stops/GetStops",
      STOP_TIMES: "/ServiceataGlance/Stops/GetStopTimes",
      SERVICE_UPDATES: "/ServiceataGlance/ServiceUpdates/GetServiceUpdates",
    },
  },

  // GO Transit Stations (major hubs)
  GO_TRANSIT_STATIONS: [
    {
      name: "Union Bus Terminal",
      code: "UN",
      lat: 43.6452,
      lng: -79.3806,
      type: "Bus",
    },
    {
      name: "Oakville GO Bus Terminal",
      code: "00137",
      lat: 43.4667,
      lng: -79.6833,
      type: "Bus",
    },
    {
      name: "Yorkdale Bus Terminal",
      code: "00019",
      lat: 43.7253,
      lng: -79.4515,
      type: "Bus",
    },
    {
      name: "York Mills Bus Terminal",
      code: "00011",
      lat: 43.7457,
      lng: -79.4077,
      type: "Bus",
    },
    {
      name: "Richmond Hill Terminal",
      code: "00062",
      lat: 43.8748,
      lng: -79.4283,
      type: "Bus",
    },
    {
      name: "Mississauga City Centre Terminal",
      code: "00132",
      lat: 43.5945,
      lng: -79.6432,
      type: "Bus",
    },
    {
      name: "Burlington GO Bus Terminal",
      code: "00177",
      lat: 43.3397,
      lng: -79.804,
      type: "Bus",
    },
    {
      name: "Oshawa GO Bus Terminal",
      code: "00159",
      lat: 43.8677,
      lng: -78.8663,
      type: "Bus",
    },
    {
      name: "Brampton GO Bus Terminal",
      code: "01305",
      lat: 43.6833,
      lng: -79.7675,
      type: "Train",
    },
    {
      name: "Hamilton GO Centre",
      code: "00141",
      lat: 43.2557,
      lng: -79.8711,
      type: "Train & Bus",
    },
  ],

  // Travel modes (icons are inline SVG strings, styled via currentColor)
  TRAVEL_MODES: [
    {
      value: "WALKING",
      label: "Walk",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12.5" cy="4" r="1.6"/><path d="M9 21l2.2-6.5L14 12l-1-4"/><path d="M13 9l3 1.2 2.2 2.8"/><path d="M11.2 14.5l-2.2 2"/></svg>',
      color: "#8257e6",
    },
    {
      value: "BICYCLING",
      label: "Bike",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-7h5l-3.2 7"/><path d="M10 10l-1-3h3"/></svg>',
      color: "#46d19e",
      zeroCO2: true,
    },
    {
      value: "DRIVING",
      label: "Drive",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 14l1.2-4.2A2 2 0 0 1 8.1 8h7.8a2 2 0 0 1 1.9 1.8L19 14"/><path d="M4 14h16v3h-1.5M5.5 17H4v-3"/><path d="M7 17h10"/><circle cx="7.5" cy="17.5" r="1.2"/><circle cx="16.5" cy="17.5" r="1.2"/></svg>',
      color: "#f0637a",
    },
    {
      value: "TRANSIT",
      label: "Transit",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4" width="15" height="12.5" rx="2"/><path d="M4.5 11h15M8.5 4v7"/><circle cx="8" cy="19" r="1.2"/><circle cx="16" cy="19" r="1.2"/></svg>',
      color: "#4d7cff",
    },
  ],

  // GO Bus Routes (mock data for scheduling)
  GO_BUS_ROUTES: {
    "Route 1": {
      name: "Route 1",
      weekdaySchedule: [
        "06:00",
        "06:30",
        "07:00",
        "07:30",
        "08:00",
        "08:30",
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
        "11:30",
        "12:00",
        "12:30",
        "13:00",
        "13:30",
        "14:00",
        "14:30",
        "15:00",
        "15:30",
        "16:00",
        "16:30",
        "17:00",
        "17:30",
        "18:00",
        "18:30",
        "19:00",
        "19:30",
        "20:00",
        "20:30",
        "21:00",
        "21:30",
        "22:00",
      ],
      saturdaySchedule: [
        "07:00",
        "07:30",
        "08:00",
        "08:30",
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
        "11:30",
        "12:00",
        "12:30",
        "13:00",
        "13:30",
        "14:00",
        "14:30",
        "15:00",
        "15:30",
        "16:00",
        "16:30",
        "17:00",
        "17:30",
        "18:00",
        "18:30",
        "19:00",
        "19:30",
        "20:00",
        "20:30",
        "21:00",
      ],
      sundaySchedule: [
        "08:00",
        "08:30",
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
        "11:30",
        "12:00",
        "12:30",
        "13:00",
        "13:30",
        "14:00",
        "14:30",
        "15:00",
        "15:30",
        "16:00",
        "16:30",
        "17:00",
        "17:30",
        "18:00",
        "18:30",
        "19:00",
        "19:30",
        "20:00",
      ],
    },
  },
};

// Helper function to build GO Transit API URLs
function buildGOTransitURL(endpoint, params = {}) {
  const baseUrl = `${CONFIG.GO_TRANSIT_API.BASE_URL}${endpoint}`;
  const queryParams = new URLSearchParams({
    key: CONFIG.GO_TRANSIT_API.KEY,
    ...params,
  });
  return `${baseUrl}?${queryParams.toString()}`;
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONFIG, buildGOTransitURL };
}
