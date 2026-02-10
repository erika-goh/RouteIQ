// RouteIQ Main Application with GO Transit API Integration
let map, directionsService, directionsRenderer, geocoder, trafficLayer;
let currentLocation = null;
let destinationLocation = null;
let originLocationFromStation = null;
let activeRouteIndex = null;
let mapReady = false;
let userMarker, destinationMarker;
let defaultBounds = null;
let originPlace = null;
let destinationPlace = null;
let selectedBusTime = null;
let currentBusSchedule = [];
let geminiAssistant = null;
let goTransitService = null;
let isNavigating = false;

const routes = [];
const userIncidents = [];

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
  // Initialize GO Transit API
  goTransitService = new GOTransitService(CONFIG.GO_TRANSIT_API.KEY);

  // Initialize Gemini
  if (
    CONFIG.GEMINI_API_KEY &&
    CONFIG.GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY"
  ) {
    geminiAssistant = new GeminiAssistant(CONFIG.GEMINI_API_KEY);
  }

  // Initialize map
  initMap();

  // Set default arrival time (30 minutes from now)
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  document.getElementById("arrival-time").value = now
    .toTimeString()
    .substring(0, 5);

  // Update stats display
  updateStatsDisplay();

  // Setup event listeners
  setupEventListeners();

  // Initialize destination input handler
  handleDestinationType();

  // Load service updates (non-blocking, optional feature)
  // Don't await this as it may fail due to CORS
  loadServiceUpdates().catch(() => {
    // Service updates are optional, silently fail
  });
}

function initMap() {
  const defaultCenter = { lat: 43.6532, lng: -79.3832 }; // Toronto

  map = new google.maps.Map(document.getElementById("map"), {
    center: defaultCenter,
    zoom: 12,
    styles: getMapStyles(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: "#3b82f6",
      strokeWeight: 4,
      strokeOpacity: 0.8,
    },
  });

  geocoder = new google.maps.Geocoder();
  trafficLayer = new google.maps.TrafficLayer();

  mapReady = true;

  // Initialize autocomplete for destination
  const destinationInput = document.getElementById("destination-input");
  const autocomplete = new google.maps.places.Autocomplete(destinationInput);
  autocomplete.bindTo("bounds", map);

  autocomplete.addListener("place_changed", () => {
    destinationPlace = autocomplete.getPlace();
    if (destinationPlace.geometry) {
      destinationLocation = destinationPlace.geometry.location;
    }
  });
}

function setupEventListeners() {
  // Origin type change
  document.querySelectorAll('input[name="origin-type"]').forEach((radio) => {
    radio.addEventListener("change", handleOriginType);
  });

  // Destination type change
  document.querySelectorAll('input[name="dest-type"]').forEach((radio) => {
    radio.addEventListener("change", handleDestinationType);
  });

  // Refresh location button
  document
    .getElementById("refresh-location")
    ?.addEventListener("click", refreshCurrentLocation);

  // Find routes button
  document.getElementById("find-routes").addEventListener("click", findRoutes);

  // Travel mode change
  document
    .getElementById("travel-mode")
    .addEventListener("change", handleTravelModeChange);

  // AI Assistant toggle
  document.getElementById("ai-toggle").addEventListener("click", toggleAIPanel);
  document.getElementById("close-ai").addEventListener("click", closeAIPanel);

  // AI message send
  document.getElementById("ai-send").addEventListener("click", sendAIMessage);
  document.getElementById("ai-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendAIMessage();
    }
  });

  // Map controls
  document
    .getElementById("toggle-traffic")
    .addEventListener("click", toggleTraffic);
  document.getElementById("center-map").addEventListener("click", centerMap);
}

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
            </button>
        `;
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
            </select>
        `;
    document
      .getElementById("origin-station")
      .addEventListener("change", setOriginStation);
  } else {
    container.innerHTML = `
            <input type="text" id="origin-custom" class="text-input" placeholder="Enter origin address">
        `;
    const input = document.getElementById("origin-custom");
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo("bounds", map);
    autocomplete.addListener("place_changed", () => {
      originPlace = autocomplete.getPlace();
      if (originPlace.geometry) {
        currentLocation = originPlace.geometry.location;
      }
    });
  }
}

