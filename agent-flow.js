// RouteIQ — conversational trip picker (Phase 1).
//
// When the assistant identifies a trip ("from X to Y"), instead of silently
// auto-filling the form we walk the user through an in-chat picker:
//   1. pick a GO stop near the origin (or use the address / current location)
//   2. pick a GO stop near the destination (or use the address)
//   3. choose when to leave
// Each choice updates the left sidebar; then we run the search and tell the
// user when to leave to catch their bus. Real multi-agency bus itineraries
// (GO -> VIVA transfers) arrive with the OTP backend (see otp/ROUTING.md) — this
// layer is the UX + honest grounding on the data we have today.
//
// Relies on globals from app.js: applyOrigin, applyDestination, findRoutes,
// findNearbyStations, geocodeAddress, addAIMessage, addAlert, calculateLeaveTime,
// loadServiceUpdates, routes, currentLocation, destinationLocation, CONFIG, L, map.

let tripPicker = null;
let alertPoller = null;

// ---- chat rendering helpers ------------------------------------------------

// Append an assistant bubble that contains text plus a row of choice chips.
// chips: [{ label, sub?, onClick }]. Labels/subs are set via textContent, so
// user/place text can never inject markup.
function renderAssistantChips(text, chips) {
  const messages = document.getElementById("ai-messages");
  if (!messages) return;

  const wrap = document.createElement("div");
  wrap.className = "ai-message ai-message-assistant";

  const avatar = document.createElement("div");
  avatar.className = "ai-avatar";
  avatar.innerHTML = ICONS.ai; // trusted constant

  const content = document.createElement("div");
  content.className = "ai-content";
  if (text) {
    const p = document.createElement("div");
    p.textContent = text;
    content.appendChild(p);
  }

  if (chips && chips.length) {
    const row = document.createElement("div");
    row.className = "ai-chips";
    chips.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-chip";
      const main = document.createElement("span");
      main.className = "ai-chip-main";
      main.textContent = c.label;
      btn.appendChild(main);
      if (c.sub) {
        const sub = document.createElement("span");
        sub.className = "ai-chip-sub";
        sub.textContent = c.sub;
        btn.appendChild(sub);
      }
      btn.addEventListener("click", () => {
        // Freeze this chip row once a choice is made, so the transcript reads cleanly.
        row.querySelectorAll(".ai-chip").forEach((b) => (b.disabled = true));
        btn.classList.add("ai-chip-chosen");
        c.onClick();
      });
      row.appendChild(btn);
    });
    content.appendChild(row);
  }

  wrap.append(avatar, content);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

// Show/refresh a compact From -> To -> Leave summary at the top of the sidebar
// planner, so the left panel reflects what the chat has gathered.
function updateTripSummary() {
  const section = document.querySelector(".sidebar .section:nth-of-type(3)"); // Plan Your Trip
  const planTitle = [...document.querySelectorAll(".section-title")].find(
    (h) => /plan your trip/i.test(h.textContent),
  );
  const host = planTitle ? planTitle.parentElement : section;
  if (!host) return;

  let box = document.getElementById("trip-summary");
  if (!box) {
    box = document.createElement("div");
    box.id = "trip-summary";
    box.className = "trip-summary";
    planTitle ? planTitle.after(box) : host.prepend(box);
  }

  const rows = [];
  if (tripPicker?.origin?.label)
    rows.push(["From", tripPicker.origin.label]);
  if (tripPicker?.destination?.label)
    rows.push(["To", tripPicker.destination.label]);
  if (tripPicker?.departAt) rows.push(["Leave", tripPicker.departAt]);

  box.innerHTML = "";
  if (!rows.length) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  rows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "trip-summary-row";
    const key = document.createElement("span");
    key.className = "trip-summary-key";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "trip-summary-val";
    val.textContent = v;
    row.append(key, val);
    box.appendChild(row);
  });
}

// ---- the flow --------------------------------------------------------------

async function beginTripPicker(action) {
  tripPicker = {
    origin: null,
    destination: null,
    departAt: null,
    originText: action?.origin?.value || null,
    destText: action?.destination?.value || null,
    originKind: action?.origin?.kind || null,
    destKind: action?.destination?.kind || null,
  };
  await pickOrigin();
}

// Resolve a place text to coordinates for "nearby stop" suggestions.
async function resolvePlace(kind, text) {
  if (kind === "current") {
    const loc = currentLocation || (await getCurrentLocationAsync());
    return loc ? { latlng: loc, label: "Current location" } : null;
  }
  if (kind === "station") {
    const st = CONFIG.GO_TRANSIT_STATIONS.find((s) => s.code === text);
    if (st) return { latlng: L.latLng(st.lat, st.lng), label: st.name, station: st };
  }
  if (text) {
    const g = await geocodeAddress(text);
    if (g) return { latlng: L.latLng(g.lat, g.lng), label: g.label };
  }
  return null;
}

function stopChips(latlng, onStation) {
  return findNearbyStations(latlng, 4).map((st) => ({
    label: st.name,
    sub: `${(st.distance / 1000).toFixed(1)} km away`,
    onClick: () => onStation(st),
  }));
}

