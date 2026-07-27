// Trainer profile — a standalone, Pokémon-Go-style identity screen built on top
// of the Gamification engine. Gamification.data() supplies all progress numbers;
// this module owns the presentation and the personalization (trainer name, a
// displayed title chosen from earned level titles, and a team accent color).
// Opened from the header avatar chip and the sidebar "View full profile" button.
const Profile = (() => {
  const KEY = "routeiq_profile";

  // Team accents only re-theme the profile + header chip, never the whole app,
  // so the brand purple stays the app's primary. Order = swatch order.
  const TEAMS = [
    { id: "violet", name: "Violet", color: "#7c3aed", soft: "rgba(124,58,237,0.16)" },
    { id: "azure", name: "Azure", color: "#3b82f6", soft: "rgba(59,130,246,0.16)" },
    { id: "amber", name: "Amber", color: "#e0b25a", soft: "rgba(224,178,90,0.16)" },
    { id: "mint", name: "Mint", color: "#46d19e", soft: "rgba(70,209,158,0.16)" },
  ];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Trainer",
        title: typeof raw.title === "string" ? raw.title : null,
        team: TEAMS.some((t) => t.id === raw.team) ? raw.team : "violet",
      };
    } catch (e) {
      return { name: "Trainer", title: null, team: "violet" };
    }
  }

  function save(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) {}
  }

  const teamOf = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Circular XP/level ring as inline SVG (progress from 12 o'clock, clockwise).
  function ring(pct, size, stroke, color) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
    const cx = size / 2;
    return `<svg class="pf-ringsvg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="${stroke}"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cx})"/>
    </svg>`;
  }

  const initial = (name) => (name.trim()[0] || "T").toUpperCase();

  // Small header chip: level ring + monogram + level number. Kept in sync via
  // refresh(). Clicking it opens the full profile.
  function renderChip() {
    const chip = document.getElementById("profile-chip");
    if (!chip || typeof Gamification === "undefined") return;
    const d = Gamification.data();
    const p = load();
    const t = teamOf(p.team);
    chip.style.setProperty("--pf-accent", t.color);
    chip.innerHTML = `
      <span class="pf-chip-avatar">
        ${ring(d.pct, 30, 3, t.color)}
        <span class="pf-chip-mono">${esc(initial(p.name))}</span>
      </span>
      <span class="pf-chip-lv">Lv ${d.levelNum}</span>`;
    chip.setAttribute("title", `${esc(p.name)} · Lv ${d.levelNum} ${esc(d.levelName)}`);
  }

  let selectedMedal = null;

  function renderBody() {
    const body = document.getElementById("profile-body");
    if (!body || typeof Gamification === "undefined") return;
    const d = Gamification.data();
    const p = load();
    const t = teamOf(p.team);
    const modal = document.querySelector(".profile-modal");
    if (modal) modal.style.setProperty("--pf-accent", t.color);

    // Title: default to current level name; only earned titles are selectable.
    const title = p.title && d.titles.includes(p.title) ? p.title : d.levelName;

    const xpLabel = d.maxed ? `${d.xp} XP · maxed` : `${d.curXp} / ${d.span} XP to Lv ${d.levelNum + 1}`;

    const stats = [
      { k: "trips", label: "Trips", value: d.stats.trips, icon: UI_ICONS.bus },
      { k: "time", label: "Minutes saved", value: d.stats.timeSaved, icon: UI_ICONS.timer },
      { k: "co2", label: "CO₂ saved (kg)", value: d.stats.co2Saved.toFixed(1), icon: UI_ICONS.leaf },
      { k: "stations", label: "Stations", value: d.stats.stations, icon: UI_ICONS.pin },
      { k: "reroutes", label: "Smart reroutes", value: d.stats.reroutes, icon: UI_ICONS.trendUp },
      { k: "best", label: "Best streak", value: `${d.longestStreak}d`, icon: UI_ICONS.flame },
    ];

    const teamDots = TEAMS.map(
      (tm) =>
        `<button class="pf-team ${tm.id === p.team ? "on" : ""}" data-team="${tm.id}" title="${tm.name}" style="--dot:${tm.color}" aria-label="${tm.name} team"></button>`,
    ).join("");

    const titleOpts = d.titles
      .map((tt) => `<option value="${esc(tt)}" ${tt === title ? "selected" : ""}>${esc(tt)}</option>`)
      .join("");

    const medals = d.badges
      .map(
        (b) =>
          `<button class="pf-medal ${b.earned ? "earned" : "locked"}" data-id="${b.id}" aria-label="${esc(b.name)}">
            <span class="pf-medal-disc">${b.icon}</span>
            <span class="pf-medal-name">${esc(b.name)}</span>
          </button>`,
      )
      .join("");

    const sel = selectedMedal ? d.badges.find((b) => b.id === selectedMedal) : null;
    const detail = sel
      ? `<div class="pf-medal-detail ${sel.earned ? "earned" : "locked"}">
           <span class="pf-medal-detail-ic">${sel.icon}</span>
           <div>
             <div class="pf-medal-detail-name">${esc(sel.name)} ${sel.earned ? "<em>· earned</em>" : "<em>· locked</em>"}</div>
             <div class="pf-medal-detail-desc">${esc(sel.desc)}</div>
           </div>
         </div>`
      : `<div class="pf-medal-hint">Tap a medal to see how to earn it.</div>`;

    body.innerHTML = `
      <div class="pf-hero">
        <div class="pf-avatar">
          ${ring(d.pct, 108, 6, t.color)}
          <span class="pf-avatar-mono">${esc(initial(p.name))}</span>
          <span class="pf-avatar-lv">${d.levelNum}</span>
        </div>
        <div class="pf-idblock">
          <div class="pf-nameline">
            <span class="pf-name" id="pf-name">${esc(p.name)}</span>
            <button class="pf-name-edit" id="pf-name-edit" title="Edit name" aria-label="Edit name">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
          </div>
          <select class="pf-title" id="pf-title" title="Displayed title">${titleOpts}</select>
          <div class="pf-teams">${teamDots}</div>
        </div>
      </div>

      <div class="pf-xp">
        <div class="pf-xp-top">
          <span>Lv ${d.levelNum} · ${esc(d.levelName)}</span>
          <span class="pf-xp-num">${xpLabel}</span>
        </div>
        <div class="pf-xp-bar"><div class="pf-xp-fill" style="width:${d.pct}%"></div></div>
      </div>

      <div class="pf-streakcard">
        <span class="pf-streak-flame">${UI_ICONS.flame}</span>
        <span class="pf-streak-num">${d.streak}</span>
        <span class="pf-streak-lbl">day streak<br><em>best ${d.longestStreak}</em></span>
        <span class="pf-streak-spacer"></span>
        <span class="pf-streak-badges">${d.earnedCount}<em>/${d.total} medals</em></span>
      </div>

      <div class="pf-section-title">Journey</div>
      <div class="pf-stats">
        ${stats
          .map(
            (s) =>
              `<div class="pf-stat"><span class="pf-stat-ic">${s.icon}</span><span class="pf-stat-val">${s.value}</span><span class="pf-stat-lbl">${s.label}</span></div>`,
          )
          .join("")}
      </div>

      <div class="pf-section-title">Medals <em>${d.earnedCount}/${d.total}</em></div>
      <div class="pf-medals">${medals}</div>
      ${detail}
    `;

    wireBody();
  }

  function wireBody() {
    const p = load();

    const editBtn = document.getElementById("pf-name-edit");
    if (editBtn) editBtn.addEventListener("click", startNameEdit);
    const nameEl = document.getElementById("pf-name");
    if (nameEl) nameEl.addEventListener("dblclick", startNameEdit);

    const titleSel = document.getElementById("pf-title");
    if (titleSel)
      titleSel.addEventListener("change", (e) => {
        const cur = load();
        cur.title = e.target.value;
        save(cur);
        refresh();
      });

    document.querySelectorAll(".pf-team").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cur = load();
        cur.team = btn.dataset.team;
        save(cur);
        refresh();
      }),
    );

    document.querySelectorAll(".pf-medal").forEach((btn) =>
      btn.addEventListener("click", () => {
        selectedMedal = selectedMedal === btn.dataset.id ? null : btn.dataset.id;
        renderBody();
      }),
    );
  }

  function startNameEdit() {
    const nameEl = document.getElementById("pf-name");
    if (!nameEl || nameEl.querySelector("input")) return;
    const cur = load();
    const input = document.createElement("input");
    input.className = "pf-name-input";
    input.type = "text";
    input.maxLength = 20;
    input.value = cur.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim().slice(0, 20);
      const next = load();
      next.name = v || "Trainer";
      save(next);
      refresh();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = cur.name;
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
  }

  function open() {
    const ov = document.getElementById("profile-overlay");
    if (!ov) return;
    selectedMedal = null;
    renderBody();
    ov.classList.add("active");
    document.addEventListener("keydown", onKey);
  }

  function close() {
    const ov = document.getElementById("profile-overlay");
    if (!ov) return;
    ov.classList.remove("active");
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  // Called by Gamification.render() after any progress change, and on init.
  function refresh() {
    renderChip();
    const ov = document.getElementById("profile-overlay");
    if (ov && ov.classList.contains("active")) renderBody();
  }

  function init() {
    const chip = document.getElementById("profile-chip");
    if (chip) chip.addEventListener("click", open);
    const sideBtn = document.getElementById("profile-open-sidebar");
    if (sideBtn) sideBtn.addEventListener("click", open);
    const closeBtn = document.getElementById("profile-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    const scrim = document.getElementById("profile-scrim");
    if (scrim) scrim.addEventListener("click", close);
    renderChip();
  }

  return { init, open, close, refresh };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Profile };
}
