// RouteIQ Main Application — free OpenStreetMap stack
// Map:      Leaflet + CARTO/OSM tiles (no key, no billing)
// Routing:  OSRM (FOSSGIS public instances, no key)
// Search:   Photon geocoder (no key)
let map, routeLayer, stationsLayer;
let currentLocation = null;
let destinationLocation = null;
let originLocationFromStation = null;
let activeRouteIndex = null;
let mapReady = false;
let userMarker, destinationMarker;
let originPlace = null;
let destinationPlace = null;
let selectedBusTime = null;
let currentBusSchedule = [];
let geminiAssistant = null;
let goTransitService = null;
let isNavigating = false;
let aiInsightShown = false;

const routes = [];
const userIncidents = [];

// Free, keyless service endpoints
const OSRM_BASE = "https://routing.openstreetmap.de";
const PHOTON_URL = "https://photon.komoot.io/api/";
// Google travel mode -> OSRM profile (transit approximated by car routing)
const PROFILE_MAP = {
  WALKING: "foot",
  BICYCLING: "bike",
  DRIVING: "car",
  TRANSIT: "car",
};

// Inline SVG icons (modern, monochrome via currentColor)
const ICONS = {
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 5.6L19 9l-5.3 1.4L12 16l-1.7-5.6L5 9l5.3-1.4z"/><circle cx="18.5" cy="17.5" r="1.6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c0-3.6 3-5.6 6.5-5.6s6.5 2 6.5 5.6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
};

// Lifetime stats
let lifetimeStats = {
  trips: parseInt(localStorage.getItem("gobus_trips")) || 0,
  timeSaved: parseInt(localStorage.getItem("gobus_timeSaved")) || 0,
  co2Saved: parseFloat(localStorage.getItem("gobus_co2Saved")) || 0,
  reroutes: parseInt(localStorage.getItem("gobus_reroutes")) || 0,
};

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

function initializeApp() {
  // Initialize GO Transit client (key lives server-side in /api/gotransit).
  goTransitService = new GOTransitService();

  // The Gemini key lives server-side in /api/chat; always create the assistant.
  // It uses real AI when the proxy is available and a smart offline fallback
  // otherwise.
  geminiAssistant = new GeminiAssistant();

  // Initialize map
  initMap();

  // Set default arrival time (30 minutes from now)
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  document.getElementById("arrival-time").value = now
    .toTimeString()
    .substring(0, 5);

  updateStatsDisplay();
  setupEventListeners();
  initSidebarResizer();
  handleDestinationType();

  loadServiceUpdates().catch(() => {
    // Service updates are optional, silently fail
  });
}

function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
    [43.6532, -79.3832],
    12,
  );

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(map);

  mapReady = true;

  // Leaflet needs a size recalc once the flex layout settles.
  setTimeout(() => map.invalidateSize(), 200);
  window.addEventListener("resize", () => map.invalidateSize());
}

function setupEventListeners() {
  document.querySelectorAll('input[name="origin-type"]').forEach((radio) => {
    radio.addEventListener("change", handleOriginType);
  });

  document.querySelectorAll('input[name="dest-type"]').forEach((radio) => {
    radio.addEventListener("change", handleDestinationType);
  });

  document
    .getElementById("refresh-location")
    ?.addEventListener("click", refreshCurrentLocation);

  document.getElementById("find-routes").addEventListener("click", findRoutes);

  document
    .getElementById("travel-mode")
    .addEventListener("change", handleTravelModeChange);

  document.getElementById("ai-toggle").addEventListener("click", toggleAIPanel);
  document.getElementById("close-ai").addEventListener("click", closeAIPanel);

  document.getElementById("ai-send").addEventListener("click", sendAIMessage);
  document.getElementById("ai-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendAIMessage();
  });

  document
    .getElementById("toggle-traffic")
    .addEventListener("click", toggleStations);
  document.getElementById("center-map").addEventListener("click", centerMap);
}