async function pickOrigin() {
  const place = tripPicker.originKind
    ? await resolvePlace(tripPicker.originKind, tripPicker.originText)
    : null;

  // If the origin is already an explicit GO station, take it as-is.
  if (place?.station) {
    await chooseOrigin({ kind: "station", value: place.station.code, label: place.station.name });
    return;
  }

  const chips = [];
  if (place?.latlng) {
    chips.push(
      ...stopChips(place.latlng, (st) =>
        chooseOrigin({ kind: "station", value: st.code, label: st.name }),
      ),
    );
    if (tripPicker.originText) {
      chips.push({
        label: `Use "${place.label}" directly`,
        sub: "custom origin address",
        onClick: () =>
          chooseOrigin({ kind: "custom", value: tripPicker.originText, label: place.label }),
      });
    }
  }
  chips.push({
    label: "Use my current location",
    onClick: () => chooseOrigin({ kind: "current", value: "", label: "Current location" }),
  });

  const where = place?.label ? ` near ${place.label}` : "";
  renderAssistantChips(
    `Where are you starting from? Pick a GO stop${where}, or use your address.`,
    chips,
  );
}

async function chooseOrigin(choice) {
  await applyOrigin({ kind: choice.kind, value: choice.value });
  tripPicker.origin = choice;
  updateTripSummary();
  addAIMessage("assistant", `Origin set: ${choice.label}. Now your destination.`);
  await pickDestination();
}

async function pickDestination() {
  const place = tripPicker.destKind
    ? await resolvePlace(tripPicker.destKind, tripPicker.destText)
    : null;

  if (place?.station) {
    await chooseDestination({ kind: "station", value: place.station.code, label: place.station.name });
    return;
  }

  const chips = [];
  if (place?.latlng) {
    chips.push(
      ...stopChips(place.latlng, (st) =>
        chooseDestination({ kind: "station", value: st.code, label: st.name }),
      ),
    );
    if (tripPicker.destText) {
      chips.push({
        label: `Use "${place.label}" directly`,
        sub: "custom destination address",
        onClick: () =>
          chooseDestination({ kind: "custom", value: tripPicker.destText, label: place.label }),
      });
    }
  }

  if (!chips.length) {
    addAIMessage(
      "assistant",
      "Where are you heading? Tell me an address or a GO station.",
    );
    return;
  }

  const where = place?.label ? ` near ${place.label}` : "";
  renderAssistantChips(
    `Which stop${where} for your destination? Or use the address directly.`,
    chips,
  );
}

async function chooseDestination(choice) {
  await applyDestination({ kind: choice.kind, value: choice.value });
  tripPicker.destination = choice;
  updateTripSummary();
  addAIMessage("assistant", `Destination set: ${choice.label}. When do you want to leave?`);
  askDepartureTime();
}

function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function askDepartureTime() {
  const now = new Date();
  const plus = (min) => {
    const d = new Date(now.getTime() + min * 60000);
    return fmtTime(d);
  };
  const chips = [
    { label: "Leave now", onClick: () => chooseDeparture(fmtTime(now)) },
    { label: "In 30 min", sub: plus(30), onClick: () => chooseDeparture(plus(30)) },
    { label: "In 1 hour", sub: plus(60), onClick: () => chooseDeparture(plus(60)) },
    { label: "Pick a time…", onClick: promptCustomTime },
  ];
  renderAssistantChips("When do you want to leave?", chips);
}

function promptCustomTime() {
  const messages = document.getElementById("ai-messages");
  const wrap = document.createElement("div");
  wrap.className = "ai-message ai-message-assistant";
  wrap.innerHTML = `<div class="ai-avatar">${ICONS.ai}</div>`;
  const content = document.createElement("div");
  content.className = "ai-content";
  const input = document.createElement("input");
  input.type = "time";
  input.className = "ai-time-input";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "ai-chip";
  go.textContent = "Set";
  go.addEventListener("click", () => {
    if (input.value) chooseDeparture(input.value);
  });
  content.append(input, go);
  wrap.appendChild(content);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  input.focus();
}

async function chooseDeparture(hhmm) {
  tripPicker.departAt = hhmm;
  // Reflect the leave time in the sidebar planner (Arrival field is the closest
  // existing field; we label the summary "Leave" so it's unambiguous).
  updateTripSummary();
  addAIMessage("assistant", `Great — searching trips leaving around ${hhmm}…`);
  await runTripSearch();
}

