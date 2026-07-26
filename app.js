// RouteIQ Main Application — free OpenStreetMap stack
// Map:      Leaflet + CARTO/OSM tiles (no key, no billing)
// Routing:  OSRM (FOSSGIS public instances, no key)
// Search:   Photon geocoder (no key)
let map, routeLayer, stationsLayer, poiLayer;
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

// Longest believable walk/bike leg to a station. Beyond this the option is
// dropped rather than shown (OSRM will happily return a 50-hour walk).
const MAX_ACTIVE_ACCESS_MIN = 90;

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

// Cost lens: apply the 40% post-secondary discount when on.
let studentFare = localStorage.getItem("routeiq_student_fare") === "1";

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

  // Leave "Desired Arrival Time" empty by default — a blank field means "no
  // target", so the assistant won't warn about arriving late against a time the
  // user never chose. Back-solving kicks in only once they set a real class time.
  document.getElementById("arrival-time").value = "";

  updateStatsDisplay();
  setupEventListeners();
  initChatHistory();
  initSidebarResizer();
  handleDestinationType();
  renderCampusChips();
  Gamification.init();
  GroupTrip.init();

  // Service alerts are NOT loaded globally anymore — they're fetched per chosen
  // route (see loadRouteAlerts in selectRoute) so they stay relevant.
}

function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
    [43.6532, -79.3832],
    12,
  );

  // Detailed CARTO "Voyager" tiles (buildings, POIs, transit) rendered dark via
  // a CSS filter on the tile pane, so the map keeps its black/purple colorway
  // but shows far more detail than the minimal dark_all basemap.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
      className: "riq-dark-tiles",
    },
  ).addTo(map);

  mapReady = true;

  // Show GO stops + campuses by default for a more detailed map.
  poiLayer = buildPoiLayer().addTo(map);

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
  document.getElementById("reset-plan")?.addEventListener("click", resetPlanner);

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

// Shared geolocation options: high accuracy, but never hang — time out after
// 10s and allow a recent cached fix so repeat calls resolve instantly.
const GEO_OPTS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };

// Map a GeolocationPositionError to a message the user can act on.
function geoErrorMessage(error) {
  if (error && error.code === 1)
    return "Location permission was blocked. Enable it for this site (address-bar icon), or enter an address instead.";
  if (error && error.code === 2)
    return "Your location is unavailable right now. Enter an address instead.";
  if (error && error.code === 3)
    return "Finding your location timed out. Try again, or enter an address instead.";
  return "Could not get your current location. Try entering an address instead.";
}