/* ---------------- Sidebar resize ---------------- */
function initSidebarResizer() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const resizer = document.createElement("div");
  resizer.className = "sidebar-resizer";
  resizer.title = "Drag to resize";
  sidebar.insertAdjacentElement("afterend", resizer);

  const MIN = 320;
  const MAX = 720;
  let dragging = false;

  // Restore saved width.
  try {
    const saved = localStorage.getItem("routeiq_sidebar_w");
    if (saved) sidebar.style.width = saved;
  } catch (e) {}

  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    resizer.classList.add("dragging");
    document.body.classList.add("resizing-sidebar");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const left = sidebar.getBoundingClientRect().left;
    const width = Math.max(MIN, Math.min(MAX, e.clientX - left));
    sidebar.style.width = `${width}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("dragging");
    document.body.classList.remove("resizing-sidebar");
    if (map) map.invalidateSize();
    try {
      localStorage.setItem("routeiq_sidebar_w", sidebar.style.width);
    } catch (e) {}
  });
}

/* ---------------- Markers ---------------- */
function setUserMarker(latlng, title) {
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker(latlng, {
    radius: 8,
    color: "#0b0d14",
    weight: 3,
    fillColor: "#7c74ff",
    fillOpacity: 1,
  }).addTo(map);
  if (title) userMarker.bindTooltip(title);
}

function setDestinationMarker(latlng, title) {
  if (destinationMarker) destinationMarker.remove();
  destinationMarker = L.circleMarker(latlng, {
    radius: 8,
    color: "#0b0d14",
    weight: 3,
    fillColor: "#f0637a",
    fillOpacity: 1,
  }).addTo(map);
  if (title) destinationMarker.bindTooltip(title);
}

/* ---------------- Origin / destination inputs ---------------- */
function handleOriginType() {
  const type = document.querySelector(
    'input[name="origin-type"]:checked',
  ).value;
  const container = document.getElementById("origin-input-container");

  if (type === "location") {
    container.innerHTML = `
      <button class="location-btn" id="refresh-location">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        Use Current Location
      </button>`;
    document
      .getElementById("refresh-location")
      .addEventListener("click", refreshCurrentLocation);
    refreshCurrentLocation();
  } else if (type === "station") {
    container.innerHTML = `
      <select class="text-input" id="origin-station">
        <option value="">Select a GO Station</option>
        ${CONFIG.GO_TRANSIT_STATIONS.map(
          (station) =>
            `<option value="${station.code}" data-lat="${station.lat}" data-lng="${station.lng}">
              ${station.name} (${station.type})
            </option>`,
        ).join("")}
      </select>`;
    document
      .getElementById("origin-station")
      .addEventListener("change", setOriginStation);
  } else {
    container.innerHTML = `<input type="text" id="origin-custom" class="text-input" placeholder="Enter origin address">`;
    attachAutocomplete(document.getElementById("origin-custom"), (place) => {
      originPlace = place;
      currentLocation = L.latLng(place.lat, place.lng);
      setUserMarker(currentLocation, place.formatted_address);
      map.setView(currentLocation, 14);
    });
  }
}

function setOriginStation() {
  const select = document.getElementById("origin-station");
  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption.value) return;

  const lat = parseFloat(selectedOption.dataset.lat);
  const lng = parseFloat(selectedOption.dataset.lng);
  currentLocation = L.latLng(lat, lng);
  originLocationFromStation = {
    code: selectedOption.value,
    name: selectedOption.text,
  };
  originPlace = { formatted_address: selectedOption.text.trim(), lat, lng };
  setUserMarker(currentLocation, selectedOption.text);
  map.setView(currentLocation, 13);
}

function refreshCurrentLocation() {
  showLoading(true);

  if (!navigator.geolocation) {
    addAlert("error", "Not Supported", "Geolocation is not supported by your browser.");
    showLoading(false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLocation = L.latLng(
        position.coords.latitude,
        position.coords.longitude,
      );
      originPlace = {
        formatted_address: "Current Location",
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setUserMarker(currentLocation, "Your Location");
      map.setView(currentLocation, 14);
      showLoading(false);
    },
    (error) => {
      console.error("Geolocation error:", error);
      addAlert(
        "warning",
        "Location Error",
        "Could not get your current location. Try entering an address instead.",
      );
      showLoading(false);
    },
  );
}

function handleDestinationType() {
  const type = document.querySelector('input[name="dest-type"]:checked').value;
  const container = document.getElementById("destination-input-container");

  if (type === "station") {
    container.innerHTML = `
      <select class="text-input" id="destination-input">
        <option value="">Select a GO Station</option>
        ${CONFIG.GO_TRANSIT_STATIONS.map(
          (station) =>
            `<option value="${station.code}" data-lat="${station.lat}" data-lng="${station.lng}">
              ${station.name} (${station.type})
            </option>`,
        ).join("")}
      </select>`;
    document
      .getElementById("destination-input")
      .addEventListener("change", setStationDestination);
  } else {
    container.innerHTML = `<input type="text" id="destination-input" class="text-input" placeholder="Enter destination address">`;
    attachAutocomplete(document.getElementById("destination-input"), (place) => {
      destinationPlace = place;
      destinationLocation = L.latLng(place.lat, place.lng);
      setDestinationMarker(destinationLocation, place.formatted_address);
      map.setView(destinationLocation, 14);
    });
  }
}

function setStationDestination() {
  const select = document.getElementById("destination-input");
  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption.value) return;

  const lat = parseFloat(selectedOption.dataset.lat);
  const lng = parseFloat(selectedOption.dataset.lng);
  destinationLocation = L.latLng(lat, lng);
  destinationPlace = { formatted_address: selectedOption.text.trim(), lat, lng };
  setDestinationMarker(destinationLocation, selectedOption.text);
  map.setView(destinationLocation, 13);
}

/* ---------------- Photon autocomplete ---------------- */
function formatPhoton(feature) {
  const p = feature.properties || {};
  const parts = [p.name, p.street, p.city, p.state].filter(Boolean);
  return parts.length ? parts.join(", ") : p.name || "Unknown location";
}

function attachAutocomplete(inputEl, onSelect) {
  if (!inputEl) return;
  inputEl.setAttribute("autocomplete", "off");
  const parent = inputEl.parentElement;
  parent.style.position = "relative";

  let dropdown = null;
  let items = [];
  let activeIdx = -1;
  let timer = null;

  function closeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    items = [];
    activeIdx = -1;
  }

  function renderDropdown() {
    if (dropdown) dropdown.remove();
    if (!items.length) {
      dropdown = null;
      return;
    }
    dropdown = document.createElement("div");
    dropdown.className = "ac-dropdown";
    items.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = "ac-item" + (i === activeIdx ? " active" : "");
      el.textContent = item.label;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(i);
      });
      dropdown.appendChild(el);
    });
    parent.appendChild(dropdown);
  }

  function choose(i) {
    const item = items[i];
    if (!item) return;
    inputEl.value = item.label;
    closeDropdown();
    onSelect({ formatted_address: item.label, lat: item.lat, lng: item.lng });
  }

  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < 3) {
      closeDropdown();
      return;
    }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=43.65&lon=-79.38`,
        );
        if (!res.ok) return;
        const data = await res.json();
        items = (data.features || []).map((f) => ({
          label: formatPhoton(f),
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
        }));
        activeIdx = -1;
        renderDropdown();
      } catch (err) {
        console.warn("Autocomplete error:", err.message);
      }
    }, 300);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % items.length;
      renderDropdown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      renderDropdown();
    } else if (e.key === "Enter") {
      if (activeIdx >= 0) {
        e.preventDefault();
        choose(activeIdx);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  });

  inputEl.addEventListener("blur", () => setTimeout(closeDropdown, 150));
}

