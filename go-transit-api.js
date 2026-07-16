// GO Transit (Metrolinx Open Data) client — talks to the /api/gotransit proxy
// so the API key stays server-side. All calls degrade gracefully: if the proxy
// or upstream is unavailable, callers fall back to bundled schedule data.
class GOTransitService {
  constructor() {
    this.proxy = "/api/gotransit";
  }

  // Fetch a Metrolinx Open Data path through the proxy. Returns parsed JSON or null.
  async fetchPath(path) {
    try {
      const res = await fetch(`${this.proxy}?path=${encodeURIComponent(path)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn("GO Transit fetch failed:", err.message);
      return null;
    }
  }

  /**
   * Next real departures for a stop, as ["HH:MM", ...] (future, sorted, unique).
   * Uses live Metrolinx NextService data (Computed time when available, i.e.
   * accounting for delays; otherwise the scheduled time).
   * Returns null when live data is unavailable so callers can fall back.
   */
  async getNextService(stopCode) {
    if (!stopCode) return null;
    const data = await this.fetchPath(`api/V1/Stop/NextService/${stopCode}`);
    const lines = data && data.NextService && data.NextService.Lines;
    if (!Array.isArray(lines) || lines.length === 0) return null;

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const times = lines
      .map((l) => l.ComputedDepartureTime || l.ScheduledDepartureTime || "")
      .map((s) => {
        const m = String(s).match(/(\d{1,2}):(\d{2})/);
        return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
      })
      .filter(Boolean);

    const unique = [...new Set(times)]
      .filter((t) => {
        const [h, mm] = t.split(":").map(Number);
        return h * 60 + mm >= nowMinutes;
      })
      .sort();

    return unique.length ? unique : null;
  }

  /**
   * Service alerts / updates. Returns an array of { message } (may be empty).
   */
  async getServiceUpdates() {
    const data = await this.fetchPath("api/V1/ServiceUpdate/InformationAlert/All");
    if (!data) return [];
    return this.extractMessages(data).map((message) => ({ message }));
  }

  /**
   * Recursively pull time-like values ("HH:MM") from departure/time fields,
   * regardless of the exact response shape. Keeps only future times.
   */
  extractTimes(node, found = new Set()) {
    if (node == null) return [];
    if (Array.isArray(node)) {
      node.forEach((item) => this.extractTimes(item, found));
    } else if (typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (
          typeof value === "string" &&
          /depart/i.test(key) &&
          /\d{1,2}:\d{2}/.test(value)
        ) {
          const m = value.match(/(\d{1,2}):(\d{2})/);
          if (m) {
            const hh = String(parseInt(m[1], 10)).padStart(2, "0");
            found.add(`${hh}:${m[2]}`);
          }
        } else if (value && typeof value === "object") {
          this.extractTimes(value, found);
        }
      }
    }

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    return [...found]
      .filter((t) => {
        const [h, mm] = t.split(":").map(Number);
        return h * 60 + mm > nowMinutes;
      })
      .sort();
  }

  // Recursively collect human-readable message strings from an alerts payload.
  extractMessages(node, found = []) {
    if (node == null) return found;
    if (Array.isArray(node)) {
      node.forEach((item) => this.extractMessages(item, found));
    } else if (typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (
          typeof value === "string" &&
          value.trim().length > 8 &&
          /(message|description|title|alert|subjectenglish)/i.test(key)
        ) {
          found.push(value.trim());
        } else if (value && typeof value === "object") {
          this.extractMessages(value, found);
        }
      }
    }
    return [...new Set(found)].slice(0, 5);
  }

  /* ---------------- Local helpers (no network) ---------------- */

  // Average CO2 per km: Car = 0.19 kg, Transit = 0.05 kg
  calculateCO2Savings(distance, mode) {
    const distanceKm = this.parseDistance(distance);
    if (mode === "BICYCLING" || mode === "WALKING") return distanceKm * 0.19;
    if (mode === "TRANSIT") return distanceKm * (0.19 - 0.05);
    if (mode === "DRIVING") return distanceKm * 0.19;
    return 0;
  }

  parseDistance(distanceStr) {
    if (typeof distanceStr === "number") return distanceStr;
    const match = String(distanceStr).match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  }

  findNearestStation(lat, lng, stations) {
    let nearest = null;
    let minDistance = Infinity;
    stations.forEach((station) => {
      const distance = this.calculateHaversineDistance(lat, lng, station.lat, station.lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = station;
      }
    });
    return { station: nearest, distance: minDistance };
  }

  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = GOTransitService;
}