function refreshCurrentLocation() {
  showLoading(true);

  if (!navigator.geolocation) {
    addAlert("error", "Not Supported", "Geolocation is not supported by your browser.");
    showLoading(false);
    return;
  }

  // Geolocation only works in a secure context (HTTPS or localhost). Fail fast
  // with a clear reason instead of a silent timeout on a plain-http page.
  if (window.isSecureContext === false) {
    addAlert(
      "warning",
      "Location Needs HTTPS",
      "Your browser only shares location over HTTPS (or localhost). Open the site over https, or enter an address instead.",
    );
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
      addAlert("warning", "Location Error", geoErrorMessage(error));
      showLoading(false);
    },
    GEO_OPTS,
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
  // Same origin and destination — a trip to yourself isn't a trip.
  if (currentLocation.distanceTo(destinationLocation) < 200) {
    addAlert(
      "warning",
      "Same location",
      "Your origin and destination are basically the same spot — pick two different places.",
    );
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
    //  - custom destination  -> every travel mode to the nearest station, plus
    //    a couple of alternative nearby stations, so options differ by BOTH mode
    //    and station (not five identical "walk" cards).
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
        // Non-transit: go straight to the destination station in that mode.
        ["WALKING", "BICYCLING", "DRIVING"].forEach((mode) => {
          legs.push({ station: destStation, mode, needsBusLeg: false });
        });
        // Transit: drive/Uber to the nearest BOARDING station (access leg), then
        // take the transit system onward to the destination station. Pick the
        // station nearest the ORIGIN (which is the origin's own station if it is
        // one — a walk-up, so the drive leg is ~0), never the destination itself.
        const board = findNearbyStations(currentLocation, 5).find(
          (s) => s.code !== destStation.code,
        );
        if (board) {
          legs.push({
            station: board,
            accessMode: "DRIVING",
            displayMode: "TRANSIT",
            needsBusLeg: true,
            transitTarget: L.latLng(destStation.lat, destStation.lng),
          });
        } else {
          // Origin is already at/adjacent to the destination station.
          legs.push({ station: destStation, mode: "TRANSIT", needsBusLeg: false });
        }
      }
    } else {
      // Skip the origin's own station if the origin IS a station.
      const nearby = findNearbyStations(currentLocation, 4).filter(
        (s) =>
          !originLocationFromStation ||
          s.code !== originLocationFromStation.code,
      );
      const nearest = nearby[0];
      if (nearest) {
        // Nearest station: offer walk/bike/drive to it, so cards differ by mode.
        ["WALKING", "BICYCLING", "DRIVING"].forEach((mode) => {
          legs.push({ station: nearest, mode, needsBusLeg: true });
        });
        // Transit: the access leg to the boarding station is a drive/Uber.
        legs.push({
          station: nearest,
          accessMode: "DRIVING",
          displayMode: "TRANSIT",
          needsBusLeg: true,
        });
      }
      // A couple of alternative stations (in the selected mode) for variety.
      nearby.slice(1, 3).forEach((station) => {
        const isTransit = selectedMode === "TRANSIT";
        legs.push({
          station,
          accessMode: isTransit ? "DRIVING" : selectedMode,
          displayMode: selectedMode,
          needsBusLeg: true,
        });
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
      // accessMode routes the leg TO the station; displayMode is what the card
      // shows (for TRANSIT the access leg is a drive/Uber, shown separately).
      const accessMode = leg.accessMode || leg.mode;
      const effMode = leg.displayMode || leg.mode;
      const stationLocation = L.latLng(leg.station.lat, leg.station.lng);
      const routeToStation = await getDirections(
        currentLocation,
        stationLocation,
        accessMode,
      );
      if (!routeToStation) continue;

      let routeFromStation = null;
      if (leg.needsBusLeg) {
        routeFromStation = await getDirections(
          stationLocation,
          leg.transitTarget || destinationLocation,
          "TRANSIT",
        );
        if (!routeFromStation) continue;
      }

      // Reject access legs that are absurd for the mode — a 15 km "walk to the
      // station" (or a 50 h one from outside the GO area) is not a real option
      // and it poisons the ranking and the leave-by advice.
      if (
        (effMode === "WALKING" || effMode === "BICYCLING") &&
        routeToStation.duration > MAX_ACTIVE_ACCESS_MIN
      ) {
        continue;
      }

      const accessKm = goTransitService.parseDistance(routeToStation.distance);
      const transitKm = routeFromStation
        ? goTransitService.parseDistance(routeFromStation.distance)
        : 0;
      // Whole-journey figure: scoring only the access leg reported 0 kg saved
      // for transit options that board at the origin's own station.
      const co2 = goTransitService.calculateJourneyCO2Savings(
        accessKm,
        transitKm,
        effMode,
      );
      const totalKm = accessKm + transitKm;

      // Driving is most affected by peak-hour congestion; active modes least.
      let traffic = "low";
      if (peak) {
        if (effMode === "DRIVING") traffic = "heavy";
        else if (effMode === "TRANSIT") traffic = "medium";
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
        travelMode: effMode,
        totalDuration: totalDuration,
        totalKm: totalKm,
        summary: `${effMode} to ${leg.station.name} (${routeToStation.distance}) • Bus at ${busTime}`,
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
      // Pin the user's chosen travel mode to the top (Array.sort is stable, so
      // duration order is preserved within each group). Selecting "Transit"
      // then surfaces the transit option first — the "Fastest" badge still goes
      // to the genuinely shortest option wherever it lands (see displayRoutes).
      uniqueRoutes.sort(
        (a, b) =>
          (a.travelMode === selectedMode ? 0 : 1) -
          (b.travelMode === selectedMode ? 0 : 1),
      );
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

      // Update streaks / XP / badges off the fastest option.
      Gamification.recordTrip(routes[0]);

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

  const displayed = routes.slice(0, 5);
  // "Fastest" = the genuinely shortest-duration option, decoupled from position
  // (the top card is the user's chosen travel mode, which may not be fastest).
  let fastestIndex = 0;
  displayed.forEach((r, i) => {
    if (r.totalDuration < displayed[fastestIndex].totalDuration) fastestIndex = i;
  });

  container.innerHTML =
    renderStudentToggle() +
    displayed
      .map((route, index) => {
        const mode =
          CONFIG.TRAVEL_MODES.find((m) => m.value === route.travelMode) ||
          CONFIG.TRAVEL_MODES[0];
        const isZeroCO2 = mode.zeroCO2 || false;
        const co2Value = route.co2 || 0;
        const cost = estimateTripCost(route);

      return `
        <div class="route-card ${index === 0 ? "active" : ""}" data-index="${index}">
          <div class="route-header">
            <div class="route-title">
              <span class="route-icon">${mode.icon}</span>
              ${mode.label}
            </div>
            ${index === fastestIndex ? '<div class="route-badge">Fastest</div>' : ""}
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
                <div class="route-detail-value">${
                  // Whole journey, not just the leg to the station — a transit
                  // option boarding at your own station showed "0.0 km".
                  Number.isFinite(route.totalKm)
                    ? `${route.totalKm.toFixed(1)} km`
                    : route.toStation.distance
                }</div>
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

          <div class="route-co2 ${co2Value > 0.05 ? "savings" : ""}">
            ${
              // co2 is now always "avoided vs driving door-to-door", so label it
              // that way for every mode instead of only the zero-carbon ones
              // (walking previously rendered a bare "3.0 kg CO₂", which read as
              // emissions rather than savings).
              co2Value > 0.05
                ? `<span class="cost-ic">${UI_ICONS.leaf}</span>${co2Value.toFixed(1)} kg CO₂ saved vs driving`
                : `No CO₂ saved vs driving`
            }
          </div>

          <div class="route-cost">
            <div class="route-cost-fare">
              <span class="route-cost-label">GO fare${studentFare ? " · student" : ""}</span>
              <span class="route-cost-value">~$${cost.fare.toFixed(2)}<span class="route-cost-est"> est.</span></span>
            </div>
            ${
              cost.savings > 0.5
                ? `<div class="route-cost-save"><span class="cost-ic">${UI_ICONS.savings}</span>Save ~$${cost.savings.toFixed(2)} vs driving${cost.paysParking ? " (incl. parking)" : ""}${cost.freeTTC ? " · TTC leg free (One Fare)" : ""}</div>`
                : cost.freeTTC
                  ? `<div class="route-cost-save">TTC connection free (One Fare)</div>`
                  : ""
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

  const modeDef =
    CONFIG.TRAVEL_MODES.find((m) => m.value === route.travelMode) ||
    CONFIG.TRAVEL_MODES[0];
  // TRANSIT is special: the leg to the station is a drive/Uber (the "access"
  // leg) drawn YELLOW & DASHED, and the transit system itself is the SOLID main
  // line. Every other mode keeps leg 1 solid (the actual travel) + leg 2 amber
  // dashed (the GO bus/train connection).
  const isTransit = route.travelMode === "TRANSIT";
  const accessColor = isTransit ? "#e0b25a" : modeDef.color || "#8257e6";
  const transitColor = isTransit ? "#6ea8fe" : "#e0b25a";

  const g1 = route.toStation && route.toStation.geometry;
  const g2 = route.fromStation && route.fromStation.geometry;
  const hasBusLeg = !!(g2 && g2.length);

  const layers = [];
  if (g1 && g1.length) {
    layers.push(
      L.polyline(g1, {
        color: accessColor,
        weight: 5,
        opacity: 0.95,
        lineJoin: "round",
        lineCap: "round",
        // Access leg dashed only for transit (drive/Uber to the station).
        dashArray: isTransit ? "2 10" : undefined,
      }).bindTooltip(
        isTransit
          ? `Drive / Uber to ${route.station.name}`
          : `${modeDef.label} to ${route.station.name}`,
        { sticky: true },
      ),
    );
  }
  if (hasBusLeg) {
    layers.push(
      L.polyline(g2, {
        color: transitColor,
        weight: 5,
        opacity: 0.95,
        // Transit leg is solid; a non-transit GO connection stays dashed.
        dashArray: isTransit ? undefined : "2 10",
        lineCap: "round",
      }).bindTooltip(isTransit ? "Transit" : "GO bus / train", {
        sticky: true,
      }),
    );
  }

  // Waypoint markers: Start → (Board GO) → Destination.
  const startPt =
    g1 && g1.length
      ? g1[0]
      : currentLocation
        ? [currentLocation.lat, currentLocation.lng]
        : null;
  const stationPt = [route.station.lat, route.station.lng];
  const endPt =
    hasBusLeg && g2.length
      ? g2[g2.length - 1]
      : destinationLocation
        ? [destinationLocation.lat, destinationLocation.lng]
        : stationPt;

  const dot = (pt, color, label) =>
    L.circleMarker(pt, {
      radius: 7,
      color: "#0b0d14",
      weight: 3,
      fillColor: color,
      fillOpacity: 1,
    }).bindTooltip(label);

  if (startPt) layers.push(dot(startPt, accessColor, "Start"));
  if (hasBusLeg) {
    // Station is a transfer point: get off the access leg, board GO here.
    layers.push(dot(stationPt, transitColor, `Board GO · ${route.station.name}`));
    layers.push(dot(endPt, "#f0637a", "Destination"));
  } else {
    // Station itself is the destination.
    layers.push(dot(stationPt, "#f0637a", `Destination · ${route.station.name}`));
  }

  routeLayer = L.layerGroup(layers).addTo(map);

  const allPts = [];
  if (g1 && g1.length) allPts.push(...g1);
  if (hasBusLeg) allPts.push(...g2);
  if (allPts.length)
    map.fitBounds(L.latLngBounds(allPts), { padding: [60, 60] });

  updateRouteLegend(route, accessColor, transitColor, modeDef, hasBusLeg);
}

// Small on-map legend so the two leg colours are readable.
function updateRouteLegend(route, accessColor, transitColor, modeDef, hasBusLeg) {
  let el = document.getElementById("route-legend");
  if (!el) {
    el = document.createElement("div");
    el.id = "route-legend";
    el.className = "route-legend";
    (document.querySelector(".map-container") || document.body).appendChild(el);
  }
  const isTransit = route.travelMode === "TRANSIT";
  const rows = [
    isTransit
      ? `<div class="rl-row"><span class="rl-swatch rl-dash" style="background:${accessColor}"></span>Drive / Uber to station</div>`
      : `<div class="rl-row"><span class="rl-swatch" style="background:${accessColor}"></span>${modeDef.label} to station</div>`,
  ];
  if (hasBusLeg) {
    rows.push(
      isTransit
        ? `<div class="rl-row"><span class="rl-swatch" style="background:${transitColor}"></span>Transit</div>`
        : `<div class="rl-row"><span class="rl-swatch rl-dash" style="background:${transitColor}"></span>GO bus / train</div>`,
    );
  }
  el.innerHTML = rows.join("");
  el.style.display = "block";
}

function startRoute(index) {
  isNavigating = true;
  selectRoute(index);

  const route = routes[index];
  drawRoute(route);

  // Take the user to their starting point on the map.
  const startLatLng =
    route.toStation?.geometry?.[0] ||
    (currentLocation && [currentLocation.lat, currentLocation.lng]);
  if (startLatLng) map.setView(startLatLng, 15);

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

  // Live follow-along navigation (foreground): streams GPS, follows you on the
  // map, gives turn-by-turn to the stop, and alerts on arrival.
  if (typeof Navigation !== "undefined") Navigation.start(route);
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
  // When an arrival time is set, recommendForArrival owns the instruction (it
  // names the stop, bus and arrival). Only fall back to the generic "Leave by"
  // when there's no arrival target — otherwise both fire with different buffers.
  if (!recommendForArrival(route)) calculateLeaveTime(route);

  // Show ONLY the disruptions that affect this route's station (real Metrolinx
  // data, filtered) — replaces the old global alert dump.
  loadRouteAlerts(route);

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

const ARRIVAL_BUFFER = 5; // be at the destination this many minutes early
const WALKUP_BUFFER = 10; // slack to reach the stop and board

const hhmmToMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const minToHhmm = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// A leave-by time is only meaningful if it hasn't already passed. Wrapping a
// negative result into a same-day clock time (e.g. a 50-hour access leg from
// Kingston yielding "leave by 16:06") produces a plausible-looking but wrong
// instruction, so callers must check this before printing a time.
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function leaveByIsReachable(leaveByMin) {
  return leaveByMin >= nowMinutes();
}
// Phrase an unreachable leave-by without printing a wrapped clock time: once the
// value falls outside today, "16:06" is meaningless (it came from a modulo).
function unreachableLeaveByPhrase(leaveByMin) {
  return leaveByMin < 0
    ? "you'd have needed to set off yesterday"
    : `you'd have needed to leave by ${minToHhmm(leaveByMin)}`;
}
// "3 h 20 min" / "50 h" — long access legs read as nonsense in raw minutes.
function humanMinutes(min) {
  if (!Number.isFinite(min)) return "?";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Lecture-time back-solve: given a desired arrival ("class at 08:00"), pick the
// LATEST departure that still gets there with ARRIVAL_BUFFER to spare, then state
// the whole plan in one instruction — when to leave, how to reach which stop,
// which bus to catch, and the estimated arrival. Returns true when it produced a
// plan, so the caller can skip the generic "Leave by" alert (two alerts with
// different buffers used to stack and contradict each other).
function recommendForArrival(route) {
  const arrival = document.getElementById("arrival-time").value;
  if (!arrival || !/^\d{1,2}:\d{2}$/.test(arrival)) return false;
  if (!currentBusSchedule || !currentBusSchedule.length) return false;

  const arrivalMin = hhmmToMin(arrival);
  const rideMin = route.fromStation ? route.fromStation.duration : 0;
  const accessMin = route.toStation ? route.toStation.duration : 0;
  const modeDef = CONFIG.TRAVEL_MODES.find((m) => m.value === route.travelMode);
  const accessVerb =
    route.travelMode === "TRANSIT"
      ? "drive"
      : (modeDef ? modeDef.label : route.travelMode).toLowerCase();
  const boardingStop = route.station.name;
  // Geocoded labels are long ("McMaster University, Main Street West, Hamilton,
  // Ontario"); the first segment is the recognisable place name.
  const destName =
    (destinationPlace?.formatted_address || "").split(",")[0].trim() ||
    "your destination";

  // Latest bus that still lands on time (with buffer).
  let best = null;
  for (const t of currentBusSchedule) {
    if (hhmmToMin(t) + rideMin + ARRIVAL_BUFFER <= arrivalMin) best = t;
  }

  clearPlanAlerts();

  if (!best) {
    // Nothing arrives in time — say so plainly instead of silently falling back
    // to "next bus", which would look like a valid plan for the class.
    const earliest = currentBusSchedule[0];
    addAlert(
      "warning",
      `Can't make ${arrival}`,
      `No remaining departure from ${boardingStop} gets you to ${destName} by ${arrival}` +
        (earliest
          ? ` — the next one (${earliest}) arrives about ${minToHhmm(hhmmToMin(earliest) + rideMin)}. Try driving the whole way, a closer stop, or an earlier departure.`
          : "."),
      "plan",
    );
    return true;
  }

  selectedBusTime = best;
  document.querySelectorAll(".bus-time-option").forEach((o) => {
    o.classList.toggle("selected", o.dataset.time === best);
  });

  const leaveByMin = hhmmToMin(best) - accessMin - WALKUP_BUFFER;
  const estArrivalMin = hhmmToMin(best) + rideMin;
  const spare = arrivalMin - estArrivalMin;
  const access = `${accessVerb.charAt(0).toUpperCase() + accessVerb.slice(1)} ${humanMinutes(accessMin)} to ${boardingStop}`;

  if (!leaveByIsReachable(leaveByMin)) {
    // You'd have had to leave already — don't print a wrapped clock time.
    addAlert(
      "warning",
      `Too late for the ${best} bus`,
      `Getting to ${boardingStop} takes ${humanMinutes(accessMin)}, longer than the time left before the ${best} departs, so ${unreachableLeaveByPhrase(leaveByMin)}. ` +
        `Pick a closer stop, drive the whole way, or plan this for tomorrow.`,
      "plan",
    );
    return true;
  }

  addAlert(
    "info",
    `Leave by ${minToHhmm(leaveByMin)} for your ${arrival}`,
    `${access}, catch the ${best} bus, and you reach ${destName} around ${minToHhmm(estArrivalMin)} — ` +
      `${spare} min before ${arrival}.`,
    "plan",
  );
  return true;
}

// Drop any previous trip-plan instruction so a new selection replaces it rather
// than stacking a second, contradictory "leave by" line.
function clearPlanAlerts() {
  document
    .querySelectorAll('#alerts-list [data-alert-kind="plan"]')
    .forEach((el) => el.remove());
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

  const accessMin = route.toStation.duration;
  const leaveByMin = hhmmToMin(selectedBusTime) - accessMin - WALKUP_BUFFER;

  // Tagged "plan" and cleared first, so picking a different bus REPLACES this
  // line instead of adding another one with a different time.
  clearPlanAlerts();
  if (!leaveByIsReachable(leaveByMin)) {
    addAlert(
      "warning",
      `Too late for the ${selectedBusTime} bus`,
      `Getting to ${route.station.name} takes ${humanMinutes(accessMin)}, so ${unreachableLeaveByPhrase(leaveByMin)}. Try a closer stop, driving, or a later departure.`,
      "plan",
    );
    return;
  }
  addAlert(
    "info",
    `Leave by ${minToHhmm(leaveByMin)}`,
    `${humanMinutes(accessMin)} to ${route.station.name}, then catch the ${selectedBusTime} bus.`,
    "plan",
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

  // Group "meet in the middle" requests are handled by the GroupTrip module
  // (it opens the panel, fills locations, and runs the finder).
  if (typeof GroupTrip !== "undefined" && GroupTrip.tryHandle(message)) {
    return;
  }

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

  // Phase 1: if the assistant identified a trip, hand off to the interactive
  // in-chat picker (choose stops / address / departure time) instead of silently
  // auto-filling and searching. Falls through to the old behaviour if the picker
  // module isn't loaded.
  if (typeof beginTripPicker === "function" && (a.origin || a.destination)) {
    await beginTripPicker(a);
    return;
  }

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
      GEO_OPTS,
    );
  });
}

/* ---------------- AI chat history (local persistence) ---------------- */
// Transcript is kept on-device only (localStorage) — nothing leaves the browser.
const CHAT_KEY = "routeiq_chat";
let chatLog = []; // [{role, content}] — everything after the static welcome
let aiWelcomeHTML = ""; // the static greeting markup, preserved across clears

function initChatHistory() {
  const container = document.getElementById("ai-messages");
  if (!container) return;
  aiWelcomeHTML = container.innerHTML; // capture the greeting once, before restore
  loadChat();

  document
    .getElementById("clear-chat")
    ?.addEventListener("click", clearChat);
}

function saveChat() {
  try {
    // Cap the stored transcript so it can't grow without bound.
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatLog.slice(-100)));
  } catch (e) {
    /* storage full / disabled — chat just won't persist */
  }
}

function loadChat() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
  } catch (e) {
    saved = [];
  }
  const valid = Array.isArray(saved)
    ? saved.filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
    : [];
  if (!valid.length) return;

  // Repopulate chatLog so the NEXT saved message appends to the full history
  // instead of overwriting it; render each with persist=false to avoid re-saving.
  chatLog = valid.map((m) => ({ role: m.role, content: m.content }));
  valid.forEach((m) => addAIMessage(m.role, m.content, false));

  // Rehydrate the assistant's context so follow-up questions stay coherent.
  if (geminiAssistant) {
    geminiAssistant.conversationHistory = valid
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
  }
}

