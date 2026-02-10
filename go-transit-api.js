// GO Transit API Service
class GOTransitService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.gotransit.com/api/ServiceataGlance";
  }

  /**
   * Plan a trip using GO Transit API
   * @param {Object} params - Trip parameters
   * @returns {Promise} - Trip plan data
   */
  async planTrip(params) {
    const { fromCode, toCode, date, time, arriveBy = true } = params;

    try {
      const url = `${this.baseURL}/TripPlanner/PlanTrip`;
      const queryParams = new URLSearchParams({
        key: this.apiKey,
        from: fromCode,
        to: toCode,
        date: date || this.getCurrentDate(),
        time: time || this.getCurrentTime(),
        arriveBy: arriveBy.toString(),
      });

      const response = await fetch(`${url}?${queryParams.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`GO Transit API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseJourneys(data);
    } catch (error) {
      console.error("Error planning trip:", error);
      throw error;
    }
  }

  /**
   * Get stop times for a specific station
   */
  async getStopTimes(stopCode, date, time) {
    try {
      const url = `${this.baseURL}/Stops/GetStopTimes`;
      const queryParams = new URLSearchParams({
        key: this.apiKey,
        stopCode: stopCode,
        date: date || this.getCurrentDate(),
        time: time || this.getCurrentTime(),
      });

      const response = await fetch(`${url}?${queryParams.toString()}`);

      if (!response.ok) {
        throw new Error(`GO Transit API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error getting stop times:", error);
      throw error;
    }
  }

  /**
   * Get service updates/alerts
   */
  async getServiceUpdates() {
    try {
      const url = `${this.baseURL}/ServiceUpdates/GetServiceUpdates`;
      const queryParams = new URLSearchParams({
        key: this.apiKey,
      });

      const response = await fetch(`${url}?${queryParams.toString()}`);

      if (!response.ok) {
        throw new Error(`GO Transit API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error getting service updates:", error);
      return [];
    }
  }

  /**
   * Parse journey data from API response
   */
  parseJourneys(data) {
    if (!data.SchJourneys || !Array.isArray(data.SchJourneys)) {
      return [];
    }

    return data.SchJourneys.map((journey) => {
      return journey.Services.map((service) => ({
        startTime: service.StartTime,
        endTime: service.EndTime,
        duration: service.Duration,
        transferCount: service.transferCount || 0,
        accessible: service.Accessible === "true",
        trips: this.parseTrips(service.Trips),
        transfers: this.parseTransfers(service.Transfers),
        color: service.Colour,
        type: service.Type,
        direction: service.Direction,
        code: service.Code,
      }));
    }).flat();
  }

  /**
   * Parse trip segments
   */
  parseTrips(tripsData) {
    if (!tripsData || !tripsData.Trip) {
      return [];
    }

    const trips = Array.isArray(tripsData.Trip)
      ? tripsData.Trip
      : [tripsData.Trip];

    return trips.map((trip) => ({
      number: trip.Number,
      display: trip.Display,
      line: trip.Line,
      direction: trip.Direction,
      type: trip.Type,
      stops: this.parseStops(trip.Stops),
    }));
  }

  /**
   * Parse stops data
   */
  parseStops(stopsData) {
    if (!stopsData || !stopsData.Stop) {
      return [];
    }

    const stops = Array.isArray(stopsData.Stop)
      ? stopsData.Stop
      : [stopsData.Stop];

    return stops.map((stop) => ({
      code: stop.Code,
      order: stop.Order,
      time: stop.Time,
      isMajor: stop.IsMajor,
    }));
  }

  /**
   * Parse transfer data
   */
  parseTransfers(transfersData) {
    if (!transfersData || !transfersData.Transfer) {
      return [];
    }

    const transfers = Array.isArray(transfersData.Transfer)
      ? transfersData.Transfer
      : [transfersData.Transfer];

    return transfers.map((transfer) => ({
      code: transfer.Code,
      order: transfer.Order,
      time: transfer.Time,
    }));
  }

  /**
   * Calculate CO2 savings
   */
  calculateCO2Savings(distance, mode) {
    // Average CO2 per km: Car = 0.19 kg, Transit = 0.05 kg
    const distanceKm = this.parseDistance(distance);

    if (mode === "BICYCLING" || mode === "WALKING") {
      return distanceKm * 0.19; // Full car emissions saved
    } else if (mode === "TRANSIT") {
      return distanceKm * (0.19 - 0.05); // Difference between car and transit
    } else if (mode === "DRIVING") {
      return distanceKm * 0.19; // Car emissions generated
    }

    return 0;
  }

  /**
   * Parse distance string (e.g., "3.7 km" -> 3.7)
   */
  parseDistance(distanceStr) {
    if (typeof distanceStr === "number") return distanceStr;
    const match = distanceStr.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  }

  /**
   * Get current date in YYYY-MM-DD format
   */
  getCurrentDate() {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  /**
   * Get current time in HH:MM format
   */
  getCurrentTime() {
    const now = new Date();
    return now.toTimeString().substring(0, 5);
  }

  /**
   * Format duration string (e.g., "45 minutes" from "00:45:00")
   */
  formatDuration(durationStr) {
    if (!durationStr) return "0 min";

    const parts = durationStr.split(":");
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
  }

  /**
   * Find nearest GO station to coordinates
   */
  findNearestStation(lat, lng, stations) {
    let nearest = null;
    let minDistance = Infinity;

    stations.forEach((station) => {
      const distance = this.calculateHaversineDistance(
        lat,
        lng,
        station.lat,
        station.lng,
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearest = station;
      }
    });

    return { station: nearest, distance: minDistance };
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = GOTransitService;
}
