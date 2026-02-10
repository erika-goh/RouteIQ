// Configuration file for API keys and GO Transit API
const CONFIG = {
  GOOGLE_MAPS_API_KEY: " ",
  GEMINI_API_KEY: " ",

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
      code: "OK",
      lat: 43.4667,
      lng: -79.6833,
      type: "Bus",
    },
    {
      name: "Yorkdale Bus Terminal",
      code: "YD",
      lat: 43.7253,
      lng: -79.4515,
      type: "Bus",
    },
    {
      name: "York Mills Bus Terminal",
      code: "YM",
      lat: 43.7457,
      lng: -79.4077,
      type: "Bus",
    },
    {
      name: "Richmond Hill Terminal",
      code: "RH",
      lat: 43.8748,
      lng: -79.4283,
      type: "Bus",
    },
    {
      name: "Mississauga City Centre Terminal",
      code: "MI",
      lat: 43.5945,
      lng: -79.6432,
      type: "Bus",
    },
    {
      name: "Burlington GO Bus Terminal",
      code: "BU",
      lat: 43.3397,
      lng: -79.804,
      type: "Bus",
    },
    {
      name: "Oshawa GO Bus Terminal",
      code: "OS",
      lat: 43.8677,
      lng: -78.8663,
      type: "Bus",
    },
    {
      name: "Brampton GO Bus Terminal",
      code: "BR",
      lat: 43.6833,
      lng: -79.7675,
      type: "Train",
    },
    {
      name: "Hamilton GO Centre",
      code: "HA",
      lat: 43.2557,
      lng: -79.8711,
      type: "Train & Bus",
    },
  ],

  // Travel modes
  TRAVEL_MODES: [
    { value: "WALKING", label: "Walk", icon: "🚶", color: "#3b82f6" },
    {
      value: "BICYCLING",
      label: "Bike",
      icon: "🚴",
      color: "#22c55e",
      zeroCO2: true,
    },
    { value: "DRIVING", label: "Drive", icon: "🚗", color: "#ef4444" },
    { value: "TRANSIT", label: "Transit", icon: "🚌", color: "#8b5cf6" },
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