function clearChat() {
  chatLog = [];
  try {
    localStorage.removeItem(CHAT_KEY);
  } catch (e) {}
  const container = document.getElementById("ai-messages");
  if (container) container.innerHTML = aiWelcomeHTML; // back to just the greeting
  if (geminiAssistant) geminiAssistant.conversationHistory = [];
}

function addAIMessage(role, content, persist = true) {
  const messagesContainer = document.getElementById("ai-messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `ai-message ai-message-${role}`;

  const avatar = document.createElement("div");
  avatar.className = "ai-avatar";
  avatar.innerHTML = role === "user" ? ICONS.user : ICONS.ai; // trusted inline SVG constants

  const contentEl = document.createElement("div");
  contentEl.className = "ai-content";
  if (role === "assistant") {
    // formatAIResponse escapes its input, then emits only safe markup.
    contentEl.innerHTML = formatAIResponse(content);
  } else {
    // User text is untrusted — never parse it as HTML.
    contentEl.textContent = content;
  }

  messageDiv.append(avatar, contentEl);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Persist the transcript locally so the conversation survives a reload.
  // Skipped when replaying stored messages (persist=false) to avoid double-save.
  if (persist) {
    chatLog.push({ role, content });
    saveChat();
  }
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
// Points of interest: GO stops (bus/train) + campuses, as themed SVG pins with
// hover labels. Shown by default so the map reads as more detailed.
function buildPoiLayer() {
  const markers = [];

  CONFIG.GO_TRANSIT_STATIONS.forEach((s) => {
    markers.push(
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="poi poi-stop">${UI_ICONS.bus}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).bindTooltip(`${s.name} · GO ${s.type}`),
    );
  });

  (CONFIG.CAMPUSES || []).forEach((c) => {
    markers.push(
      L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="poi poi-school">${UI_ICONS.cap}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).bindTooltip(`${c.name}`),
    );
  });

  return L.layerGroup(markers);
}

