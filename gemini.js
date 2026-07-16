// Gemini AI Integration Module
// Talks to the /api/chat serverless proxy so the API key stays server-side.
// Falls back to a smart, data-driven offline response when the proxy is
// unavailable (e.g. local static hosting or no GEMINI_API_KEY configured).
class GeminiAssistant {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "/api/chat";
    this.conversationHistory = [];
  }

  async sendMessage(userMessage, context = {}) {
    const prompt = this.buildPrompt(userMessage, context);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        // 503 = no key configured, 404 = no backend (static hosting), etc.
        console.warn(
          `AI proxy unavailable (${response.status}); using offline fallback.`,
        );
        return this.getFallbackResponse(userMessage, context);
      }

      const data = await response.json();
      const aiResponse = data && data.reply;

      if (!aiResponse || aiResponse.trim() === "") {
        return this.getFallbackResponse(userMessage, context);
      }

      // Store in conversation history for context
      this.conversationHistory.push({ role: "user", content: userMessage });
      this.conversationHistory.push({
        role: "assistant",
        content: aiResponse,
      });

      // Keep only last 20 messages for context
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      return aiResponse;
    } catch (error) {
      console.warn("AI request failed; using offline fallback:", error.message);
      return this.getFallbackResponse(userMessage, context);
    }
  }

  // Low-level call to the proxy. Returns the reply string, or null on failure.
  async _call(prompt, json = false) {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, json }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data && data.reply) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Agent mode: interpret the user's message and return a structured action the
   * app applies to the form (origin/destination/mode/arrival + whether to
   * search). The reply is short; the app — not the model — produces the actual
   * route results, so the model is told NEVER to invent times/routes/numbers.
   */
  async agentAct(userMessage, context = {}) {
    const stations = (
      typeof CONFIG !== "undefined" ? CONFIG.GO_TRANSIT_STATIONS : []
    )
      .map((s) => `${s.name} [${s.code}]`)
      .join("; ");

    const dataLines = [];
    if (context.routes && context.routes !== "No routes found yet")
      dataLines.push(`Current route options:\n${context.routes}`);
    if (context.trafficData) dataLines.push(`Traffic: ${context.trafficData}`);
    if (context.busSchedule && context.busSchedule !== "No schedule available")
      dataLines.push(`Next departures: ${context.busSchedule}`);
    const dataBlock = dataLines.length ? dataLines.join("\n") : "none yet";

    const prompt = `You are RouteIQ's trip-planning agent for GO Transit in the Greater Toronto Area.
Return ONLY a JSON object (no markdown, no code fence) with EXACTLY this shape:
{
 "reply": string,
 "origin": {"kind":"current"|"station"|"custom","value":string} | null,
 "destination": {"kind":"station"|"custom","value":string} | null,
 "travelMode": "WALKING"|"BICYCLING"|"DRIVING"|"TRANSIT" | null,
 "arrivalTime": string | null,
 "search": boolean,
 "needMore": boolean
}

GO stations — for kind "station", set "value" to the CODE in brackets:
${stations}

Rules:
- Map any named GO station to the closest code above. Any other place/address => kind "custom" with value = the place text.
- "my location" / "current location" / "here" => origin kind "current".
- "arrivalTime" must be "HH:MM" 24-hour, or null.
- Set "search" TRUE only when BOTH origin and destination are known; then "needMore" is false.
- If something required is missing, set "search" false, "needMore" true, and make "reply" ask ONLY for the missing piece.
- CRITICAL: keep "reply" to ONE short sentence. NEVER invent or state route options, bus numbers, departure times, durations, distances, or CO2 — the app calculates and displays those. When you set a trip, reply like "Planning your trip from A to B — showing your options now."
- If the user is only asking a question about the current results, set origin/destination null and search false, and answer briefly using ONLY this data:
${dataBlock}

User message: "${userMessage}"`;

    const raw = await this._call(prompt, true);
    if (raw) {
      try {
        const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
        const obj = JSON.parse(cleaned);
        this.conversationHistory.push({ role: "user", content: userMessage });
        this.conversationHistory.push({
          role: "assistant",
          content: obj.reply || "",
        });
        if (this.conversationHistory.length > 20)
          this.conversationHistory = this.conversationHistory.slice(-20);
        return obj;
      } catch (e) {
        // fall through to heuristic
      }
    }
    return this._heuristic(userMessage, context);
  }

  // Offline / parse-failure fallback: try to read "from A to B" and match
  // stations; otherwise answer conversationally.
  _heuristic(userMessage, context = {}) {
    const msg = userMessage.toLowerCase();
    const stations =
      typeof CONFIG !== "undefined" ? CONFIG.GO_TRANSIT_STATIONS : [];
    const matchStation = (text) => {
      text = text.toLowerCase();
      return stations.find((s) => {
        const key = s.name
          .toLowerCase()
          .replace(/ go.*| bus.*| terminal.*| centre.*/, "")
          .trim();
        return key && text.includes(key);
      });
    };

    const m =
      msg.match(/from (.+?) to (.+)/) || msg.match(/to (.+?) from (.+)/);
    if (m) {
      let a, b;
      if (/^\s*from/.test(msg)) {
        a = m[1];
        b = m[2];
      } else {
        b = m[1];
        a = m[2];
      }
      const so = matchStation(a);
      const sd = matchStation(b);
      const origin =
        /current|my location|here/.test(a)
          ? { kind: "current", value: "" }
          : so
            ? { kind: "station", value: so.code }
            : { kind: "custom", value: a.trim() };
      const destination = sd
        ? { kind: "station", value: sd.code }
        : { kind: "custom", value: b.trim() };
      return {
        reply: `Planning your trip${so ? ` from ${so.name}` : ""}${sd ? ` to ${sd.name}` : ""} — showing your options now.`,
        origin,
        destination,
        travelMode: null,
        arrivalTime: null,
        search: true,
        needMore: false,
      };
    }

    return {
      reply: this.getFallbackResponse(userMessage, context),
      origin: null,
      destination: null,
      travelMode: null,
      arrivalTime: null,
      search: false,
      needMore: false,
    };
  }

  getFallbackResponse(userMessage, context = {}) {
    const message = userMessage.toLowerCase();

    // Extract specific data from context if available
    const routes = context.routes || "";
    const trafficData = context.trafficData || "";
    const busSchedule = context.busSchedule || "";

    // Specific, data-driven fallback responses
    if (
      message.includes("fastest") ||
      message.includes("quickest") ||
      message.includes("shortest")
    ) {
      if (routes && routes.includes("Duration")) {
        return `Based on your routes, the fastest option is typically the one with the lowest duration shown. Looking at your traffic conditions (${trafficData.includes("Low") ? "mostly low traffic" : trafficData.includes("Medium") ? "medium traffic" : "heavy traffic"}), I'd recommend the route with the shortest time and lowest traffic level.`;
      }
      return `The fastest route typically depends on current traffic. Check the duration times listed for each route - routes with lower traffic levels will be more consistent. The lowest duration + low traffic is usually your best bet.`;
    }

    if (message.includes("traffic")) {
      if (trafficData) {
        return `Here's what I'm seeing with traffic: ${trafficData}. Routes with low traffic will be more predictable and faster. If you have medium or heavy traffic routes, consider leaving earlier or choosing the low traffic alternative instead.`;
      }
      return `Traffic conditions significantly impact travel time. Lighter traffic routes (low) are 20-30% faster than heavy traffic routes. If you see heavy traffic, try a different route or leaving at a different time.`;
    }

    if (
      message.includes("time") ||
      message.includes("depart") ||
      message.includes("when")
    ) {
      if (busSchedule) {
        return `Based on your bus schedule (${busSchedule}), you have several options. For your desired arrival time, I'd recommend choosing a bus that gives you a comfortable buffer. Check which departure time gets you to your destination close to when you need to arrive.`;
      }
      return `Check the bus schedule - departures typically run every 30 minutes. Choose a time that gives you a reasonable buffer before your desired arrival.`;
    }

    if (message.includes("route")) {
      if (routes) {
        return `You have multiple routes available. The best one depends on your priorities: Duration (quickest), Traffic (most consistent), or CO2 (most eco-friendly). Each route shows these metrics - pick the one that matches your needs.`;
      }
      return `To find the best route, I compare travel time, current traffic conditions, and distance. Enter your destination to see multiple route options.`;
    }

    if (message.includes("bus") || message.includes("transit")) {
      if (busSchedule) {
        return `The next GO Bus departures are: ${busSchedule}. Pick the one that aligns with your desired arrival time and leaves you with enough buffer.`;
      }
      return `GO Bus transit in the Greater Toronto Area typically runs from early morning until late evening with departures every 30 minutes on most routes.`;
    }

    if (
      message.includes("station") ||
      message.includes("destination") ||
      message.includes("where")
    ) {
      if (context.destination && context.destination !== "null") {
        return `Your destination is set to ${context.destination}. ${routes ? "I've found multiple routes to get you there - check the durations and traffic levels to pick the best option." : "Enter your origin location to start finding routes."}`;
      }
      return `Which GO Bus station or transit hub are you heading to? I can help you find the best routes once you set your destination.`;
    }

    if (
      message.includes("co2") ||
      message.includes("carbon") ||
      message.includes("eco") ||
      message.includes("environment")
    ) {
      if (routes && routes.includes("CO2")) {
        return `Looking at the CO2 emissions for your routes, you can see which options are most eco-friendly. Walking/cycling are zero-emission, while different transit modes have different carbon footprints. The more sustainable choice is usually clearly marked.`;
      }
      return `Different travel modes have different environmental impacts. Transit and cycling are much more eco-friendly than driving. Check the CO2 metrics for each route.`;
    }

    // Generic data-driven fallback
    return `I'm analyzing your trip options now. ${trafficData ? "Current traffic shows " + (trafficData.includes("Heavy: 0") ? "all clear routes with good conditions" : "some traffic variations") + ". " : ""}${busSchedule ? "Available departures include: " + busSchedule + ". " : ""}${routes ? "Choose the route that best matches your needs for speed, traffic consistency, or environmental impact." : "Set your destination to find the best routes."}`;
  }

  buildPrompt(userMessage, context) {
    // Build a conversational prompt with specific data-driven recommendations
    let prompt = `You are RouteIQ's AI travel assistant. IMPORTANT: Analyze the SPECIFIC traffic data and bus timing provided. Give precise, data-backed recommendations with numbers, not generic statements.

Guidelines:
- Reference specific traffic levels, route durations, and bus times from the data
- Compare routes with exact numbers (e.g., "Route A is 5 minutes faster due to low traffic vs Route B with medium traffic")
- Recommend specific bus times and departure times based on the data
- Mention specific traffic conditions for each route (heavy/medium/low)
- Use the CO2 savings numbers in recommendations

`;

    // Add conversation history for context awareness
    if (this.conversationHistory.length > 0) {
      prompt += `Recent conversation:\n`;
      const recentHistory = this.conversationHistory.slice(-6);
      recentHistory.forEach((msg) => {
        if (msg.role === "user") {
          prompt += `User: ${msg.content}\n`;
        } else {
          prompt += `Assistant: ${msg.content}\n`;
        }
      });
      prompt += `\n`;
    }

    // Add context if available with detailed traffic analysis
    if (context && Object.keys(context).length > 0) {
      const relevantContext = [];
      if (context.origin && context.origin !== "null") {
        relevantContext.push(`📍 Origin: ${context.origin}`);
      }
      if (context.destination && context.destination !== "null") {
        relevantContext.push(`📍 Destination: ${context.destination}`);
      }
      if (context.arrivalTime && context.arrivalTime !== "Not set") {
        relevantContext.push(`⏰ Desired Arrival Time: ${context.arrivalTime}`);
      }

      // Include detailed route information with ALL metrics
      if (context.routes && context.routes !== "No routes found yet") {
        relevantContext.push(
          `\n🚌 DETAILED ROUTE ANALYSIS:\n${context.routes}`,
        );
      }

      // Include traffic data with specific metrics
      if (context.trafficData) {
        relevantContext.push(`\n🚦 TRAFFIC METRICS:\n${context.trafficData}`);
      }

      if (context.selectedRoute) {
        relevantContext.push(`Selected Route: ${context.selectedRoute}`);
      }
      if (
        context.busSchedule &&
        context.busSchedule !== "No schedule available"
      ) {
        relevantContext.push(`⏱️ Bus Schedule: ${context.busSchedule}`);
      }

      if (relevantContext.length > 0) {
        prompt += `DATA PROVIDED:\n`;
        relevantContext.forEach((ctx) => {
          prompt += `${ctx}\n`;
        });
        prompt += `\n`;
      }
    }

    prompt += `User's question: "${userMessage}"\n\n`;
    prompt += `IMPORTANT: Answer based on the SPECIFIC DATA above. Use actual numbers and compare routes directly. Don't give generic advice - be specific and analytical.`;

    return prompt;
  }

  async analyzeRoute(routeData) {
    // routeData is a flat, primitive-only summary (no Google Maps objects) so
    // it renders cleanly inside the prompt.
    const context = {
      origin: routeData.origin,
      destination: routeData.destination,
      arrivalTime: routeData.arrivalTime,
      routes: routeData.routeSummary,
      trafficData: routeData.trafficData,
      busSchedule: routeData.busSchedule,
    };

    const message = `Analyze the recommended route above and give a short, practical briefing: the best time to leave, any likely delays, and one tip for this journey. Keep it to 3-4 sentences.`;

    return await this.sendMessage(message, context);
  }

  async suggestOptimalDeparture(arrivalTime, routes, busSchedule) {
    const context = {
      arrivalTime,
      routes: routes.map((r) => ({
        duration: r.duration,
        mode: r.travelMode,
      })),
      busSchedule,
    };

    const message = `Based on the desired arrival time of ${arrivalTime}, which bus should I take? Consider buffer time for delays.`;

    return await this.sendMessage(message, context);
  }

  async provideTrafficInsights(trafficConditions) {
    const message = `Current traffic conditions show: ${trafficConditions}. Should I adjust my departure time or route?`;

    return await this.sendMessage(message, { traffic: trafficConditions });
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getHistory() {
    return this.conversationHistory;
  }
}

// Helper function to format AI responses with markdown
function formatAIResponse(text) {
  // Convert markdown-style formatting to HTML.
  // Handle bullet lists BEFORE turning newlines into <br> (the list regex is
  // line-anchored and would otherwise never match).
  return (
    text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      // Group consecutive "- " lines into a single <ul>.
      .replace(/(?:^|\n)(- .+(?:\n- .+)*)/g, (_, block) => {
        const items = block
          .split("\n")
          .map((line) => line.replace(/^- (.+)$/, "<li>$1</li>"))
          .join("");
        return `<ul>${items}</ul>`;
      })
      .replace(/\n/g, "<br>")
  );
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = { GeminiAssistant, formatAIResponse };
}
