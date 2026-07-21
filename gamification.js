// Gamification layer — commuter streaks, XP levels, and unlockable badges.
// Self-contained: reads trip totals from the global `lifetimeStats` (app.js)
// and keeps its own progress blob in localStorage. Renders into #progress-*
// containers and pops a toast when something new is unlocked.
const Gamification = (() => {
  const KEY = "routeiq_gamify";

  // XP -> level ladder (transit themed). Last level is open-ended.
  const LEVELS = [
    { name: "Rookie Rider", xp: 0 },
    { name: "Platform Regular", xp: 100 },
    { name: "Weekly Warrior", xp: 300 },
    { name: "Route Strategist", xp: 700 },
    { name: "Transit Titan", xp: 1400 },
    { name: "GO Legend", xp: 2600 },
  ];

  // Badge catalog. `test(s)` gets a snapshot: { trips, timeSaved, co2Saved,
  // streak, longestStreak, modes:{}, stations:Set-size, earlyBird, nightOwl }.
  const I = typeof UI_ICONS !== "undefined" ? UI_ICONS : {};
  const BADGES = [
    { id: "first", icon: I.ticket, name: "First Ride", desc: "Plan your first trip", test: (s) => s.trips >= 1 },
    { id: "trips10", icon: I.bus, name: "Getting Around", desc: "Plan 10 trips", test: (s) => s.trips >= 10 },
    { id: "trips50", icon: I.trophy, name: "Commuter", desc: "Plan 50 trips", test: (s) => s.trips >= 50 },
    { id: "trips100", icon: I.crown, name: "Centurion", desc: "Plan 100 trips", test: (s) => s.trips >= 100 },
    { id: "streak3", icon: I.flame, name: "On a Roll", desc: "3-day streak", test: (s) => s.longestStreak >= 3 },
    { id: "streak7", icon: I.bolt, name: "Week Strong", desc: "7-day streak", test: (s) => s.longestStreak >= 7 },
    { id: "streak14", icon: I.gem, name: "Unstoppable", desc: "14-day streak", test: (s) => s.longestStreak >= 14 },
    { id: "eco5", icon: I.leaf, name: "Eco Starter", desc: "Save 5 kg CO₂", test: (s) => s.co2Saved >= 5 },
    { id: "eco25", icon: I.tree, name: "Planet Ally", desc: "Save 25 kg CO₂", test: (s) => s.co2Saved >= 25 },
    { id: "bike", icon: I.bike, name: "Pedal Power", desc: "Bike to a station", test: (s) => (s.modes.BICYCLING || 0) >= 1 },
    { id: "explorer", icon: I.compass, name: "Explorer", desc: "Use 5 different stations", test: (s) => s.stations >= 5 },
    { id: "early", icon: I.sunrise, name: "Early Bird", desc: "Plan a trip before 7am", test: (s) => s.earlyBird },
    { id: "night", icon: I.moon, name: "Night Owl", desc: "Plan a trip after 9pm", test: (s) => s.nightOwl },
    { id: "saver", icon: I.timer, name: "Time Bandit", desc: "Save 5 hours total", test: (s) => s.timeSaved >= 300 },
  ];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        days: Array.isArray(raw.days) ? raw.days : [],
        modes: raw.modes || {},
        stations: Array.isArray(raw.stations) ? raw.stations : [],
        earlyBird: !!raw.earlyBird,
        nightOwl: !!raw.nightOwl,
        unlocked: Array.isArray(raw.unlocked) ? raw.unlocked : [],
        level: typeof raw.level === "number" ? raw.level : 0,
      };
    } catch (e) {
      return { days: [], modes: {}, stations: [], earlyBird: false, nightOwl: false, unlocked: [], level: 0 };
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function dayDiff(aISO, bISO) {
    const a = new Date(aISO + "T00:00:00");
    const b = new Date(bISO + "T00:00:00");
    return Math.round((a - b) / 86400000);
  }

  // Current streak: consecutive days ending today or yesterday (a trip "today or
  // yesterday" keeps it alive so you don't lose it mid-morning).
  function currentStreak(days) {
    if (!days.length) return 0;
    const sorted = [...new Set(days)].sort();
    const last = sorted[sorted.length - 1];
    const gap = dayDiff(todayISO(), last);
    if (gap > 1) return 0;
    let streak = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (dayDiff(sorted[i], sorted[i - 1]) === 1) streak++;
      else break;
    }
    return streak;
  }

  function longestStreak(days) {
    const sorted = [...new Set(days)].sort();
    let best = sorted.length ? 1 : 0;
    let run = best;
    for (let i = 1; i < sorted.length; i++) {
      if (dayDiff(sorted[i], sorted[i - 1]) === 1) run++;
      else run = 1;
      if (run > best) best = run;
    }
    return best;
  }

  function xp(s) {
    return Math.round(s.trips * 20 + s.timeSaved + s.co2Saved * 10 + s.longestStreak * 15);
  }

  function levelFor(x) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (x >= LEVELS[i].xp) idx = i;
    return idx;
  }

  // Snapshot combining persisted progress with the global lifetime totals.
  function snapshot() {
    const state = load();
    const ls = typeof lifetimeStats !== "undefined" ? lifetimeStats : { trips: 0, timeSaved: 0, co2Saved: 0 };
    return {
      trips: ls.trips || 0,
      timeSaved: ls.timeSaved || 0,
      co2Saved: ls.co2Saved || 0,
      streak: currentStreak(state.days),
      longestStreak: longestStreak(state.days),
      modes: state.modes,
      stations: state.stations.length,
      earlyBird: state.earlyBird,
      nightOwl: state.nightOwl,
      _state: state,
    };
  }

  // Persist any badge whose condition is currently met. Returns the (possibly
  // updated) unlocked list. Called from render() too, so badges show correctly
  // even for stats earned outside a recordTrip (e.g. restored from storage).
  function syncUnlocked(snap) {
    const state = snap._state;
    let changed = false;
    BADGES.forEach((b) => {
      if (b.test(snap) && !state.unlocked.includes(b.id)) {
        state.unlocked.push(b.id);
        changed = true;
      }
    });
    if (changed) save(state);
    return state.unlocked;
  }

  // Record a completed trip; update streak day, mode/station/time flags, then
  // re-evaluate badges + level and surface anything newly earned.
  function recordTrip(route) {
    const state = load();
    const day = todayISO();
    if (!state.days.includes(day)) state.days.push(day);
    if (state.days.length > 400) state.days = state.days.slice(-400);

    if (route) {
      if (route.travelMode) state.modes[route.travelMode] = (state.modes[route.travelMode] || 0) + 1;
      const code = route.station && route.station.code;
      if (code && !state.stations.includes(code)) state.stations.push(code);
    }
    const hour = new Date().getHours();
    if (hour < 7) state.earlyBird = true;
    if (hour >= 21) state.nightOwl = true;

    save(state);

    const snap = snapshot();
    const prevLevel = state.level || 0;
    const newLevel = levelFor(xp(snap));

    // Newly unlocked badges (diff against what was already earned).
    const prevUnlocked = new Set(snap._state.unlocked);
    syncUnlocked(snap);
    const freshBadges = BADGES.filter(
      (b) => snap._state.unlocked.includes(b.id) && !prevUnlocked.has(b.id),
    );
    snap._state.level = newLevel;
    save(snap._state);

    render();

    if (newLevel > prevLevel) {
      toast("Level up!", `You're now a ${LEVELS[newLevel].name}`, I.trendUp);
    }
    freshBadges.forEach((b, i) =>
      setTimeout(
        () => toast("Badge unlocked", `${b.name} — ${b.desc}`, b.icon),
        (i + (newLevel > prevLevel ? 1 : 0)) * 900,
      ),
    );
  }

  function render() {
    const streakEl = document.getElementById("progress-streak");
    const levelEl = document.getElementById("progress-level");
    const barEl = document.getElementById("progress-bar-fill");
    const badgesEl = document.getElementById("progress-badges");
    if (!streakEl) return;

    const snap = snapshot();
    syncUnlocked(snap); // reflect badges earned from restored/updated stats
    const x = xp(snap);
    const lvl = levelFor(x);
    const cur = LEVELS[lvl];
    const next = LEVELS[lvl + 1];

    streakEl.textContent = snap.streak;
    document.getElementById("progress-streak-best").textContent = `best ${snap.longestStreak}`;
    levelEl.textContent = `Lv ${lvl + 1} · ${cur.name}`;

    if (next) {
      const pct = Math.min(100, Math.round(((x - cur.xp) / (next.xp - cur.xp)) * 100));
      barEl.style.width = pct + "%";
      document.getElementById("progress-xp").textContent = `${x} / ${next.xp} XP`;
    } else {
      barEl.style.width = "100%";
      document.getElementById("progress-xp").textContent = `${x} XP · maxed`;
    }

    badgesEl.innerHTML = BADGES.map((b) => {
      const earned = snap._state.unlocked.includes(b.id);
      return `<div class="badge ${earned ? "earned" : "locked"}" title="${b.name} — ${b.desc}">
        <span class="badge-icon">${b.icon}</span>
      </div>`;
    }).join("");
    const earnedCount = BADGES.filter((b) => snap._state.unlocked.includes(b.id)).length;
    document.getElementById("progress-badge-count").textContent = `${earnedCount}/${BADGES.length}`;
  }

  function toast(title, body, iconSvg) {
    let wrap = document.getElementById("toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = "toast";
    // Icon is a trusted inline-SVG constant; title/body are set as text.
    el.innerHTML = `<div class="toast-icon">${iconSvg || ""}</div><div class="toast-text"><div class="toast-title"></div><div class="toast-body"></div></div>`;
    el.querySelector(".toast-title").textContent = title;
    el.querySelector(".toast-body").textContent = body;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 4200);
  }

  function init() {
    render();
  }

  return { init, recordTrip, render };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Gamification };
}