function toggleStations() {
  if (poiLayer && map.hasLayer(poiLayer)) {
    map.removeLayer(poiLayer);
    return;
  }
  if (!poiLayer) poiLayer = buildPoiLayer();
  poiLayer.addTo(map);
}

function centerMap() {
  if (currentLocation) {
    map.setView(currentLocation, 14);
  }
}

/* ---------------- Alerts ---------------- */
function addAlert(type, title, message, kind = null) {
  const container = document.getElementById("alerts-list");
  document.getElementById("alerts-section").style.display = "block";

  // De-dupe: don't stack an alert identical to one already shown. Keeps the
  // "Leave by" message and the periodic service-alert refresh from piling up.
  const dup = [...container.children].some(
    (el) =>
      el.querySelector(".alert-title")?.textContent === title &&
      el.querySelector(".alert-message")?.textContent === message,
  );
  if (dup) return;

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  if (kind) alert.dataset.alertKind = kind; // e.g. "service" — so we can clear/replace them per route
  const icon = ICONS[type] || ICONS.info;
  const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => s;
  // title/message can include third-party (Metrolinx) text — escape it.
  alert.innerHTML = `
    <div class="alert-icon">${icon}</div>
    <div class="alert-content">
      <div class="alert-title">${esc(title)}</div>
      <div class="alert-message">${esc(message || "")}</div>
    </div>`;

  container.insertBefore(alert, container.firstChild);
  while (container.children.length > 4) {
    container.removeChild(container.lastChild);
  }
}

