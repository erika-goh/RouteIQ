// Group trip / "meet in the middle".
//
// Each person gets their own location bar (with autocomplete); "+ Add friend"
// adds more. Given everyone's location — and, optionally, where the group is
// ultimately heading (e.g. Hamilton) — it finds the GO stop that is fairest for
// the whole group AND on the way to that destination.
//
// Also exposes GroupTrip.tryHandle(message): the AI assistant calls this so a
// sentence like "I want to meet friend 1 and friend 2, they live in Oakville
// and Burlington, find a spot near the bus stop to go to Hamilton" sets the
// whole thing up and runs it.
//
// Reuses app.js globals: getDirections, map, L, attachAutocomplete,
// geocodeAddress, findNearbyStations, CONFIG, showLoading, addAlert,
// addAIMessage, goTransitService, UI_ICONS.
const GroupTrip = (() => {
  let friends = []; // { id, name, place: {label,lat,lng}|null, rawText: string }
  let destPlace = null; // resolved final destination (optional)
  let groupLayer = null;
  let seq = 0;
  const MAX = 6;

  const el = (id) => document.getElementById(id);
  const hav = (aLat, aLng, bLat, bLng) =>
    goTransitService.calculateHaversineDistance(aLat, aLng, bLat, bLng);

  function defaultName(i) {
    return i === 0 ? "You" : `Friend ${i}`;
  }

  function ensureMinimum() {
    while (friends.length < 2) {
      friends.push({ id: ++seq, name: defaultName(friends.length), place: null, rawText: "" });
    }
  }

  function resolvedCount() {
    return friends.filter((f) => f.place || f.rawText.trim()).length;
  }

  function updateFindState() {
    const btn = el("group-find");
    if (btn) btn.disabled = resolvedCount() < 2;
    const hint = el("group-hint");
    if (hint) {
      hint.textContent =
        resolvedCount() < 2
          ? "Add at least 2 people's locations to find a meeting spot."
          : `${resolvedCount()} people added — find a fair meeting spot.`;
    }
  }

  // Rebuild the friend rows from state (restoring typed values), re-binding
  // autocomplete to each input.
  function renderFriends() {
    const host = el("group-friends");
    if (!host) return;
    host.innerHTML = "";

    friends.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "friend-row";

      const tag = document.createElement("span");
      tag.className = "friend-tag";
      tag.textContent = f.name;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "text-input friend-input";
      input.placeholder = i === 0 ? "Your location" : `${f.name}'s location`;
      input.value = f.place ? f.place.label : f.rawText;

      // Typing invalidates a previously-picked place; store the raw text.
      input.addEventListener("input", () => {
        f.rawText = input.value;
        f.place = null;
        updateFindState();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "friend-remove";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.disabled = friends.length <= 2;
      remove.addEventListener("click", () => {
        friends = friends.filter((x) => x.id !== f.id);
        // Re-label the default names so they stay sequential.
        friends.forEach((x, idx) => {
          if (/^(You|Friend \d+)$/.test(x.name)) x.name = defaultName(idx);
        });
        renderFriends();
        updateFindState();
      });

      row.append(tag, input, remove);
      host.appendChild(row);

      attachAutocomplete(input, (place) => {
        f.place = { label: place.formatted_address, lat: place.lat, lng: place.lng };
        f.rawText = place.formatted_address;
        updateFindState();
      });
    });

    const addBtn = el("group-add");
    if (addBtn) addBtn.disabled = friends.length >= MAX;
  }

  // Clear the group panel back to a fresh state: two empty rows, no
  // destination/results, and the meeting markers removed from the map. Scoped to
  // the group trip only — it leaves the main planner's route untouched.
  function reset() {
    clearLayer();
    destPlace = null;
    friends = [];
    ensureMinimum();
    renderFriends();

    const di = el("group-dest-input");
    if (di) di.value = "";
    const gm = el("group-mode");
    if (gm) gm.value = "TRANSIT";

    const results = el("group-results");
    if (results) {
      results.style.display = "none";
      results.innerHTML = "";
    }
    updateFindState();
  }

  function addFriend() {
    if (friends.length >= MAX) {
      addAlert("info", "Group Full", `You can add up to ${MAX} people.`);
      return;
    }
    friends.push({ id: ++seq, name: defaultName(friends.length), place: null, rawText: "" });
    renderFriends();
    updateFindState();
  }

  function clearLayer() {
    if (groupLayer) {
      groupLayer.remove();
      groupLayer = null;
    }
  }

  // Resolve every friend row (geocoding any typed-but-not-picked text) into
  // {label,lat,lng} points. Returns only the ones that resolved.
  async function resolvePeople() {
    const out = [];
    for (const f of friends) {
      if (f.place) {
        out.push(f.place);
        continue;
      }
      const text = f.rawText.trim();
      if (!text) continue;
      const g = await geocodeAddress(text);
      if (g) {
        f.place = { label: g.label, lat: g.lat, lng: g.lng };
        out.push(f.place);
      }
    }
    return out;
  }

  async function resolveDest() {
    const text = (el("group-dest-input")?.value || "").trim();
    if (!text) {
      destPlace = null;
      return null;
    }
    // Prefer a GO station match, else geocode the place.
    const st = matchStationByName(text);
    if (st) {
      destPlace = { label: st.name, lat: st.lat, lng: st.lng };
      return destPlace;
    }
    const g = await geocodeAddress(text.match(/,/) ? text : `${text}, Ontario`);
    destPlace = g ? { label: g.label, lat: g.lat, lng: g.lng } : null;
    return destPlace;
  }

  // Rank meeting stations: fair for the group (worst single commute) and, when a
  // destination is given, biased toward stops on the way there.
  async function find(announceInChat = false) {
    const people = await resolvePeople();
    if (people.length < 2) {
      addAlert("warning", "Need 2+ locations", "Add at least two valid locations.");
      updateFindState();
      return;
    }
    renderFriends(); // reflect any geocoded labels
    const dest = await resolveDest();
    const mode = el("group-mode")?.value || "TRANSIT";

    clearLayer();
    showLoading(true);
    try {
      const centroid = L.latLng(
        people.reduce((a, p) => a + p.lat, 0) / people.length,
        people.reduce((a, p) => a + p.lng, 0) / people.length,
      );

      // Candidate stops: nearest to the group's centre; if a destination is set,
      // keep the ones that are on the way and add the destination's own hubs.
      let candidates = findNearbyStations(centroid, 6);
      if (dest) {
        const cDist = hav(centroid.lat, centroid.lng, dest.lat, dest.lng);
        const toward = candidates.filter(
          (s) => hav(s.lat, s.lng, dest.lat, dest.lng) <= cDist + 2,
        );
        if (toward.length) candidates = toward;
        findNearbyStations(L.latLng(dest.lat, dest.lng), 2).forEach((s) => {
          if (!candidates.some((c) => c.code === s.code)) candidates.push(s);
        });
      }

      const scored = [];
      for (const station of candidates) {
        const stationLoc = L.latLng(station.lat, station.lng);
        const times = [];
        let failed = false;
        for (const p of people) {
          const r = await getDirections(L.latLng(p.lat, p.lng), stationLoc, mode);
          if (!r) {
            failed = true;
            break;
          }
          times.push(r.duration);
        }
        if (failed || !times.length) continue;
        const total = times.reduce((a, b) => a + b, 0);
        const worst = Math.max(...times);
        const onwardKm = dest ? hav(station.lat, station.lng, dest.lat, dest.lng) : 0;
        // Fairness first; nudge toward the destination when one is given.
        const score = worst + (dest ? 0.35 * onwardKm : 0);
        scored.push({ station, times, total, worst, onwardKm, score });
      }

      if (!scored.length) {
        addAlert("warning", "No Meeting Spot", "Couldn't route the group to a station. Try different locations.");
        showLoading(false);
        return;
      }

      scored.sort((a, b) => a.score - b.score || a.worst - b.worst || a.total - b.total);
      const top = scored.slice(0, 3);
      renderResults(top, people, dest);
      drawBest(top[0], people, dest);
      showLoading(false);

      if (announceInChat && typeof addAIMessage === "function") {
        const best = top[0];
        const onward = dest ? `, then it's a short hop to ${dest.label}` : "";
        addAIMessage(
          "assistant",
          `Fairest meeting spot: ${best.station.name}. Worst single commute is ${best.worst} min${onward}. See the Group Trip panel for each person's time.`,
        );
      }
    } catch (e) {
      console.error("Group trip error:", e);
      addAlert("error", "Error", "Something went wrong finding a meeting spot.");
      showLoading(false);
    }
  }

  const COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard
        .writeText(text)
        .then(() => true)
        .catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  // Build a shareable "let's meet here" message with a Google Maps link and copy
  // it to the clipboard, so it can be pasted straight into a group chat.
  function copyMeetingLocation(res, btn) {
    const { lat, lng, name } = res.station;
    const link = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const text = `Let's meet at ${name}: ${link}`;
    copyText(text).then((ok) => {
      if (ok && btn) {
        btn.classList.add("copied");
        btn.textContent = "Copied to clipboard";
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.innerHTML = `<span class="gt-copy-ic">${COPY_ICON}</span>Copy location to share`;
        }, 1800);
      } else if (!ok) {
        addAlert("info", "Copy this to share", text);
      }
    });
  }

  function renderResults(results, people, dest) {
    const wrap = el("group-results");
    wrap.style.display = "block";
    wrap.innerHTML = results
      .map((res, idx) => {
        const chips = res.times
          .map(
            (t, i) =>
              `<span class="group-person">${(people[i].label || "").split(",")[0]}: ${t}m</span>`,
          )
          .join("");
        const onward = dest
          ? `<div><span class="group-meta-label">→ ${dest.label.split(",")[0]}</span><span class="group-meta-val">~${res.onwardKm.toFixed(0)} km</span></div>`
          : "";
        return `<div class="route-card ${idx === 0 ? "active" : ""}" data-i="${idx}">
          <div class="route-header">
            <div class="route-title"><span class="gt-ic">${UI_ICONS.pin}</span>${res.station.name.split(" GO")[0]}</div>
            ${idx === 0 ? '<div class="route-badge">Fairest</div>' : ""}
          </div>
          <div class="group-meta">
            <div title="The longest single person's trip to this stop. The fairest stop keeps this as low as possible.">
              <span class="group-meta-label">Longest trip</span><span class="group-meta-val">${res.worst} min</span>
            </div>
            <div title="Everyone's travel times added together.">
              <span class="group-meta-label">Total</span><span class="group-meta-val">${res.total} min</span>
            </div>
            ${onward}
          </div>
          <div class="group-people">${chips}</div>
          <button class="gt-copy" data-i="${idx}" type="button"><span class="gt-copy-ic">${COPY_ICON}</span>Copy location to share</button>
        </div>`;
      })
      .join("");

    wrap.querySelectorAll(".gt-copy").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyMeetingLocation(results[parseInt(btn.dataset.i)], btn);
      }),
    );
    wrap.querySelectorAll(".route-card").forEach((card) =>
      card.addEventListener("click", () => {
        const i = parseInt(card.dataset.i);
        wrap.querySelectorAll(".route-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        drawBest(results[i], people, dest);
      }),
    );
  }

  function drawBest(res, people, dest) {
    clearLayer();
    const stationLoc = [res.station.lat, res.station.lng];
    const layers = [
      // Light-purple highlight so the selected meeting spot stands out.
      L.circleMarker(stationLoc, {
        radius: 28,
        stroke: false,
        fillColor: "#9d84f0",
        fillOpacity: 0.18,
        interactive: false,
      }),
      L.circleMarker(stationLoc, {
        radius: 17,
        color: "#b9a5f5",
        weight: 2,
        opacity: 0.7,
        fillColor: "#9d84f0",
        fillOpacity: 0.12,
        interactive: false,
      }),
      // Animated pulse ring.
      L.marker(stationLoc, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "",
          html: '<div class="meet-pulse"></div>',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      }),
      // Solid meeting pin on top.
      L.circleMarker(stationLoc, {
        radius: 9,
        color: "#0b0d14",
        weight: 3,
        fillColor: "#8257e6",
        fillOpacity: 1,
      }).bindTooltip(`Meet here: ${res.station.name}`, { permanent: false }),
    ];
    people.forEach((p, i) => {
      layers.push(
        L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: "#0b0d14",
          weight: 2,
          fillColor: "#46d19e",
          fillOpacity: 1,
        }).bindTooltip(`${(p.label || "").split(",")[0]} · ${res.times[i]} min`),
      );
      layers.push(
        L.polyline([[p.lat, p.lng], stationLoc], {
          color: "#46d19e",
          weight: 2.5,
          opacity: 0.7,
          dashArray: "4 6",
        }),
      );
    });
    const bounds = [stationLoc, ...people.map((p) => [p.lat, p.lng])];
    if (dest) {
      layers.push(
        L.circleMarker([dest.lat, dest.lng], {
          radius: 7,
          color: "#0b0d14",
          weight: 3,
          fillColor: "#e0b25a",
          fillOpacity: 1,
        }).bindTooltip(`Destination: ${dest.label}`),
      );
      layers.push(
        L.polyline([stationLoc, [dest.lat, dest.lng]], {
          color: "#e0b25a",
          weight: 3,
          opacity: 0.85,
          dashArray: "2 9",
        }).bindTooltip(`GO to ${dest.label.split(",")[0]}`, { sticky: true }),
      );
      bounds.push([dest.lat, dest.lng]);
    }
    groupLayer = L.layerGroup(layers).addTo(map);
    map.fitBounds(L.latLngBounds(bounds), { padding: [60, 60] });
  }

  /* ---------------- panel helpers ---------------- */
  function openPanel() {
    const body = el("group-body");
    const toggle = el("group-toggle");
    if (body && body.style.display === "none") {
      body.style.display = "block";
      toggle && toggle.classList.add("open");
    }
    body && body.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ---------------- AI / natural-language entry ---------------- */
  // Cities/hubs we can recognise from a free-text sentence.
  function knownPlaces() {
    const set = new Set();
    (CONFIG.GO_TRANSIT_STATIONS || []).forEach((s) =>
      set.add(s.name.toLowerCase().replace(/ go.*| bus.*| terminal.*| centre.*/, "").trim()),
    );
    (CONFIG.CAMPUSES || []).forEach((c) => set.add(c.short.toLowerCase()));
    [
      "oakville", "burlington", "hamilton", "mississauga", "toronto", "milton",
      "brampton", "oshawa", "guelph", "waterloo", "kitchener", "aldershot",
      "appleby", "etobicoke", "scarborough", "markham", "richmond hill", "ajax",
      "whitby", "kingston", "london", "st catharines", "niagara", "barrie",
      "vaughan", "pickering", "north york",
    ].forEach((c) => set.add(c));
    return [...set].filter(Boolean);
  }

  function matchStationByName(text) {
    const t = text.toLowerCase();
    return (CONFIG.GO_TRANSIT_STATIONS || []).find((s) => {
      const key = s.name
        .toLowerCase()
        .replace(/ go.*| bus.*| terminal.*| centre.*/, "")
        .trim();
      return key && t.includes(key);
    });
  }

  // Returns true if it recognised a group request and took over.
  function tryHandle(message) {
    const m = " " + message.toLowerCase() + " ";
    const isGroup =
      /\bmeet\b|\bmiddle\b|\bgroup\b/.test(m) &&
      (/\bfriend/.test(m) || /\bus\b|\bwe\b|\beveryone\b|\ball of us\b/.test(m));
    if (!isGroup) return false;

    openPanel();

    // Destination: the place after "go to / get to / heading to / meet ... to".
    let destText = null;
    const dm =
      m.match(/(?:go to|get to|head(?:ing)? to|travel to|get us to)\s+([a-z .'-]+?)(?:\s|,|\.|$)/) ||
      m.match(/to\s+([a-z]+)\s+go\b/);
    if (dm) destText = dm[1].trim();

    // Ordered place mentions.
    const places = knownPlaces();
    const found = [];
    places.forEach((p) => {
      const idx = m.indexOf(" " + p);
      if (idx >= 0) found.push({ p, idx });
    });
    found.sort((a, b) => a.idx - b.idx);
    const ordered = [...new Set(found.map((f) => f.p))];

    // Destination wins its slot; the rest are people locations.
    const destNorm = destText ? destText.toLowerCase().trim() : null;
    const peopleCities = ordered.filter((p) => !destNorm || !destNorm.includes(p));

    if (destText) {
      const di = el("group-dest-input");
      if (di) di.value = destText.replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (peopleCities.length >= 2) {
      // Populate rows and run it.
      friends = peopleCities.slice(0, MAX).map((city, i) => ({
        id: ++seq,
        name: defaultName(i),
        place: null,
        rawText: city.replace(/\b\w/g, (c) => c.toUpperCase()),
      }));
      ensureMinimum();
      renderFriends();
      updateFindState();
      addAIMessage(
        "assistant",
        `On it — finding a fair GO stop for ${peopleCities.length} people${destText ? ` on the way to ${destText}` : ""}.`,
      );
      find(true);
    } else {
      addAIMessage(
        "assistant",
        `I've opened Group Trip${destText ? ` and set your destination to ${destText}` : ""}. Add each person's location in the bars, then tap Find Meeting Spot.`,
      );
      updateFindState();
    }
    return true;
  }

  function init() {
    const toggle = el("group-toggle");
    const body = el("group-body");
    if (!toggle) return;

    toggle.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      toggle.classList.toggle("open", !open);
    });

    el("group-add")?.addEventListener("click", addFriend);
    el("group-find")?.addEventListener("click", () => find(false));
    el("group-reset")?.addEventListener("click", reset);

    ensureMinimum();
    renderFriends();
    updateFindState();
  }

  return { init, tryHandle };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GroupTrip };
}
