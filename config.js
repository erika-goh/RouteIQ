// Static app data: GO stations, travel modes, and the offline fallback
// schedule. No secrets live here. The Gemini and Metrolinx keys stay
// server-side in the /api/chat and /api/gotransit proxies (Vercel env vars).
// Mapping is keyless (Leaflet + OSM/CARTO), so no map API key is needed.
// Live GO Transit data comes from the Metrolinx Open Data API via the
// /api/gotransit proxy (see go-transit-api.js). GO_BUS_ROUTES below is only the
// bundled offline fallback used when live data is unavailable.
const CONFIG = {
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

  // GTA university / college campuses students commonly commute to on GO.
  // Nearest GO station is computed at runtime (findNearbyStations), so we only
  // need a name, a short chip label, and coordinates.
  CAMPUSES: [
    { name: "University of Toronto (St. George)", short: "UofT", lat: 43.6629, lng: -79.3957 },
    { name: "Toronto Metropolitan University", short: "TMU", lat: 43.6577, lng: -79.3788 },
    { name: "York University (Keele)", short: "York U", lat: 43.7735, lng: -79.5019 },
    { name: "McMaster University", short: "Mac", lat: 43.2609, lng: -79.9192 },
    { name: "Sheridan College (Oakville)", short: "Sheridan", lat: 43.4675, lng: -79.6997 },
    { name: "Ontario Tech University (Oshawa)", short: "Ontario Tech", lat: 43.9450, lng: -78.8963 },
    { name: "University of Guelph", short: "Guelph", lat: 43.5310, lng: -80.2262 },
    { name: "Humber College (North)", short: "Humber", lat: 43.7290, lng: -79.6070 },
    { name: "University of Waterloo", short: "Waterloo", lat: 43.4723, lng: -80.5449 },
    { name: "Wilfrid Laurier University", short: "Laurier", lat: 43.4738, lng: -80.5272 },
    { name: "Queen's University", short: "Queen's", lat: 44.2253, lng: -76.4951 },
    { name: "Western University", short: "Western", lat: 43.0096, lng: -81.2737 },
  ],

  // Rough ESTIMATE of a GO single fare for a $-saved comparison. GO fares are
  // distance-based and set by Metrolinx — these constants only APPROXIMATE them,
  // they are NOT official fares. The 40% post-secondary discount and free-TTC
  // (One Fare) facts below are real; tune the estimate constants if GO reprices.
  FARE_MODEL: {
    estBaseFare: 4.0, // ~ minimum single adult GO fare
    baseDistanceKm: 6, // distance included in the base fare
    estPerKm: 0.18, // approx marginal $/km beyond the base distance
    studentDiscount: 0.4, // full-time post-secondary students save 40% (PRESTO)
    gasPerKm: 0.16, // fuel only (~$1.50/L @ ~10.5 L/100km)
    campusParkingPerDay: 14, // typical GTA campus daily parking (est.)
  },
};

// Inline monochrome SVG icons (24x24, stroke = currentColor) used across the
// gamification, cost, group and tone UIs — no emoji, matching the app's sharp
// line-icon style. These are trusted constants (safe to inject via innerHTML).
const _svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const UI_ICONS = {
  flame: _svg(
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  ),
  bolt: _svg(
    '<path d="M13 2 4.1 12.9a.7.7 0 0 0 .5 1.1H11l-1 8 8.9-10.9a.7.7 0 0 0-.5-1.1H12z"/>',
  ),
  gem: _svg(
    '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M12 21 8 9l2-6M12 21l4-12-2-6"/>',
  ),
  ticket: _svg(
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  ),
  bus: _svg(
    '<rect x="4" y="4.5" width="16" height="12.5" rx="2"/><path d="M4 11h16M8.5 4.5v6.5"/><circle cx="8" cy="19.5" r="1.3"/><circle cx="16" cy="19.5" r="1.3"/>',
  ),
  trophy: _svg(
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.1.5 2 1.9 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
  ),
  crown: _svg(
    '<path d="M3 6l4 4 5-6 5 6 4-4-2 12H5z"/><path d="M5 20h14"/>',
  ),
  leaf: _svg(
    '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
  ),
  tree: _svg(
    '<path d="M12 3l4 5h-3l3 4h-3.5l3.5 4H8l3.5-4H8l3-4H8z"/><path d="M12 20v-4"/>',
  ),
  compass: _svg(
    '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2.1 5.6-5.5 2.1 2.1-5.6z"/>',
  ),
  sunrise: _svg(
    '<path d="M12 2v6M5 11l-1.5-1.5M20.5 9.5 19 11M2 18h3M19 18h3M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0M2 22h20"/>',
  ),
  moon: _svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
  bike: _svg(
    '<circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-7h5l-3.2 7"/><path d="M10 10l-1-3h3"/>',
  ),
  timer: _svg(
    '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  ),
  cap: _svg(
    '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2 3 6 3s6-2 6-3v-5"/>',
  ),
  savings: _svg(
    '<circle cx="12" cy="12" r="9.5"/><path d="M14.5 9a2.4 1.9 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5 1 2.5 2-1 2-2.5 2A2.4 1.9 0 0 1 9.5 15M12 6v12"/>',
  ),
  users: _svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  ),
  pin: _svg(
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  ),
  trendUp: _svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
  smile: _svg(
    '<circle cx="12" cy="12" r="9.5"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  ),
  briefcase: _svg(
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  ),
};

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONFIG, UI_ICONS };
}