/* ---------------- Route-tailored service alerts ---------------- */
// Real Metrolinx alerts, filtered to the CHOSEN route's station (city/code) so
// only relevant disruptions surface — never global or fabricated ones.
function routeAlertKeywords(route) {
  if (!route || !route.station) return [];
  const k = [];
  const name = route.station.name || "";
  k.push(name);
  const city = name.replace(/\s+(GO|Bus|Train|Terminal|Centre|Center|Station|&).*$/i, "").trim();
  if (city.length >= 3) k.push(city);
  if (route.station.code) k.push(String(route.station.code));
  return [...new Set(k)];
}

function clearServiceAlerts() {
  document
    .querySelectorAll('#alerts-list [data-alert-kind="service"]')
    .forEach((el) => el.remove());
}

async function loadRouteAlerts(route) {
  if (!goTransitService || !route || !route.station) return;
  clearServiceAlerts(); // drop the previous route's alerts before loading this one's
  try {
    const alerts = await goTransitService.getAlertsForKeywords(routeAlertKeywords(route));
    alerts
      .slice(0, 2)
      .forEach((a) =>
        addAlert("warning", `Service alert · ${route.station.name}`, a.message, "service"),
      );
  } catch (e) {
    /* alerts are best-effort */
  }
}

// Re-check the active route's alerts (used by the 60s poller during a trip).
function refreshActiveRouteAlerts() {
  if (activeRouteIndex != null && routes[activeRouteIndex]) {
    loadRouteAlerts(routes[activeRouteIndex]);
  }
}

