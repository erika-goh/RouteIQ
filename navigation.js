// RouteIQ — foreground live navigation ("Navigate" mode).
//
// Google-Maps-style follow-along while the app is open: streams the device's
// GPS (watchPosition), keeps the map centred on you with a moving marker, gives
// turn-by-turn for the access leg (walk/drive/bike to the station) from the OSRM
// steps already fetched, keeps the screen awake, and fires arrival alerts as you
// approach the boarding stop and your destination.
//
// Honest limits (see chat): browsers suspend geolocation when the tab is
// backgrounded / screen locks, so this is foreground-only — not background nav.
// True "get off at your stop" transit guidance needs the GTFS/OTP backend +
// realtime vehicle positions (Phase 2); on the bus leg we can only follow the
// line and warn near the destination.
//
// Uses app.js globals: map, L, routes, destinationLocation, destinationPlace,
// addAlert, selectedBusTime, isNavigating, ICONS.
const Navigation = (() => {
  let watchId = null;
  let navMarker = null;
  let accuracyCircle = null;
  let wakeLock = null;
  let banner = null;
  let steps = [];
  let stepIdx = 0;
  let route = null;
  let atStation = false;

  const STEP_ADVANCE_M = 25; // within this of a maneuver → advance to the next
  const NEAR_STOP_M = 130; // "you're at the stop" threshold
  const NEAR_DEST_M = 130; // "you've arrived" threshold

  function fmtDist(m) {
    if (m == null) return "";
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  }

  // Turn an OSRM maneuver into a short human instruction.
  function describeStep(step) {
    const m = step && step.maneuver;
    if (!m) return "Continue";
    const road = step.name && step.name.trim() ? ` onto ${step.name}` : "";
    const mod = m.modifier ? m.modifier.replace(/^\w/, (c) => c) : "";
    switch (m.type) {
      case "depart": return `Head out${step.name ? ` on ${step.name}` : ""}`;
      case "arrive": return "Arrive at your stop";
      case "roundabout":
      case "rotary": return `Take the roundabout${road}`;
      case "merge": return `Merge${mod ? " " + mod : ""}${road}`;
      case "on ramp": return `Take the ramp${road}`;
      case "off ramp": return `Take the exit${road}`;
      case "fork": return `Keep ${mod || "straight"}${road}`;
      case "end of road": return `Turn ${mod || "ahead"}${road}`;
      case "continue":
      case "new name": return `Continue${mod && mod !== "straight" ? " " + mod : ""}${road}`;
      case "turn":
      default: return `Turn ${mod || "ahead"}${road}`;
    }
  }

  function maneuverLatLng(step) {
    const loc = step && step.maneuver && step.maneuver.location; // [lng, lat]
    return loc ? L.latLng(loc[1], loc[0]) : null;
  }

  function buildBanner() {
    const host = document.querySelector(".map-container") || document.body;
    banner = document.createElement("div");
    banner.className = "nav-banner";
    banner.innerHTML = `
      <div class="nav-banner-main">
        <div class="nav-banner-icon" id="nav-icon">${ICONS.info}</div>
        <div class="nav-banner-text">
          <div class="nav-instruction" id="nav-instruction">Starting navigation…</div>
          <div class="nav-sub" id="nav-sub">Waiting for GPS…</div>
        </div>
      </div>
      <button class="nav-stop-btn" id="nav-stop" type="button">End</button>`;
    host.appendChild(banner);
    banner.querySelector("#nav-stop").addEventListener("click", stop);
  }

  function setBanner(instruction, sub) {
    if (!banner) return;
    const i = banner.querySelector("#nav-instruction");
    const s = banner.querySelector("#nav-sub");
    if (i && instruction != null) i.textContent = instruction;
    if (s && sub != null) s.textContent = sub;
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      /* non-fatal: screen may sleep */
    }
  }

  function onVisibility() {
    // Re-acquire the wake lock when the tab becomes visible again.
    if (document.visibilityState === "visible" && watchId != null && !wakeLock) requestWakeLock();
  }

  async function start(r) {
    if (!("geolocation" in navigator)) {
      addAlert("warning", "No GPS", "This device can't share its location, so live navigation isn't available.");
      return;
    }
    if (watchId != null) stop(); // restart cleanly

    route = r;
    steps = (r.toStation && r.toStation.steps) || [];
    stepIdx = 0;
    atStation = false;
    isNavigating = true;

    if (!banner) buildBanner();
    setBanner("Starting navigation…", "Waiting for GPS…");
    await requestWakeLock();
    document.addEventListener("visibilitychange", onVisibility);

    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });
  }

  function onPosition(pos) {
    const here = L.latLng(pos.coords.latitude, pos.coords.longitude);

    // Moving marker + accuracy halo, map follows.
    if (!navMarker) {
      navMarker = L.circleMarker(here, {
        radius: 9, color: "#0b0d14", weight: 3, fillColor: "#7c74ff", fillOpacity: 1,
      }).addTo(map);
      accuracyCircle = L.circle(here, { radius: pos.coords.accuracy || 30, color: "#7c74ff", weight: 1, fillColor: "#7c74ff", fillOpacity: 0.08 }).addTo(map);
    } else {
      navMarker.setLatLng(here);
      accuracyCircle.setLatLng(here).setRadius(pos.coords.accuracy || 30);
    }
    map.setView(here, Math.max(map.getZoom(), 16), { animate: true });

    // Turn-by-turn for the access leg: advance past maneuvers we've reached.
    if (steps.length) {
      while (stepIdx < steps.length - 1) {
        const loc = maneuverLatLng(steps[stepIdx]);
        if (loc && here.distanceTo(loc) < STEP_ADVANCE_M) stepIdx++;
        else break;
      }
      const step = steps[stepIdx];
      const loc = maneuverLatLng(step);
      const d = loc ? here.distanceTo(loc) : null;
      setBanner(describeStep(step), d != null ? `${fmtDist(d)} • to ${route.station.name}` : `to ${route.station.name}`);
    } else if (route.station) {
      const d = here.distanceTo(L.latLng(route.station.lat, route.station.lng));
      setBanner(`Head to ${route.station.name}`, `${fmtDist(d)} away`);
    }

    // Approaching the boarding stop.
    if (route.station) {
      const dStop = here.distanceTo(L.latLng(route.station.lat, route.station.lng));
      if (dStop < NEAR_STOP_M && !atStation) {
        atStation = true;
        const bus = (typeof selectedBusTime !== "undefined" && selectedBusTime) || route.busTime;
        addAlert("info", "You're at your stop", `${route.station.name} — your bus is the ${bus}. Watch the platform for real-time updates.`);
        setBanner(`You're at ${route.station.name}`, `Catch the ${bus} bus`);
      }
    }

    // Approaching the final destination.
    if (destinationLocation) {
      const dDest = here.distanceTo(destinationLocation);
      if (dDest < NEAR_DEST_M) {
        const name = (typeof destinationPlace !== "undefined" && destinationPlace?.formatted_address) || "your destination";
        addAlert("info", "You've arrived", `You're near ${name}. Trip complete!`);
        setBanner("You've arrived", name);
        stop();
      }
    }
  }

  function onError(err) {
    if (err && err.code === 1) {
      // PERMISSION_DENIED
      addAlert("warning", "Location blocked", "Allow location access to navigate. You can still follow the route on the map.");
      stop();
    } else {
      setBanner(null, "GPS signal weak — trying again…");
    }
  }

  function stop() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    document.removeEventListener("visibilitychange", onVisibility);
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    if (navMarker) { navMarker.remove(); navMarker = null; }
    if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }
    if (banner) { banner.remove(); banner = null; }
    isNavigating = false;
    // Reset any "Navigating…" buttons.
    document.querySelectorAll(".route-start-button.navigating").forEach((btn) => {
      btn.classList.remove("navigating");
      btn.innerHTML = "Start Route →";
    });
  }

  return { start, stop, active: () => watchId != null };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Navigation };
}