function setOriginStation() {
  const select = document.getElementById("origin-station");
  const selectedOption = select.options[select.selectedIndex];

  if (selectedOption.value) {
    const lat = parseFloat(selectedOption.dataset.lat);
    const lng = parseFloat(selectedOption.dataset.lng);
    currentLocation = new google.maps.LatLng(lat, lng);
    originLocationFromStation = {
      code: selectedOption.value,
      name: selectedOption.text,
    };
    map.setCenter(currentLocation);

    // Add marker
    if (userMarker) {
      userMarker.setMap(null);
    }

    userMarker = new google.maps.Marker({
      position: currentLocation,
      map: map,
      title: selectedOption.text,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: "#3b82f6",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });
  }
}

function refreshCurrentLocation() {
  showLoading(true);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentLocation = new google.maps.LatLng(
          position.coords.latitude,
          position.coords.longitude,
        );

        if (userMarker) {
          userMarker.setMap(null);
        }

        userMarker = new google.maps.Marker({
          position: currentLocation,
          map: map,
          title: "Your Location",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });

        map.setCenter(currentLocation);
        map.setZoom(14);
        showLoading(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
        addAlert(
          "warning",
          "Location Error",
          "Could not get your current location. Please enter manually.",
        );
        showLoading(false);
      },
    );
  } else {
    addAlert(
      "error",
      "Not Supported",
      "Geolocation is not supported by your browser.",
    );
    showLoading(false);
  }
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
            </select>
        `;
    document
      .getElementById("destination-input")
      .addEventListener("change", setStationDestination);
  } else {
    container.innerHTML = `<input type="text" id="destination-input" class="text-input" placeholder="Enter destination address">`;
    const newInput = document.getElementById("destination-input");
    const autocomplete = new google.maps.places.Autocomplete(newInput);
    autocomplete.bindTo("bounds", map);
    autocomplete.addListener("place_changed", () => {
      destinationPlace = autocomplete.getPlace();
      if (destinationPlace.geometry) {
        destinationLocation = destinationPlace.geometry.location;

        // Add marker
        if (destinationMarker) {
          destinationMarker.setMap(null);
        }

        destinationMarker = new google.maps.Marker({
          position: destinationLocation,
          map: map,
          title: destinationPlace.formatted_address,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: "#ef4444",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
      }
    });
  }
}

function setStationDestination() {
  const select = document.getElementById("destination-input");
  const selectedOption = select.options[select.selectedIndex];

  if (selectedOption.value) {
    const lat = parseFloat(selectedOption.dataset.lat);
    const lng = parseFloat(selectedOption.dataset.lng);
    destinationLocation = new google.maps.LatLng(lat, lng);

    // Add marker
    if (destinationMarker) {
      destinationMarker.setMap(null);
    }

    destinationMarker = new google.maps.Marker({
      position: destinationLocation,
      map: map,
      title: selectedOption.text,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: "#ef4444",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });
  }
}

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
  routes.length = 0; // Clear existing routes

  const travelMode = document.getElementById("travel-mode").value;
  const arrivalTime = document.getElementById("arrival-time").value;

  try {
    // Check if destination is a GO Transit station
    const destType = document.querySelector(
      'input[name="dest-type"]:checked',
    ).value;
    let stationsToUse = [];

    if (destType === "station") {
      // If destination is a specific station, find routes to it specifically
      const destSelect = document.getElementById("destination-input");
      if (destSelect && destSelect.selectedIndex > 0) {
        const selectedOption = destSelect.options[destSelect.selectedIndex];
        const destStation = CONFIG.GO_TRANSIT_STATIONS.find(
          (s) => s.code === selectedOption.value,
        );
        if (destStation) {
          stationsToUse = [destStation];
        }
      }
    } else {
      // For custom destinations, find 5 different stations (more variety)
      stationsToUse = findNearbyStations(currentLocation, 5);
    }

    if (stationsToUse.length === 0) {
      addAlert(
        "warning",
        "No Stations",
        "Could not find suitable GO Transit stations.",
      );
      showLoading(false);
      return;
    }

    // Find routes using all selected stations - create genuinely different options
    for (const station of stationsToUse) {
      const stationLocation = new google.maps.LatLng(station.lat, station.lng);
      const routeToStation = await getDirections(
        currentLocation,
        stationLocation,
        travelMode,
      );

      if (routeToStation) {
        // Get routes from this station to the destination
        let routeFromStation = null;

        // If destination is a custom address, get directions from station to destination
        if (destType !== "station") {
          routeFromStation = await getDirections(
            stationLocation,
            destinationLocation,
            "TRANSIT",
          );
        }

        if (routeFromStation || destType === "station") {
          // Calculate CO2 for this route
          const distance = goTransitService.parseDistance(
            routeToStation.distance,
          );
          const co2 = goTransitService.calculateCO2Savings(
            distance,
            travelMode,
          );

          // Create realistic traffic variations based on time of day
          const now = new Date();
          const hour = now.getHours();
          let baseTraffic = "low";

          // Rush hour traffic (7-9am, 5-7pm)
          if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
            baseTraffic = Math.random() > 0.5 ? "medium" : "heavy";
          } else if (hour >= 10 && hour <= 16) {
            baseTraffic = "low";
          } else {
            baseTraffic = "low";
          }

          // Get bus times for this specific station
          const allBusTimes = getBusSchedule(station.name);
          const busTimes = allBusTimes.slice(0, 3); // Get 3 different bus times

          // For each bus time, create one route option (not multiple variations)
          for (const busTime of busTimes) {
            const totalDuration =
              routeToStation.duration + (routeFromStation?.duration || 0) + 5;

            routes.push({
              toStation: routeToStation,
              fromStation: routeFromStation,
              goTransitData: null,
              station: station,
              busTime: busTime,
              travelMode: travelMode,
              totalDuration: totalDuration,
              summary: `${travelMode} to ${station.name} (${routeToStation.distance}) • Bus at ${busTime}`,
              co2: co2,
              traffic: baseTraffic,
            });
          }
        }
      }
    }

    if (routes.length > 0) {
      // Sort by total duration (fastest first)
      routes.sort((a, b) => a.totalDuration - b.totalDuration);

      // Remove duplicates (same station, same bus time)
      const uniqueRoutes = [];
      const seen = new Set();

      for (const route of routes) {
        const key = `${route.station.code}-${route.busTime}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueRoutes.push(route);
        }
      }

      // Keep only top 8 unique routes
      routes.length = 0;
      routes.push(...uniqueRoutes.slice(0, 8));

      displayRoutes();
      updateBusSchedule();

      // Update lifetime stats
      const timeSaved = calculateTimeSaved(routes[0]);
      lifetimeStats.timeSaved += timeSaved;
      lifetimeStats.co2Saved += routes[0].co2;
      saveStats();
      updateStatsDisplay();

      // Get AI insights
      if (geminiAssistant) {
        getAIRouteInsights();
      }
    } else {
      addAlert(
        "warning",
        "No Routes Found",
        "Could not find suitable routes. Try different options.",
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
  // Estimate time saved vs driving directly
  // Simplified calculation: assume GO Transit is 20% faster than driving in traffic
  return Math.floor(route.totalDuration * 0.2);
}

function findNearbyStations(location, limit = 3) {
  return CONFIG.GO_TRANSIT_STATIONS.map((station) => ({
    ...station,
    location: new google.maps.LatLng(station.lat, station.lng),
    distance: google.maps.geometry.spherical.computeDistanceBetween(
      location,
      new google.maps.LatLng(station.lat, station.lng),
    ),
  }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function getDirections(origin, destination, travelMode) {
  return new Promise((resolve, reject) => {
    directionsService.route(
      {
        origin: origin,
        destination: destination,
        travelMode: google.maps.TravelMode[travelMode],
        transitOptions: {
          modes: [google.maps.TransitMode.BUS],
          routingPreference: google.maps.TransitRoutePreference.FEWER_TRANSFERS,
        },
      },
      (result, status) => {
        if (status === "OK") {
          const route = result.routes[0].legs[0];
          resolve({
            duration: Math.ceil(route.duration.value / 60), // minutes
            distance: route.distance.text,
            steps: route.steps,
            directionResult: result,
          });
        } else {
          resolve(null);
        }
      },
    );
  });
}

function getBusSchedule(stationName) {
  // Find route for this station (simplified - in real app, match by station)
  const routes = CONFIG.GO_BUS_ROUTES && Object.values(CONFIG.GO_BUS_ROUTES);

  if (!routes || routes.length === 0) {
    // Return default schedule if no routes configured
    const defaultSchedule = [
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
    ];
    const currentTime = new Date().getHours() * 60 + new Date().getMinutes();
    return defaultSchedule.filter((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      const busTime = hours * 60 + minutes;
      return busTime > currentTime;
    });
  }

  const route = routes[0];
  const now = new Date();
  const day = now.getDay();

  let schedule;
  if (day === 0) {
    schedule = route.sundaySchedule;
  } else if (day === 6) {
    schedule = route.saturdaySchedule;
  } else {
    schedule = route.weekdaySchedule;
  }

  const currentTime = now.getHours() * 60 + now.getMinutes();

  return schedule.filter((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    const busTime = hours * 60 + minutes;
    return busTime > currentTime;
  });
}

async function loadServiceUpdates() {
  try {
    // Only try to load service updates if the API is available
    // The GO Transit API may not support CORS, so we gracefully handle failures
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
    // Silently handle CORS and network errors - service updates are optional
    console.warn(
      "Service updates unavailable (CORS or network issue):",
      error.message,
    );
  }
}

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
                ${isZeroCO2 ? '<div class="route-badge" style="background: var(--accent-green);">🌱 Zero Carbon</div>' : ""}
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
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
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
                ${index === activeRouteIndex && isNavigating ? "✓ Navigating..." : "🚀 Start Route"}
            </button>
        </div>
    `;
    })
    .join("");

  // Add click handlers
  container.querySelectorAll(".route-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (!e.target.classList.contains("route-start-button")) {
        selectRoute(parseInt(card.dataset.index));
      }
    });
  });

  // Select first route by default
  selectRoute(0);
}

function startRoute(index) {
  isNavigating = true;
  selectRoute(index);

  const route = routes[index];

  // Show complete route on map with proper navigation
  if (route.toStation && route.toStation.directionResult) {
    directionsRenderer.setDirections(route.toStation.directionResult);

    // Style the route prominently
    directionsRenderer.setOptions({
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: "#3b82f6",
        strokeWeight: 5,
        strokeOpacity: 0.9,
      },
    });

    // Fit map to show the entire route
    if (route.toStation.directionResult.routes.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      const legs = route.toStation.directionResult.routes[0].legs;

      legs.forEach((leg) => {
        leg.steps.forEach((step) => {
          bounds.extend(step.start_location);
          bounds.extend(step.end_location);
        });
      });

      map.fitBounds(bounds, { padding: 100 });
    }
  }

  // Update button state
  document.querySelectorAll(".route-start-button").forEach((btn, i) => {
    if (i === index) {
      btn.classList.add("navigating");
      btn.innerHTML = "✓ Navigating...";
    } else {
      btn.classList.remove("navigating");
      btn.innerHTML = "🚀 Start Route";
    }
  });

  // Get navigation details
  let stepCount = 0;
  if (route.toStation && route.toStation.steps) {
    stepCount = route.toStation.steps.length;
  }

  const travelMode =
    route.travelMode.charAt(0).toUpperCase() +
    route.travelMode.slice(1).toLowerCase();
  const stationName = route.station.name;
  const busTime = route.busTime;
  const duration = route.totalDuration;

  let alertMessage = `${travelMode} to ${stationName} • Depart at ${busTime} • Duration: ${duration} min`;

  if (stepCount > 0) {
    alertMessage = `Follow ${stepCount} steps to ${stationName}. Route highlighted on map.`;
  }

  addAlert("info", "🚀 Navigation Active", alertMessage);
}

function selectRoute(index) {
  activeRouteIndex = index;
  const route = routes[index];

  // Update UI
  document.querySelectorAll(".route-card").forEach((card, i) => {
    card.classList.toggle("active", i === index);
  });

  // Show route on map
  directionsRenderer.setDirections(route.toStation.directionResult);

  // Update bus schedule for this route
  currentBusSchedule = getBusSchedule(route.station.name);
  displayBusSchedule();

  // Calculate when to leave
  calculateLeaveTime(route);

  // Update stats
  lifetimeStats.trips++;
  saveStats();
  updateStatsDisplay();
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
        </div>
    `,
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

  const diff = Math.floor((busTime - now) / 60000);
  return diff;
}

function calculateLeaveTime(route) {
  if (!selectedBusTime) {
    selectedBusTime = currentBusSchedule[0];
  }

  const [hours, minutes] = selectedBusTime.split(":").map(Number);
  const busTime = new Date();
  busTime.setHours(hours, minutes, 0);

  const leaveTime = new Date(
    busTime.getTime() - route.toStation.duration * 60000 - 10 * 60000,
  ); // 10 min buffer

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
    findRoutes();
  }
}

function updateBusSchedule() {
  if (routes.length > 0 && activeRouteIndex !== null) {
    currentBusSchedule = getBusSchedule(routes[activeRouteIndex].station.name);
    displayBusSchedule();
  }
}

// AI Assistant Functions
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

  if (!geminiAssistant) {
    addAIMessage(
      "assistant",
      "Please configure your Gemini API key in config.js to use the AI assistant.",
    );
    return;
  }

  // Add user message
  addAIMessage("user", message);
  input.value = "";

  // Build context - make sure everything is properly formatted
  const busScheduleArray =
    currentBusSchedule && Array.isArray(currentBusSchedule)
      ? currentBusSchedule.slice(0, 3)
      : [];

  // Build detailed route information
  let routeDetails = "";
  if (routes.length > 0) {
    routeDetails = routes
      .map((r, i) => {
        return `${i + 1}. To ${r.station.name} - ${r.travelMode} (${r.toStation.distance}) • Bus at ${r.busTime} • Duration: ${r.totalDuration} min • Traffic: ${r.traffic} • CO2: ${r.co2.toFixed(1)}kg`;
      })
      .join("\n");
  } else {
    routeDetails = "No routes found yet";
  }

  // Build traffic data summary
  let trafficData = "";
  if (routes.length > 0) {
    const trafficLevels = routes.map((r) => r.traffic);
    const heavyTraffic = trafficLevels.filter((t) => t === "heavy").length;
    const mediumTraffic = trafficLevels.filter((t) => t === "medium").length;
    const lowTraffic = trafficLevels.filter((t) => t === "low").length;

    trafficData = `Heavy: ${heavyTraffic} routes, Medium: ${mediumTraffic} routes, Low: ${lowTraffic} routes. Current hour: ${new Date().getHours()}:00. Peak hours (7-9am, 5-7pm) typically have heavier traffic.`;
  }

  const context = {
    origin: currentLocation ? "Current Location" : null,
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

  try {
    const response = await geminiAssistant.sendMessage(message, context);
    if (response && response.trim()) {
      addAIMessage("assistant", response);
    } else {
      addAIMessage(
        "assistant",
        "I received an empty response. Please try your question again.",
      );
    }
  } catch (error) {
    console.error("AI Message Error:", error);
    addAIMessage(
      "assistant",
      `I'm having trouble connecting to the AI service. Please try again. Error: ${error.message}`,
    );
  }
}

function addAIMessage(role, content) {
  const messagesContainer = document.getElementById("ai-messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `ai-message ai-message-${role}`;

  const formattedContent =
    role === "assistant" ? formatAIResponse(content) : content;

  messageDiv.innerHTML = `
        <div class="ai-avatar">${role === "user" ? "👤" : "🤖"}</div>
        <div class="ai-content">${formattedContent}</div>
    `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function getAIRouteInsights() {
  if (!geminiAssistant || routes.length === 0) return;

  const bestRoute = routes[0];
  const context = {
    origin: currentLocation ? "Your location" : "Origin",
    destination: destinationPlace?.formatted_address || "Destination",
    arrivalTime: document.getElementById("arrival-time").value,
    selectedRoute: bestRoute,
  };

  try {
    const insights = await geminiAssistant.analyzeRoute(context);
    addAIMessage("assistant", `I've analyzed your route. ${insights}`);
    toggleAIPanel();
  } catch (error) {
    console.error("AI insights error:", error);
  }
}

// Map Controls
function toggleTraffic() {
  if (trafficLayer.getMap()) {
    trafficLayer.setMap(null);
  } else {
    trafficLayer.setMap(map);
  }
}

function centerMap() {
  if (currentLocation) {
    map.setCenter(currentLocation);
    map.setZoom(14);
  }
}

// Alerts
function addAlert(type, title, message) {
  const container = document.getElementById("alerts-list");
  document.getElementById("alerts-section").style.display = "block";

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `
        <div class="alert-icon">
            ${type === "warning" ? "⚠️" : type === "error" ? "❌" : "ℹ️"}
        </div>
        <div class="alert-content">
            <div class="alert-title">${title}</div>
            <div class="alert-message">${message}</div>
        </div>
    `;

  container.insertBefore(alert, container.firstChild);

  // Remove old alerts if more than 3
  while (container.children.length > 3) {
    container.removeChild(container.lastChild);
  }
}

// Stats Functions
function saveStats() {
  localStorage.setItem("gobus_trips", lifetimeStats.trips);
  localStorage.setItem("gobus_timeSaved", lifetimeStats.timeSaved);
  localStorage.setItem("gobus_co2Saved", lifetimeStats.co2Saved);
  localStorage.setItem("gobus_reroutes", lifetimeStats.reroutes);
}

function updateStatsDisplay() {
  document.getElementById("stat-trips").textContent = lifetimeStats.trips;
  document.getElementById("stat-time").textContent = lifetimeStats.timeSaved;
  document.getElementById("stat-co2").textContent =
    lifetimeStats.co2Saved.toFixed(1);
  document.getElementById("stat-reroutes").textContent = lifetimeStats.reroutes;

  // Animate numbers
  animateValue("stat-trips", 0, lifetimeStats.trips, 1000);
  animateValue("stat-time", 0, lifetimeStats.timeSaved, 1000);
  animateValue("stat-co2", 0, lifetimeStats.co2Saved, 1000, true);
}

function animateValue(id, start, end, duration, isDecimal = false) {
  const element = document.getElementById(id);
  const range = end - start;
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

// Loading overlay
function showLoading(show) {
  document.getElementById("loading-overlay").classList.toggle("active", show);
}

// Map styles (dark theme)
function getMapStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#cbd5e1" }] },
    {
      featureType: "administrative.locality",
      elementType: "labels.text.fill",
      stylers: [{ color: "#f1f5f9" }],
    },
    {
      featureType: "poi",
      elementType: "labels.text.fill",
      stylers: [{ color: "#94a3b8" }],
    },
    {
      featureType: "poi.park",
      elementType: "geometry",
      stylers: [{ color: "#1e3a28" }],
    },
    {
      featureType: "poi.park",
      elementType: "labels.text.fill",
      stylers: [{ color: "#6b9575" }],
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#334155" }],
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#1e293b" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#475569" }],
    },
    {
      featureType: "transit",
      elementType: "geometry",
      stylers: [{ color: "#1e3a5f" }],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#0c1929" }],
    },
    {
      featureType: "water",
      elementType: "labels.text.fill",
      stylers: [{ color: "#64748b" }],
    },
  ];
}