/* ---------------- Cost lens (est. fares + PRESTO student discount) ------- */
// Estimated GO single fare + savings vs driving. GO fares are distance-based
// and set by Metrolinx; these are transparent ESTIMATES (see CONFIG.FARE_MODEL),
// not official prices. Full-time post-secondary students save 40% with PRESTO,
// and Ontario's One Fare makes a connecting TTC leg free.
function estimateTripCost(route) {
  const f = CONFIG.FARE_MODEL;
  const km = goTransitService.parseDistance(route.toStation.distance) +
    (route.fromStation ? goTransitService.parseDistance(route.fromStation.distance) : 0);

  let fare = f.estBaseFare + Math.max(0, km - f.baseDistanceKm) * f.estPerKm;
  if (studentFare) fare *= 1 - f.studentDiscount;

  const dest = (destinationPlace?.formatted_address || "").toLowerCase();
  const freeTTC = /toronto|union|tmu|ryerson|u of t|university of toronto/.test(dest);

  // Only count parking in the driving comparison where you'd actually pay to
  // park — a campus or downtown Toronto. Otherwise the driving alternative is
  // fuel only, so "savings vs driving" isn't inflated for ordinary trips.
  const paysParking =
    freeTTC ||
    (CONFIG.CAMPUSES || []).some((c) => {
      const short = c.short.toLowerCase();
      const firstWord = c.name.toLowerCase().split(" ")[0];
      return dest.includes(short) || (firstWord.length > 3 && dest.includes(firstWord));
    });

  const driveCost = km * f.gasPerKm + (paysParking ? f.campusParkingPerDay : 0);
  const savings = driveCost - fare; // can be <= 0; the UI only shows real savings

  return { fare, savings, freeTTC, paysParking };
}