/* ---------------- Route finding ---------------- */
async function findRoutes() {
  if (!currentLocation) {
    addAlert("warning", "Missing Origin", "Please set your origin location.");
    return;
  }
  if (!destinationLocation) {
    addAlert("warning", "Missing Destination", "Please enter a destination.");
    return;
  }

  showLoading(true);
  routes.length = 0;

  const selectedMode = document.getElementById("travel-mode").value;

  try {
    const destType = document.querySelector(
      'input[name="dest-type"]:checked',
    ).value;

    // Build a list of genuinely different "legs to a station":
    //  - custom destination  -> the 5 nearest stations (selected travel mode)
    //  - station destination -> that one station, but with each travel mode,
    //    so the options actually differ (and rank by duration).
    const legs = [];
    if (destType === "station") {
      const destSelect = document.getElementById("destination-input");
      let destStation = null;
      if (destSelect && destSelect.selectedIndex > 0) {
        const selectedOption = destSelect.options[destSelect.selectedIndex];
        destStation = CONFIG.GO_TRANSIT_STATIONS.find(
          (s) => s.code === selectedOption.value,
        );
      }
      if (destStation) {
        ["WALKING", "BICYCLING", "DRIVING", "TRANSIT"].forEach((mode) => {
          legs.push({ station: destStation, mode, needsBusLeg: false });
        });
      }
    } else {
      findNearbyStations(currentLocation, 5).forEach((station) => {
        legs.push({ station, mode: selectedMode, needsBusLeg: true });
      });
    }

    if (legs.length === 0) {
      addAlert("warning", "No Stations", "Could not find suitable GO Transit stations.");
      showLoading(false);
      return;
    }

    const now = new Date();
    const hour = now.getHours();
    const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);

    // Fetch REAL live departures once per unique station (parallel), then reuse.
    const uniqueCodes = [...new Set(legs.map((l) => l.station.code))];
    const liveSchedules = {};
    await Promise.all(
      uniqueCodes.map(async (code) => {
        liveSchedules[code] = await goTransitService.getNextService(code);
      }),
    );

    for (const leg of legs) {
      const stationLocation = L.latLng(leg.station.lat, leg.station.lng);
      const routeToStation = await getDirections(
        currentLocation,
        stationLocation,
        leg.mode,
      );
      if (!routeToStation) continue;

      let routeFromStation = null;
      if (leg.needsBusLeg) {
        routeFromStation = await getDirections(
          stationLocation,
          destinationLocation,
          "TRANSIT",
        );
        if (!routeFromStation) continue;
      }

      const distance = goTransitService.parseDistance(routeToStation.distance);
      const co2 = goTransitService.calculateCO2Savings(distance, leg.mode);

      // Driving is most affected by peak-hour congestion; active modes least.
      let traffic = "low";
      if (peak) {
        if (leg.mode === "DRIVING") traffic = "heavy";
        else if (leg.mode === "TRANSIT") traffic = "medium";
      }

      // Real GO departures when available; bundled schedule as fallback.
      const live = liveSchedules[leg.station.code];
      const schedule =
        live && live.length ? live : getBusSchedule(leg.station.name);
      const busTime = schedule[0] || "—";
      const totalDuration =
        routeToStation.duration + (routeFromStation?.duration || 0) + 5;

      routes.push({
        toStation: routeToStation,
        fromStation: routeFromStation,
        goTransitData: null,
        station: leg.station,
        busTime: busTime,
        schedule: schedule,
        isLive: !!(live && live.length),
        travelMode: leg.mode,
        totalDuration: totalDuration,
        summary: `${leg.mode} to ${leg.station.name} (${routeToStation.distance}) • Bus at ${busTime}`,
        co2: co2,
        traffic: traffic,
      });
    }

    if (routes.length > 0) {
      // Rank least -> greatest duration, keep one card per station+mode.
      routes.sort((a, b) => a.totalDuration - b.totalDuration);
      const uniqueRoutes = [];
      const seen = new Set();
      for (const route of routes) {
        const key = `${route.station.code}-${route.travelMode}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueRoutes.push(route);
        }
      }
      routes.length = 0;
      routes.push(...uniqueRoutes.slice(0, 6));

      displayRoutes();
      updateBusSchedule();

      // One trip per successful search.
      lifetimeStats.trips++;
      lifetimeStats.timeSaved += calculateTimeSaved(routes[0]);
      lifetimeStats.co2Saved += routes[0].co2;
      saveStats();
      updateStatsDisplay();

      // No auto-generated analysis — the ranked route cards ARE the result.
      // The assistant only speaks when the user talks to it.
    } else {
      addAlert(
        "warning",
        "No Routes Found",
        "Could not find suitable routes. Try a different origin, destination, or travel mode.",
      );
    }

    showLoading(false);
  } catch (error) {
    console.error("Route finding error:", error);
    addAlert("error", "Error", "An error occurred while finding routes.");
    showLoading(false);
  }
}

function calculateTimeSaved(route) {
  // Estimate ~20% faster than driving directly in traffic.
  return Math.floor(route.totalDuration * 0.2);
}

function findNearbyStations(location, limit = 3) {
  return CONFIG.GO_TRANSIT_STATIONS.map((station) => {
    const loc = L.latLng(station.lat, station.lng);
    return { ...station, location: loc, distance: location.distanceTo(loc) };
  })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// OSRM routing (free FOSSGIS instances). Returns a normalized route object.
async function getDirections(origin, destination, travelMode) {
  const profile = PROFILE_MAP[travelMode] || "car";
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_BASE}/routed-${profile}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;

    const r = data.routes[0];
    const geometry = (r.geometry.coordinates || []).map((c) => [c[1], c[0]]); // [lat, lng]

    return {
      duration: Math.max(1, Math.ceil(r.duration / 60)),
      distance: `${(r.distance / 1000).toFixed(1)} km`,
      distanceMeters: r.distance,
      steps: r.legs?.[0]?.steps || [],
      geometry: geometry,
    };
  } catch (err) {
    console.warn("Routing error:", err.message);
    return null;
  }
}

function getBusSchedule(stationName) {
  const busRoutes = CONFIG.GO_BUS_ROUTES && Object.values(CONFIG.GO_BUS_ROUTES);
  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const filterFuture = (schedule) =>
    schedule.filter((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes > currentMinutes;
    });

  if (!busRoutes || busRoutes.length === 0) {
    const defaultSchedule = [];
    for (let h = 6; h <= 22; h++) {
      defaultSchedule.push(`${String(h).padStart(2, "0")}:00`);
      defaultSchedule.push(`${String(h).padStart(2, "0")}:30`);
    }
    return filterFuture(defaultSchedule);
  }

  const route = busRoutes[0];
  const day = new Date().getDay();
  const schedule =
    day === 0
      ? route.sundaySchedule
      : day === 6
        ? route.saturdaySchedule
        : route.weekdaySchedule;

  return filterFuture(schedule);
}

async function loadServiceUpdates() {
  try {
    if (goTransitService) {
      const updates = await goTransitService.getServiceUpdates();
      if (updates && updates.length > 0) {
        updates.slice(0, 3).forEach((update) => {
          addAlert(
            "warning",
            "Service Update",
            update.message || update.description,
          );
        });
      }
    }
  } catch (error) {
    console.warn("Service updates unavailable:", error.message);
  }
}

/* ---------------- Route display ---------------- */
function displayRoutes() {
  const container = document.getElementById("routes-list");
  document.getElementById("routes-section").style.display = "block";

  container.innerHTML = routes
    .slice(0, 5)
    .map((route, index) => {
      const mode =
        CONFIG.TRAVEL_MODES.find((m) => m.value === route.travelMode) ||
        CONFIG.TRAVEL_MODES[0];
      const isZeroCO2 = mode.zeroCO2 || false;
      const co2Value = route.co2 || 0;

      return `
        <div class="route-card ${index === 0 ? "active" : ""}" data-index="${index}">
          <div class="route-header">
            <div class="route-title">
              <span class="route-icon">${mode.icon}</span>
              ${mode.label}
            </div>
            ${index === 0 ? '<div class="route-badge">Fastest</div>' : ""}
            ${route.isLive ? '<div class="route-badge route-badge-live">● Live</div>' : ""}
            ${isZeroCO2 ? '<div class="route-badge" style="border-color: rgba(70,209,158,0.4); color: var(--green);">Zero Carbon</div>' : ""}
          </div>

          <div class="route-details">
            <div class="route-detail">
              <div class="route-detail-icon">⏱️</div>
              <div>
                <div class="route-detail-label">Duration</div>
                <div class="route-detail-value">${route.totalDuration} min</div>
              </div>
            </div>
            <div class="route-detail">
              <div class="route-detail-icon">📍</div>
              <div>
                <div class="route-detail-label">Distance</div>
                <div class="route-detail-value">${route.toStation.distance}</div>
              </div>
            </div>
            <div class="route-detail">
              <div class="route-detail-icon">🚌</div>
              <div>
                <div class="route-detail-label">Departure</div>
                <div class="route-detail-value">${route.busTime}</div>
              </div>
            </div>
            <div class="route-detail">
              <div class="route-detail-icon">🚉</div>
              <div>
                <div class="route-detail-label">Station</div>
                <div class="route-detail-value">${route.station.name.split(" ")[0]}</div>
              </div>
            </div>
          </div>

          <div class="route-traffic ${route.traffic || "low"}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
            Traffic: ${route.traffic ? route.traffic.charAt(0).toUpperCase() + route.traffic.slice(1) : "Low"}
          </div>

          <div class="route-co2 ${isZeroCO2 ? "savings" : ""}">
            ${
              isZeroCO2
                ? `🌱 ${co2Value.toFixed(1)} kg CO₂ saved vs driving`
                : `${co2Value.toFixed(1)} kg CO₂`
            }
          </div>

          <button class="route-start-button" onclick="startRoute(${index})">
            ${index === activeRouteIndex && isNavigating ? "Navigating…" : "Start Route →"}
          </button>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".route-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (!e.target.classList.contains("route-start-button")) {
        selectRoute(parseInt(card.dataset.index));
      }
    });
  });

  selectRoute(0);
}