/* ---- catch-the-bus feasibility ---- */
const toMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const fmtMin = (min) => {
  const m = ((min % 1440) + 1440) % 1440; // wrap into a single day
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const BOARD_BUFFER = 5; // minutes of slack to walk up and board

// Assess a route against the clock: which departure the user actually asked for,
// which one they can physically reach (access time + buffer), and the estimated
// arrival. Access time (origin -> boarding stop) is real OSRM data; the on-vehicle
// time is a Phase-1 estimate until the OTP routing engine is wired in.
function assessRoute(route, desiredLeaveHHMM) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const accessMin = Math.ceil(route.toStation?.duration || 0);
  const earliestBoardMin = nowMin + accessMin + BOARD_BUFFER;
  const sched = Array.isArray(route.schedule) ? route.schedule : [];

  const leaveTargetMin = desiredLeaveHHMM ? toMin(desiredLeaveHHMM) : nowMin;
  const requested = sched.find((t) => toMin(t) >= leaveTargetMin) || null;
  const catchable = sched.find((t) => toMin(t) >= earliestBoardMin) || null;
  const onVehicleMin = Math.ceil(route.fromStation?.duration || 0);
  const arriveMin = catchable ? toMin(catchable) + onVehicleMin : null;

  return {
    accessMin,
    earliestBoardMin,
    requested,
    catchable,
    arriveMin,
    missedRequested: !!(requested && toMin(requested) < earliestBoardMin),
  };
}

async function runTripSearch() {
  await findRoutes();

  if (!routes.length) {
    addAIMessage(
      "assistant",
      "I couldn't find GO options for that trip yet. You can adjust the stops or time on the left, or try nearby stations.",
    );
    return;
  }

  const desiredArrival = document.getElementById("arrival-time")?.value || null;

  // Prefer the fastest route the user can actually catch (routes are duration-sorted).
  const assessed = routes.map((r) => ({ route: r, a: assessRoute(r, tripPicker.departAt) }));
  const catchableOnes = assessed.filter((x) => x.a.catchable);

  if (!catchableOnes.length) {
    addAIMessage(
      "assistant",
      "⚠️ There are no departures you can still reach today from those stops — the last catchable bus has already gone. Try a closer stop, driving instead, or plan for tomorrow.",
    );
    addAlert(
      "warning",
      "No catchable bus",
      "You can't reach the stop before the remaining departures. Try a closer stop or drive.",
    );
    startAlertPolling();
    return;
  }

  // On-time preferred; otherwise the soonest-arriving catchable option.
  const onTime = desiredArrival
    ? catchableOnes.filter((x) => x.a.arriveMin != null && x.a.arriveMin <= toMin(desiredArrival))
    : [];
  const pick = (onTime[0] || catchableOnes.sort((p, q) => (p.a.arriveMin ?? 9e9) - (q.a.arriveMin ?? 9e9))[0]);
  const best = pick.route;
  const a = pick.a;

  // Surface the chosen option as the active route so the sidebar/leave-by match.
  const bestIndex = routes.indexOf(best);
  if (bestIndex > 0 && typeof selectRoute === "function") selectRoute(bestIndex);

  selectedBusTime = a.catchable; // used by calculateLeaveTime()
  if (typeof calculateLeaveTime === "function") calculateLeaveTime(best); // "Leave by …" alert

  const liveNote = best.isLive ? " (live)" : "";
  addAIMessage(
    "assistant",
    `Best option you can catch: ${best.travelMode.toLowerCase()} to ${best.station.name}, ` +
      `bus at ${a.catchable}${liveNote}. Check the sidebar for when to leave.`,
  );

  // Missed the bus they wanted?
  if (a.missedRequested) {
    addAIMessage(
      "assistant",
      `Heads up — you can't make the ${a.requested} bus (it leaves before you can reach the stop). The next one you can catch is ${a.catchable}.`,
    );
    addAlert(
      "warning",
      "Missed that bus",
      `Can't reach the stop for the ${a.requested} departure — next catchable is ${a.catchable}.`,
    );
  }

  // Arriving later than the desired time?
  if (desiredArrival && a.arriveMin != null && a.arriveMin > toMin(desiredArrival)) {
    const faster = assessed.find(
      (x) => x !== pick && x.a.catchable && x.a.arriveMin != null && x.a.arriveMin <= toMin(desiredArrival),
    );
    const suggestion = faster
      ? ` A faster option: ${faster.route.travelMode.toLowerCase()} to ${faster.route.station.name} (bus ${faster.a.catchable}) gets you there by ~${fmtMin(faster.a.arriveMin)}.`
      : " Try driving to the stop for a faster connection, or an earlier departure.";
    addAIMessage(
      "assistant",
      `⚠️ Catching the ${a.catchable} bus gets you in around ${fmtMin(a.arriveMin)}, later than your ${desiredArrival} target.${suggestion}`,
    );
    addAlert(
      "warning",
      "Arriving late",
      `Est. arrival ~${fmtMin(a.arriveMin)} is after your ${desiredArrival} target.`,
    );
  }

  // Route-tailored alerts already loaded via selectRoute(); keep them fresh so
  // delays/cancellations for THIS route surface while the trip is open.
  startAlertPolling();
}

// Re-check the active route's alerts every 60s so cancellations / delays for the
// chosen route surface live. Cleared when a new search starts.
function startAlertPolling() {
  if (alertPoller) clearInterval(alertPoller);
  alertPoller = setInterval(() => {
    if (typeof refreshActiveRouteAlerts === "function") refreshActiveRouteAlerts();
  }, 60000);
}
