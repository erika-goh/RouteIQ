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

    const campuses = (typeof CONFIG !== "undefined" ? CONFIG.CAMPUSES || [] : [])
      .map((c) => `${c.name} (aka ${c.short})`)
      .join("; ");

    const dataLines = [];
    if (context.routes && context.routes !== "No routes found yet")
      dataLines.push(`Current route options:\n${context.routes}`);
    if (context.trafficData) dataLines.push(`Traffic: ${context.trafficData}`);
    if (context.busSchedule && context.busSchedule !== "No schedule available")
      dataLines.push(`Next departures: ${context.busSchedule}`);
    if (context.fareInfo) dataLines.push(`Fares: ${context.fareInfo}`);
    if (context.seatAvailability)
      dataLines.push(`Seat availability: ${context.seatAvailability}`);
    const dataBlock = dataLines.length ? dataLines.join("\n") : "none yet";

    const prompt = `You are RouteIQ's trip-planning agent for GO Transit in the Greater Toronto Area, helping university/college students.
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

Campuses students go to — treat these as destination kind "custom" with value = the FULL name below (map nicknames too):
${campuses}

Rules:
- Map any named GO station to the closest code above. Any other place/address => kind "custom" with value = the place text.
- "my location" / "current location" / "here" => origin kind "current".
- CLASS-TIME BACK-SOLVE: if the user gives a class/arrival time ("for my 10am lecture", "need to be at Mac by 2pm", "get me there by 9:30"), set "arrivalTime" to that time. "arrivalTime" must be "HH:MM" 24-hour, or null. Interpret bare "10am"=>"10:00", "2pm"=>"14:00".
- Set "search" TRUE only when BOTH origin and destination are known; then "needMore" is false.
- If something required is missing, set "search" false, "needMore" true, and make "reply" ask ONLY for the missing piece.
- CRITICAL: NEVER invent route options, bus numbers, departure times, durations, distances, fares, or CO2. You may only state such numbers by quoting them from the data block below, which the app calculated. When you set a NEW trip, reply like "Planning your trip from A to B — showing your options now."
- FARES: when asked about cost/fare/price, quote the "Est. fare" values from the data below and call them estimates. Mention the 40% PRESTO student discount if the toggle is off, and One Fare (free connecting TTC leg) when it applies. If there are no routes yet, say you'll have a fare estimate once you show the options.
- FORMATTING a multi-option answer (fares, durations, comparisons): do NOT run the options together in one paragraph. Use a short markdown list, cheapest/best first, one option per line, like:
  - **Transit** via Oakville — **$8.66** · 33 min
  Then one closing line with the recommendation. Never restate Traffic/CO2/Distance unless asked.
- SEATS: GO has no live seat/occupancy data and no seat reservations. If asked about seats, crowding, or "how full", say so plainly and offer what actually helps (travel off-peak, board at the terminal, earlier departure). NEVER state a seat count or a crowding percentage.
- Tone: friendly, clear, and concise, like a helpful classmate. At most one emoji.
- Keep "reply" to ONE short sentence — EXCEPT when listing multiple options (fares/durations/comparisons), where the short markdown list above is expected.
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

    // Decide direction by WHICH pattern matched, not whether the whole message
    // starts with "from" (it usually doesn't, e.g. "I want to travel from A to B").
    const fromTo = msg.match(/from (.+?) to (.+)/);
    const toFrom = msg.match(/to (.+?) from (.+)/);
    const m = fromTo || toFrom;
    if (m) {
      let a, b;
      if (fromTo) {
        a = fromTo[1]; // origin follows "from"
        b = fromTo[2]; // destination follows "to"
      } else {
        b = toFrom[1]; // destination follows "to"
        a = toFrom[2]; // origin follows "from"
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

    // Extract specific data — drop the "nothing yet" sentinels so they never
    // leak into prose (e.g. "departures include: No schedule available").
    const routes =
      context.routes && context.routes !== "No routes found yet"
        ? context.routes
        : "";
    const trafficData = context.trafficData || "";
    const busSchedule =
      context.busSchedule && context.busSchedule !== "No schedule available"
        ? context.busSchedule
        : "";

    // Bare confirmations ("do it", "yes", "go ahead") — offline we have no
    // pending action to run, so ask for the trip in one line instead of the
    // generic canned reply.
    if (/^(do it|can u do it|can you do it|yes|yep|sure|go|ok(ay)?|please)\.?$/.test(message.trim())) {
      return "Tell me the trip in one line — like “from Square One to York Mills GO” — and I'll plan it.";
    }

    // Address / "where is" questions. Offline I can only place known GO stations
    // and campuses; anything else needs the live map, so say so plainly rather
    // than returning an unrelated canned answer.
    if (/\baddress\b|where is|where's|location of|how do i get to/.test(message)) {
      const stations =
        typeof CONFIG !== "undefined" ? CONFIG.GO_TRANSIT_STATIONS || [] : [];
      const hit = stations.find((s) => {
        const key = s.name
          .toLowerCase()
          .replace(/ go.*| bus.*| terminal.*| centre.*/, "")
          .trim();
        return key && message.includes(key);
      });
      if (hit) {
        return `${hit.name} is a GO ${hit.type} stop. Set it as your destination and I'll map the exact location and routes there.`;
      }
      return "I can't look up arbitrary addresses offline. Type the place into the destination box — it'll geocode and pin it on the map.";
    }

    // Seats / crowding. Checked BEFORE the bus/transit branch so "is the bus
    // full?" gets the honest answer rather than a generic schedule reply. GO
    // publishes no occupancy data, so never imply a number.
    if (
      /\bseat(s|ing)?\b|\bfull\b|\bcrowded\b|\bcrowding\b|\bbusy\b|\bstanding room\b|\bhow packed\b/.test(
        message,
      )
    ) {
      return "GO doesn't publish live seat counts or reservations — buses and trains are first-come, first-served, so I can't tell you how full one is. In practice: off-peak departures are the quietest, and boarding at the terminal (rather than a mid-route stop) gives you the best shot at a seat.";
    }

    // Fare / cost. Uses the app's own estimate when routes exist.
    if (
      /\bfare\b|\bcost\b|\bprice\b|\bhow much\b|\bcheap(est|er)?\b|\bexpensive\b|\bpresto\b|\bticket\b|\$/.test(
        message,
      )
    ) {
      const fares = Array.isArray(context.fares) ? context.fares : [];
      if (fares.length) {
        return formatFareAnswer(fares, context);
      }
      return "GO fares are distance-based. Once I show your route options, each card carries an estimated fare — and if you're a full-time post-secondary student, the Student fare toggle applies the 40% PRESTO discount. Ontario's One Fare also makes a connecting TTC leg free.";
    }

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

    // Generic fallback. If there are results, summarise them; otherwise be
    // honest that the offline assistant is limited and steer toward the form.
    if (routes) {
      return `${busSchedule ? "Next departures: " + busSchedule + ". " : ""}Pick the route that best fits your priority — speed, traffic consistency, or lower CO₂. Tap a card to see it on the map.`;
    }
    return "I'm in limited offline mode right now, so I can't chat freely — but tell me a trip like “from Burlington GO to Hamilton GO” and I'll plan it, or fill the form on the left.";
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
      if (context.fareInfo) {
        relevantContext.push(`\n💲 FARES: ${context.fareInfo}`);
      }
      if (context.seatAvailability) {
        relevantContext.push(`\n🪑 SEATS: ${context.seatAvailability}`);
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
    prompt += `IMPORTANT: Answer based on the SPECIFIC DATA above. Use actual numbers and compare routes directly. Don't give generic advice - be specific and analytical. Quote fares from the FARES data as estimates; never invent a fare. Never state a seat count or crowding level — GO publishes none. When comparing several options, use a short markdown list (one option per line, best first) rather than one long paragraph.`;

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

// Compose a scannable fare answer from the structured fare data in the AI
// context. Emits only the markdown formatAIResponse understands (**bold**,
// "- " lists, newlines), so it renders as a real list rather than one long line.
const MODE_LABEL = {
  WALKING: "Walking",
  BICYCLING: "Cycling",
  DRIVING: "Driving",
  TRANSIT: "Transit",
};

function fmtDuration(min) {
  if (!Number.isFinite(min)) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Trim "Hamilton GO Centre" -> "Hamilton", "Oakville GO Bus Terminal" -> "Oakville".
function shortStation(name) {
  return String(name || "")
    .replace(/\s+(GO|Bus|Train|Terminal|Centre|Center|Station)\b.*$/i, "")
    .trim() || String(name || "");
}

function formatFareAnswer(fares, context = {}) {
  const sorted = [...fares].sort((a, b) => a.fare - b.fare);
  const cheapest = sorted[0];
  const fastest = [...fares].sort((a, b) => a.durationMin - b.durationMin)[0];

  const rows = sorted.map((f) => {
    const label = MODE_LABEL[f.mode] || f.mode;
    const dur = fmtDuration(f.durationMin);
    const isCheapest = f === cheapest;
    const price = isCheapest ? `**$${f.fare.toFixed(2)}**` : `$${f.fare.toFixed(2)}`;
    const bits = [price, dur, f.busTime ? `bus ${f.busTime}` : null].filter(Boolean);
    return `- **${label}** via ${shortStation(f.station)} — ${bits.join(" · ")}`;
  });

  // No blank line after the rows: formatAIResponse wraps them in a <ul>, which
  // already carries its own bottom margin (a "" here renders as a double <br>).
  const lines = [`**Estimated fares** — cheapest first:`, ...rows];

  const cheapLabel = MODE_LABEL[cheapest.mode] || cheapest.mode;
  if (fastest && fastest !== cheapest) {
    const fastLabel = MODE_LABEL[fastest.mode] || fastest.mode;
    lines.push(
      `Cheapest is **${cheapLabel}** at $${cheapest.fare.toFixed(2)}; **${fastLabel}** is quickest at ${fmtDuration(fastest.durationMin)} for $${fastest.fare.toFixed(2)}.`,
    );
  } else {
    lines.push(
      `**${cheapLabel}** is both cheapest and quickest — $${cheapest.fare.toFixed(2)} in ${fmtDuration(cheapest.durationMin)}.`,
    );
  }

  if (sorted.some((f) => f.freeTTC)) {
    lines.push("Your connecting TTC leg is free under Ontario's One Fare.");
  }
  lines.push(
    context.studentFare
      ? "Prices already include the 40% PRESTO student discount."
      : "Save 40% — turn on **Student fare** on any route card (PRESTO, full-time post-secondary).",
  );
  lines.push("These are estimates from RouteIQ's model, not official Metrolinx fares.");

  return lines.join("\n");
}

// Escape HTML so untrusted text (model output can echo the user's message)
// can't inject markup when inserted via innerHTML.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Helper function to format AI responses with markdown
function formatAIResponse(text) {
  // Escape FIRST, then apply our own safe markup — the only tags we emit are
  // <strong>/<em>/<ul>/<li>/<br>. Anything in the model/user text is inert.
  return (
    escapeHtml(text)
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
  module.exports = {
    GeminiAssistant,
    formatAIResponse,
    escapeHtml,
    formatFareAnswer,
    fmtDuration,
    shortStation,
  };
}
