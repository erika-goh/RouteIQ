// Gemini AI Integration Module
class GeminiAssistant {
  constructor(apiKey) {
    this.apiKey = apiKey;
    // Using Gemini 2.0 Flash - the latest stable model
    this.endpoint =
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent";
    this.conversationHistory = [];
  }

  async sendMessage(userMessage, context = {}) {
    try {
      const prompt = this.buildPrompt(userMessage, context);

      const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Gemini API response:", errorData);

        // If model not found, provide a helpful fallback response
        if (response.status === 404) {
          console.warn("Model not available, using fallback response");
          return this.getFallbackResponse(userMessage, context);
        }

        throw new Error(
          `Gemini API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`,
        );
      }

      const data = await response.json();

      // Handle the response structure with better error handling
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error("No response from Gemini API");
      }

      if (
        !data.candidates[0].content ||
        !data.candidates[0].content.parts ||
        data.candidates[0].content.parts.length === 0
      ) {
        throw new Error("Invalid response structure from Gemini API");
      }

      const aiResponse = data.candidates[0].content.parts[0].text;

      if (!aiResponse || aiResponse.trim() === "") {
        throw new Error("Empty response from Gemini API");
      }

      // Store in conversation history for context
      this.conversationHistory.push({
        role: "user",
        content: userMessage,
      });
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
      console.error("Gemini API Error:", error);
      // Return fallback response on any error
      return this.getFallbackResponse(userMessage, context);
    }
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
    const context = {
      origin: routeData.origin,
      destination: routeData.destination,
      duration: routeData.duration,
      distance: routeData.distance,
      steps: routeData.steps,
    };

    const message = `Analyze this transit route and provide insights on:
1. Best time to leave
2. Potential delays or issues
3. Alternative suggestions if needed
4. Tips for this journey`;

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
  // Convert markdown-style formatting to HTML
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = { GeminiAssistant, formatAIResponse };
}