function drawRoute(route) {
  if (routeLayer) routeLayer.remove();

  // Full journey path in red: leg to the station + transit leg to destination.
  const coords = [];
  if (route.toStation && route.toStation.geometry) {
    coords.push(...route.toStation.geometry);
  }
  if (route.fromStation && route.fromStation.geometry) {
    coords.push(...route.fromStation.geometry);
  }
  if (!coords.length) return;

  routeLayer = L.polyline(coords, {
    color: "#ff3b52",
    weight: 5,
    opacity: 0.95,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
}

function startRoute(index) {
  isNavigating = true;
  selectRoute(index);

  const route = routes[index];
  drawRoute(route);

  document.querySelectorAll(".route-start-button").forEach((btn, i) => {
    if (i === index) {
      btn.classList.add("navigating");
      btn.innerHTML = "Navigating…";
    } else {
      btn.classList.remove("navigating");
      btn.innerHTML = "Start Route →";
    }
  });

  const stepCount = route.toStation?.steps?.length || 0;
  const travelMode =
    route.travelMode.charAt(0).toUpperCase() +
    route.travelMode.slice(1).toLowerCase();

  let alertMessage = `${travelMode} to ${route.station.name} • Depart at ${route.busTime} • Duration: ${route.totalDuration} min`;
  if (stepCount > 0) {
    alertMessage = `Follow ${stepCount} steps to ${route.station.name}. Route highlighted on the map.`;
  }
  addAlert("info", "Navigation Active", alertMessage);
}

function selectRoute(index) {
  activeRouteIndex = index;
  const route = routes[index];

  document.querySelectorAll(".route-card").forEach((card, i) => {
    card.classList.toggle("active", i === index);
  });

  drawRoute(route);

  // Use the schedule captured for this route (real GO departures when the API
  // returned them, otherwise the bundled fallback).
  currentBusSchedule = route.schedule || getBusSchedule(route.station.name);
  selectedBusTime = null;
  displayBusSchedule();
  calculateLeaveTime(route);

  if (route.isLive) {
    addAlert(
      "info",
      "Live GO Schedule",
      `Showing real-time departures for ${route.station.name}.`,
    );
  }
}

function displayBusSchedule() {
  const container = document.getElementById("bus-schedule-container");
  document.getElementById("bus-section").style.display = "block";

  container.innerHTML = currentBusSchedule
    .slice(0, 5)
    .map(
      (time, index) => `
        <div class="bus-time-option ${index === 0 ? "next-bus selected" : ""}" data-time="${time}">
          <div class="bus-time-header">
            <div class="bus-time">${time}</div>
            ${index === 0 ? '<div class="bus-badge">Next</div>' : ""}
          </div>
          <div class="bus-info">
            ${index === 0 ? "Recommended departure time" : `In ${calculateTimeDiff(time)} minutes`}
          </div>
        </div>`,
    )
    .join("");

  container.querySelectorAll(".bus-time-option").forEach((option) => {
    option.addEventListener("click", () => {
      selectedBusTime = option.dataset.time;
      container
        .querySelectorAll(".bus-time-option")
        .forEach((o) => o.classList.remove("selected"));
      option.classList.add("selected");
      if (activeRouteIndex !== null) {
        calculateLeaveTime(routes[activeRouteIndex]);
      }
    });
  });
}

function calculateTimeDiff(time) {
  const now = new Date();
  const [hours, minutes] = time.split(":").map(Number);
  const busTime = new Date();
  busTime.setHours(hours, minutes, 0);
  return Math.floor((busTime - now) / 60000);
}

function calculateLeaveTime(route) {
  if (!selectedBusTime) selectedBusTime = currentBusSchedule[0];
  if (!selectedBusTime) return;

  const [hours, minutes] = selectedBusTime.split(":").map(Number);
  const busTime = new Date();
  busTime.setHours(hours, minutes, 0);

  const leaveTime = new Date(
    busTime.getTime() - route.toStation.duration * 60000 - 10 * 60000,
  );

  addAlert(
    "info",
    "Leave by",
    `You should leave by ${leaveTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    })} to catch the ${selectedBusTime} bus.`,
  );
}

function handleTravelModeChange() {
  if (activeRouteIndex !== null) {
    // Re-running the search with a new mode is a smart reroute.
    lifetimeStats.reroutes++;
    saveStats();
    findRoutes();
  }
}

function updateBusSchedule() {
  if (routes.length > 0 && activeRouteIndex !== null) {
    const route = routes[activeRouteIndex];
    currentBusSchedule = route.schedule || getBusSchedule(route.station.name);
    displayBusSchedule();
  }
}

/* ---------------- AI Assistant ---------------- */
function toggleAIPanel() {
  document.getElementById("ai-panel").classList.add("active");
}

function closeAIPanel() {
  document.getElementById("ai-panel").classList.remove("active");
}

async function sendAIMessage() {
  const input = document.getElementById("ai-input");
  const message = input.value.trim();
  if (!message) return;

  addAIMessage("user", message);
  input.value = "";

  const context = buildAIContext();

  let result;
  try {
    result = await geminiAssistant.agentAct(message, context);
  } catch (error) {
    console.error("AI agent error:", error);
    result = {
      reply: "I had trouble with that — you can also fill the form on the left.",
      search: false,
    };
  }

  if (result && result.reply) addAIMessage("assistant", result.reply);

  try {
    await applyAgentActions(result);
  } catch (error) {
    console.warn("Applying AI actions failed:", error);
  }
}

// Build the current trip context the assistant can reason over.
function buildAIContext() {
  const busScheduleArray = Array.isArray(currentBusSchedule)
    ? currentBusSchedule.slice(0, 3)
    : [];

  let routeDetails = "No routes found yet";
  if (routes.length > 0) {
    routeDetails = routes
      .map(
        (r, i) =>
          `${i + 1}. To ${r.station.name} - ${r.travelMode} (${r.toStation.distance}) • Bus at ${r.busTime} • Duration: ${r.totalDuration} min • Traffic: ${r.traffic} • CO2: ${r.co2.toFixed(1)}kg`,
      )
      .join("\n");
  }

  let trafficData = "";
  if (routes.length > 0) {
    const t = routes.map((r) => r.traffic);
    trafficData = `Heavy: ${t.filter((x) => x === "heavy").length} routes, Medium: ${t.filter((x) => x === "medium").length} routes, Low: ${t.filter((x) => x === "low").length} routes. Current hour: ${new Date().getHours()}:00.`;
  }

  return {
    origin:
      originPlace?.formatted_address ||
      (currentLocation ? "Current Location" : null),
    destination: destinationPlace?.formatted_address || null,
    arrivalTime: document.getElementById("arrival-time").value || "Not set",
    routes: routeDetails,
    trafficData: trafficData,
    selectedRoute:
      activeRouteIndex !== null && routes[activeRouteIndex]
        ? routes[activeRouteIndex].summary
        : null,
    busSchedule:
      busScheduleArray.length > 0
        ? busScheduleArray.join(", ")
        : "No schedule available",
  };
}

// Apply the assistant's structured actions to the form, then optionally search.
async function applyAgentActions(a) {
  if (!a) return;
  if (a.origin && a.origin.kind) await applyOrigin(a.origin);
  if (a.destination && a.destination.kind) await applyDestination(a.destination);

  if (a.travelMode) {
    const t = document.getElementById("travel-mode");
    if (t && [...t.options].some((o) => o.value === a.travelMode)) {
      t.value = a.travelMode;
    }
  }
  if (a.arrivalTime && /^\d{1,2}:\d{2}$/.test(a.arrivalTime)) {
    const [h, m] = a.arrivalTime.split(":");
    document.getElementById("arrival-time").value = `${h.padStart(2, "0")}:${m}`;
  }

  // Run the search only when we actually have both endpoints resolved.
  if (a.search && currentLocation && destinationLocation) {
    await findRoutes();
  }
}

function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function applyOrigin(o) {
  if (o.kind === "station") {
    setRadio("origin-type", "station");
    const sel = document.getElementById("origin-station");
    if (sel) {
      sel.value = o.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (o.kind === "current") {
    setRadio("origin-type", "location");
    await getCurrentLocationAsync();
  } else {
    setRadio("origin-type", "custom");
    const inp = document.getElementById("origin-custom");
    if (inp) inp.value = o.value;
    const g = await geocodeAddress(o.value);
    if (g) {
      currentLocation = L.latLng(g.lat, g.lng);
      originPlace = { formatted_address: g.label, lat: g.lat, lng: g.lng };
      setUserMarker(currentLocation, g.label);
      map.setView(currentLocation, 13);
    }
  }
}

async function applyDestination(d) {
  if (d.kind === "station") {
    setRadio("dest-type", "station");
    const sel = document.getElementById("destination-input");
    if (sel) {
      sel.value = d.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else {
    setRadio("dest-type", "custom");
    const inp = document.getElementById("destination-input");
    if (inp) inp.value = d.value;
    const g = await geocodeAddress(d.value);
    if (g) {
      destinationLocation = L.latLng(g.lat, g.lng);
      destinationPlace = { formatted_address: g.label, lat: g.lat, lng: g.lng };
      setDestinationMarker(destinationLocation, g.label);
      map.setView(destinationLocation, 13);
    }
  }
}

async function geocodeAddress(addr) {
  try {
    const res = await fetch(
      `${PHOTON_URL}?q=${encodeURIComponent(addr)}&limit=1&lat=43.65&lon=-79.38`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const f = (data.features || [])[0];
    if (!f) return null;
    return {
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      label: formatPhoton(f),
    };
  } catch (e) {
    return null;
  }
}

function getCurrentLocationAsync() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        currentLocation = L.latLng(p.coords.latitude, p.coords.longitude);
        originPlace = {
          formatted_address: "Current Location",
          lat: p.coords.latitude,
          lng: p.coords.longitude,
        };
        setUserMarker(currentLocation, "Your Location");
        map.setView(currentLocation, 13);
        resolve(currentLocation);
      },
      () => resolve(null),
    );
  });
}

function addAIMessage(role, content) {
  const messagesContainer = document.getElementById("ai-messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `ai-message ai-message-${role}`;

  const formattedContent =
    role === "assistant" ? formatAIResponse(content) : content;

  messageDiv.innerHTML = `
    <div class="ai-avatar">${role === "user" ? ICONS.user : ICONS.ai}</div>
    <div class="ai-content">${formattedContent}</div>`;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function getAIRouteInsights() {
  if (!geminiAssistant || routes.length === 0) return;

  const routeSummary = routes
    .slice(0, 5)
    .map(
      (r, i) =>
        `${i + 1}. ${r.travelMode} to ${r.station.name} (${r.toStation.distance}) • Bus at ${r.busTime} • ${r.totalDuration} min • Traffic: ${r.traffic} • CO₂: ${r.co2.toFixed(1)}kg`,
    )
    .join("\n");

  const t = routes.map((r) => r.traffic);
  const trafficData = `Heavy: ${t.filter((x) => x === "heavy").length}, Medium: ${t.filter((x) => x === "medium").length}, Low: ${t.filter((x) => x === "low").length} routes. Current hour: ${new Date().getHours()}:00.`;

  const routeData = {
    origin: originPlace?.formatted_address || "Your location",
    destination: destinationPlace?.formatted_address || "your destination",
    arrivalTime: document.getElementById("arrival-time").value || "Not set",
    routeSummary,
    trafficData,
    busSchedule:
      currentBusSchedule.length > 0
        ? currentBusSchedule.slice(0, 3).join(", ")
        : "No schedule available",
  };

  try {
    const insights = await geminiAssistant.analyzeRoute(routeData);
    addAIMessage("assistant", insights);
    toggleAIPanel();
  } catch (error) {
    console.error("AI insights error:", error);
  }
}

/* ---------------- Map controls ---------------- */
function toggleStations() {
  if (stationsLayer) {
    stationsLayer.remove();
    stationsLayer = null;
    return;
  }
  stationsLayer = L.layerGroup(
    CONFIG.GO_TRANSIT_STATIONS.map((s) =>
      L.circleMarker([s.lat, s.lng], {
        radius: 5,
        color: "#7c74ff",
        weight: 1.5,
        fillColor: "#4d7cff",
        fillOpacity: 0.6,
      }).bindTooltip(`${s.name} (${s.type})`),
    ),
  ).addTo(map);
}

function centerMap() {
  if (currentLocation) {
    map.setView(currentLocation, 14);
  }
}

/* ---------------- Alerts ---------------- */
function addAlert(type, title, message) {
  const container = document.getElementById("alerts-list");
  document.getElementById("alerts-section").style.display = "block";

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  const icon = ICONS[type] || ICONS.info;
  alert.innerHTML = `
    <div class="alert-icon">${icon}</div>
    <div class="alert-content">
      <div class="alert-title">${title}</div>
      <div class="alert-message">${message}</div>
    </div>`;

  container.insertBefore(alert, container.firstChild);
  while (container.children.length > 3) {
    container.removeChild(container.lastChild);
  }
}

/* ---------------- Stats ---------------- */
function saveStats() {
  localStorage.setItem("gobus_trips", lifetimeStats.trips);
  localStorage.setItem("gobus_timeSaved", lifetimeStats.timeSaved);
  localStorage.setItem("gobus_co2Saved", lifetimeStats.co2Saved);
  localStorage.setItem("gobus_reroutes", lifetimeStats.reroutes);
}

function updateStatsDisplay() {
  document.getElementById("stat-reroutes").textContent = lifetimeStats.reroutes;
  animateValue("stat-trips", 0, lifetimeStats.trips, 800);
  animateValue("stat-time", 0, lifetimeStats.timeSaved, 800);
  animateValue("stat-co2", 0, lifetimeStats.co2Saved, 800, true);
}

function animateValue(id, start, end, duration, isDecimal = false) {
  const element = document.getElementById(id);
  const range = end - start;
  if (range <= 0) {
    element.textContent = isDecimal ? end.toFixed(1) : end;
    return;
  }
  const increment = range / (duration / 16);
  let current = start;
  const timer = setInterval(() => {
    current += increment;
    if (current >= end) {
      current = end;
      clearInterval(timer);
    }
    element.textContent = isDecimal ? current.toFixed(1) : Math.floor(current);
  }, 16);
}

/* ---------------- Loading ---------------- */
function showLoading(show) {
  document.getElementById("loading-overlay").classList.toggle("active", show);
}