function renderStudentToggle() {
  return `
    <label class="student-toggle">
      <input type="checkbox" ${studentFare ? "checked" : ""} onchange="toggleStudentFare(this.checked)" />
      <span class="student-toggle-track"><span class="student-toggle-thumb"></span></span>
      <span class="student-toggle-text"><span class="cost-ic">${UI_ICONS.cap}</span>Student fare <em>(40% off)</em></span>
    </label>`;
}

function toggleStudentFare(on) {
  studentFare = !!on;
  localStorage.setItem("routeiq_student_fare", studentFare ? "1" : "0");
  if (routes.length) displayRoutes();
}

/* ---------------- Campus quick-pick ---------------- */
function renderCampusChips() {
  const wrap = document.getElementById("campus-chips");
  if (!wrap || typeof CONFIG.CAMPUSES === "undefined") return;
  wrap.innerHTML = CONFIG.CAMPUSES.map(
    (c, i) => `<button class="campus-chip" data-i="${i}" type="button">${c.short}</button>`,
  ).join("");
  wrap.querySelectorAll(".campus-chip").forEach((chip) =>
    chip.addEventListener("click", () => setCampusDestination(CONFIG.CAMPUSES[parseInt(chip.dataset.i)])),
  );
}

// Reset the planner back to a clean, empty state — clears origin/destination,
// time, mode, results, markers, the drawn route, alerts, and any live nav.
function resetPlanner() {
  if (typeof Navigation !== "undefined" && Navigation.active && Navigation.active()) {
    Navigation.stop();
  }

  currentLocation = null;
  destinationLocation = null;
  originLocationFromStation = null;
  originPlace = null;
  destinationPlace = null;
  activeRouteIndex = null;
  selectedBusTime = null;
  currentBusSchedule = [];
  routes.length = 0;
  isNavigating = false;
  try { if (typeof tripPicker !== "undefined") tripPicker = null; } catch (e) {}

  // Markers + drawn route.
  if (userMarker) { userMarker.remove(); userMarker = null; }
  if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; }
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }

  // Inputs back to defaults (rebuilds the origin/destination containers).
  setRadio("origin-type", "location");
  setRadio("dest-type", "custom");
  const arr = document.getElementById("arrival-time"); if (arr) arr.value = "";
  const tm = document.getElementById("travel-mode"); if (tm) tm.value = "WALKING";
  document.querySelectorAll(".campus-chip.active").forEach((c) => c.classList.remove("active"));

  // Hide + clear result / alert sections.
  ["routes-section", "bus-section", "alerts-section"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  ["routes-list", "bus-schedule-container", "alerts-list"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  const summary = document.getElementById("trip-summary"); if (summary) summary.remove();

  // Recenter the map to the default GTA view.
  if (map) map.setView([43.6532, -79.3832], 12);
}

function setCampusDestination(campus) {
  if (!campus) return;
  setRadio("dest-type", "custom");
  const inp = document.getElementById("destination-input");
  if (inp) inp.value = campus.name;
  destinationLocation = L.latLng(campus.lat, campus.lng);
  destinationPlace = { formatted_address: campus.name, lat: campus.lat, lng: campus.lng };
  setDestinationMarker(destinationLocation, campus.name);
  map.setView(destinationLocation, 13);
  addAlert("info", "Destination set", `Heading to ${campus.name}. Add your origin and hit Find Routes.`);
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
