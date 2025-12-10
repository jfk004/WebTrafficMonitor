let currentTabId = null;
let lastEventsCount = -1;
let lastTrackingUrl = null;

function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function refreshTrafficSummary() {
  const urlEl = document.getElementById("url");
  const statusEl = document.getElementById("summary-status");
  const eventsEl = document.getElementById("summary-events");
  const domainsEl = document.getElementById("summary-domains");
  const durationEl = document.getElementById("summary-duration");
  const lastEventEl = document.getElementById("summary-last-event");
  const eventCountLabel = document.getElementById("event-count");

  if (!statusEl) {
    console.warn("[WebTrafficMonitor] Summary elements not found in popup.");
    return;
  }

  chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
    if (!response || !response.success) {
      statusEl.textContent = "No traffic data yet. Visit or reload a page.";
      if (urlEl) urlEl.textContent = "No URL (no active tab data yet)";
      if (eventsEl) eventsEl.textContent = "0";
      if (domainsEl) domainsEl.textContent = "0";
      if (durationEl) durationEl.textContent = "0s";
      if (lastEventEl) lastEventEl.textContent = "—";
      if (eventCountLabel) eventCountLabel.textContent = "Events: 0";
      return;
    }

    const data = response.data || {};
    const events = data.events || [];
    const now = Date.now();

    if (urlEl) {
      urlEl.textContent = data.url || "Unknown URL";
    }

    // Only refresh Tracking Parameters when there is actually new traffic / URL
    if (data.url !== lastTrackingUrl || events.length !== lastEventsCount) {
      updateTrackingPanelForUrl(data.url);
      lastTrackingUrl = data.url;
      lastEventsCount = events.length;
    }

    // Update simple stats
    eventsEl.textContent = String(events.length);
    if (eventCountLabel) {
      eventCountLabel.textContent = `Events: ${events.length}`;
    }

    const domains = new Set();
    events.forEach((e) => {
      if (!e.url) return;
      try {
        const u = new URL(e.url);
        domains.add(u.hostname);
      } catch {
        // ignore
      }
    });
    domainsEl.textContent = String(domains.size);

    // Monitoring duration
    const startTime = data.startTime || now;
    const durationMs = Math.max(0, now - startTime);
    durationEl.textContent = formatDuration(durationMs);

    // Last event time + status
    if (events.length > 0) {
      const last = events[events.length - 1];
      const ts = last.timestamp || last.time || now;
      lastEventEl.textContent = new Date(ts).toLocaleTimeString();
      statusEl.textContent = "Monitoring this tab.";
    } else {
      lastEventEl.textContent = "—";
      statusEl.textContent = "No events collected yet. Reload the page.";
    }
  });
}


function updateTrackingPanelForUrl(rawUrl) {
  const emptyEl = document.getElementById("tracking-empty");
  const listEl = document.getElementById("tracking-list");
  if (!emptyEl || !listEl) return;

  if (!rawUrl) {
    // No URL at all, show empty state once
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    emptyEl.textContent =
      "No ad/tracking parameters detected for this site yet.";
    return;
  }

  let origin;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return;
  }

  chrome.storage.local.get({ googleTrackingLog: [] }, (data) => {
    const log = data.googleTrackingLog || [];
    const matching = log.filter(
      (entry) => entry.destinationOrigin === origin
    );

    if (!matching.length) {
      // Only now do we clear, since we know there is nothing
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      emptyEl.textContent =
        "No ad/tracking parameters detected for this site yet.";
      return;
    }

    emptyEl.classList.add("hidden");
    listEl.innerHTML = "";

    // Show the last few tracking hits for this origin
    matching
      .slice(-5)
      .reverse()
      .forEach((entry) => {
        const item = document.createElement("div");
        item.className = "tracking-item";

        const main = document.createElement("div");
        main.className = "tracking-item-main";

        const hostSpan = document.createElement("span");
        hostSpan.className = "tracking-host";
        try {
          hostSpan.textContent = new URL(entry.originalUrl).hostname;
        } catch {
          hostSpan.textContent = origin;
        }

        const badge = document.createElement("span");
        badge.className = "tracking-badge";
        badge.textContent = "Tracking params";

        main.appendChild(hostSpan);
        main.appendChild(badge);

        const paramsDiv = document.createElement("div");
        paramsDiv.className = "tracking-params";
        paramsDiv.textContent = Object.entries(entry.trackingParams)
          .map(([k, v]) => `${k}=${v}`)
          .join("&");

        const timeDiv = document.createElement("div");
        timeDiv.className = "tracking-time";
        timeDiv.textContent = new Date(entry.time).toLocaleTimeString();

        item.appendChild(main);
        item.appendChild(paramsDiv);
        item.appendChild(timeDiv);

        listEl.appendChild(item);
      });
  });
}


function updateTrafficStats(quiet = false) {
  const eventCount = document.getElementById("event-count");
  const loading = document.getElementById("loading");
  const errorDiv = document.getElementById("error");

  if (!eventCount || !loading || !errorDiv) {
    console.warn("[WebTrafficMonitor] Missing traffic stats UI elements.");
    return;
  }

  // Only show the spinner on non-quiet calls (initial load, manual actions)
  if (!quiet) {
    loading.classList.remove("hidden");
    errorDiv.classList.add("hidden");
  }

  chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
    if (!quiet) {
      loading.classList.add("hidden");
    }

    if (!response || !response.success) {
      eventCount.textContent = "Events: 0";
      return;
    }

    const data = response.data;
    const events = data.events || [];
    eventCount.textContent = `Events: ${events.length}`;
  });
}


function clearTrafficData() {
  chrome.runtime.sendMessage({ type: "clear_traffic_data" }, (response) => {
    if (!response || !response.success) {
      showError("Failed to clear traffic data.");
      return;
    }

    // Reset UI
    const eventCount = document.getElementById("event-count");
    const summaryEvents = document.getElementById("summary-events");
    const summaryDomains = document.getElementById("summary-domains");
    const summaryDuration = document.getElementById("summary-duration");
    const summaryLastEvent = document.getElementById("summary-last-event");
    const summaryStatus = document.getElementById("summary-status");
    const urlEl = document.getElementById("url");

    if (eventCount) eventCount.textContent = "Events: 0";
    if (summaryEvents) summaryEvents.textContent = "0";
    if (summaryDomains) summaryDomains.textContent = "0";
    if (summaryDuration) summaryDuration.textContent = "0s";
    if (summaryLastEvent) summaryLastEvent.textContent = "—";
    if (summaryStatus)
      summaryStatus.textContent =
        "Traffic data cleared. Reload the page to start fresh.";
    if (urlEl) urlEl.textContent = "No URL (data cleared)";
  });
}

/* =========================
   AI ANALYSIS HELPERS
   ========================= */

function updateApiKeyStatus(message, statusClass) {
  const statusEl = document.getElementById("api-key-status");
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = "";
  if (statusClass) {
    statusEl.classList.add(statusClass);
  }
}

async function loadApiKey() {
  const input = document.getElementById("api-key-input");
  if (!input) return;

  chrome.storage.local.get(["openai_api_key"], (result) => {
    if (result.openai_api_key) {
      input.value = result.openai_api_key;
      updateApiKeyStatus("✓ API key is saved", "success");
    } else {
      updateApiKeyStatus("No API key saved yet", "warning");
    }
  });
}

async function saveApiKey() {
  const input = document.getElementById("api-key-input");
  if (!input) return;

  const apiKey = input.value.trim();
  if (!apiKey) {
    updateApiKeyStatus("API key cannot be empty", "error");
    return;
  }

  if (!apiKey.startsWith("sk-")) {
    updateApiKeyStatus("⚠ API key should start with 'sk-'", "warning");
    // Still save it in case it's valid
  }

  try {
    await chrome.storage.local.set({ openai_api_key: apiKey });
    updateApiKeyStatus("✓ API key saved successfully", "success");

    // Clear any previous error messages in chat
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
      const systemMessages =
        chatMessages.querySelectorAll(".chat-message-system");
      systemMessages.forEach((msg) => msg.remove());
    }
  } catch (err) {
    console.error("Error saving API key:", err);
    updateApiKeyStatus("Failed to save API key", "error");
  }
}

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["openai_api_key"], (result) => {
      resolve(result.openai_api_key || null);
    });
  });
}

async function analyzeTrafficWithAI() {
  const loading = document.getElementById("loading");
  const errorDiv = document.getElementById("error");
  const resultsDiv = document.getElementById("analysis-results");
  const summaryDiv = document.getElementById("summary");
  const privacyDiv = document.getElementById("privacy-concerns");
  const securityDiv = document.getElementById("security-concerns");
  const recommendationsDiv = document.getElementById("recommendations");

  if (
    !loading ||
    !errorDiv ||
    !resultsDiv ||
    !summaryDiv ||
    !privacyDiv ||
    !securityDiv ||
    !recommendationsDiv
  ) {
    console.warn("[WebTrafficMonitor] Missing analysis UI elements.");
    return;
  }

  loading.classList.remove("hidden");
  errorDiv.classList.add("hidden");
  resultsDiv.classList.add("hidden");

  const apiKey = await getApiKey();
  if (!apiKey) {
    loading.classList.add("hidden");
    showError("Please set your OpenAI API key first.");
    return;
  }

  chrome.runtime.sendMessage(
    { type: "get_traffic_data" },
    async (response) => {
      if (!response || !response.success || !response.data) {
        loading.classList.add("hidden");
        showError("No traffic data available for analysis.");
        return;
      }

      const data = response.data;
      const events = data.events || [];

      if (events.length === 0) {
        loading.classList.add("hidden");
        showError("No events captured yet. Browse the site first.");
        return;
      }

      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const currentTab = tabs[0];

      const prompt = buildAnalysisPrompt(currentTab.url, data);

      try {
        const aiResponse = await callOpenAI(apiKey, prompt);
        loading.classList.add("hidden");

        if (!aiResponse || !aiResponse.choices?.length) {
          showError("AI did not return a valid response.");
          return;
        }

        const content = aiResponse.choices[0].message.content || "";
        renderAIAnalysisContent(content);
      } catch (err) {
        console.error("Error calling OpenAI:", err);
        loading.classList.add("hidden");
        showError("Error calling OpenAI. Check the console for details.");
      }
    }
  );
}

function buildAnalysisPrompt(url, data) {
  const events = data.events || [];
  const startTime = data.startTime || Date.now();
  const durationMs = Date.now() - startTime;
  const duration = formatDuration(durationMs);

  const domains = new Set();
  const methods = new Set();
  const eventTypes = {};

  events.forEach((e) => {
    if (e.url) {
      try {
        const u = new URL(e.url);
        domains.add(u.hostname);
      } catch {
        // ignore
      }
    }
    if (e.method) methods.add(e.method);
    if (e.kind) {
      eventTypes[e.kind] = (eventTypes[e.kind] || 0) + 1;
    }
  });

  let prompt = `You are a privacy and security expert. Analyze the following web traffic from ${url}.\n\n`;
  prompt += `Total events: ${events.length}\n`;
  prompt += `Monitoring duration: ${duration}\n`;
  prompt += `Unique domains: ${domains.size}\n`;
  prompt += `HTTP methods: ${Array.from(methods).join(", ") || "N/A"}\n\n`;

  prompt += `Event type breakdown:\n`;
  for (const [type, count] of Object.entries(eventTypes)) {
    prompt += `- ${type}: ${count}\n`;
  }

  prompt += `\nSample of recent events:\n`;
  const recent = events.slice(-20);
  recent.forEach((e, idx) => {
    prompt += `\n[Event #${events.length - recent.length + idx + 1}] ${
      e.kind || "unknown"
    }\n`;
    if (e.method) prompt += `- Method: ${e.method}\n`;
    if (e.url) prompt += `- URL: ${e.url}\n`;
    if (e.statusCode) prompt += `- Status: ${e.statusCode}\n`;
    if (e.type) prompt += `- Type: ${e.type}\n`;
    if (e.requestBody) {
      const bodyStr =
        typeof e.requestBody === "string"
          ? e.requestBody
          : JSON.stringify(e.requestBody).slice(0, 500);
      prompt += `- Request body (truncated): ${bodyStr}\n`;
    }
  });

  prompt += `\nPlease provide:\n`;
  prompt += `1. A high-level summary of what this site is doing with user data.\n`;
  prompt += `2. Any privacy concerns (e.g., tracking, fingerprinting, data sharing).\n`;
  prompt += `3. Any security concerns (e.g., mixed content, suspicious endpoints).\n`;
  prompt += `4. Concrete recommendations for an average user to protect their privacy and security on this site.\n`;

  return prompt;
}

async function callOpenAI(apiKey, prompt) {
  const body = {
    model: "gpt-5.1-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a cybersecurity and privacy expert helping users understand web tracking and data collection.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${text}`);
  }

  return response.json();
}

function renderAIAnalysisContent(content) {
  const resultsDiv = document.getElementById("analysis-results");
  const summaryDiv = document.getElementById("summary");
  const privacyDiv = document.getElementById("privacy-concerns");
  const securityDiv = document.getElementById("security-concerns");
  const recommendationsDiv = document.getElementById("recommendations");

  if (
    !resultsDiv ||
    !summaryDiv ||
    !privacyDiv ||
    !securityDiv ||
    !recommendationsDiv
  ) {
    console.warn("[WebTrafficMonitor] Missing analysis UI elements.");
    return;
  }

  resultsDiv.classList.remove("hidden");
  summaryDiv.textContent = "";
  privacyDiv.textContent = "";
  securityDiv.textContent = "";
  recommendationsDiv.textContent = "";

  const sections = {
    Summary: summaryDiv,
    "Privacy Concerns": privacyDiv,
    "Security Concerns": securityDiv,
    Recommendations: recommendationsDiv,
  };

  let currentSection = summaryDiv;
  let currentTitle = "Summary";

  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^#+\s*(.+)$/);
    if (match) {
      const title = match[1].trim();
      if (sections[title]) {
        currentSection = sections[title];
        currentTitle = title;
        continue;
      }
    }

    if (line.trim()) {
      currentSection.textContent += (currentSection.textContent ? "\n" : "") +
        line;
    }
  }
}

/* =========================
   CHAT INTERFACE
   ========================= */

function addChatMessage(role, content) {
  const messagesDiv = document.getElementById("chat-messages");
  if (!messagesDiv) return;

  const msg = document.createElement("div");
  msg.classList.add("chat-message");

  if (role === "user") {
    msg.classList.add("chat-message-user");
  } else if (role === "assistant") {
    msg.classList.add("chat-message-assistant");
  } else {
    msg.classList.add("chat-message-system");
  }

  const roleDiv = document.createElement("div");
  roleDiv.classList.add("chat-message-role");
  roleDiv.textContent = role.toUpperCase();

  const contentDiv = document.createElement("div");
  contentDiv.classList.add("chat-message-content");
  contentDiv.textContent = content;

  msg.appendChild(roleDiv);
  msg.appendChild(contentDiv);

  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function handleChatSubmit() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-chat-btn");
  const loading = document.getElementById("chat-loading");

  if (!input || !sendBtn || !loading) return;

  const text = input.value.trim();
  if (!text) return;

  const apiKey = await getApiKey();
  if (!apiKey) {
    addChatMessage(
      "system",
      "Please set your OpenAI API key above before using chat."
    );
    return;
  }

  addChatMessage("user", text);
  input.value = "";

  sendBtn.disabled = true;
  loading.classList.remove("hidden");

  try {
    const body = {
      model: "gpt-5.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant embedded inside a browser extension for analyzing web traffic, privacy, and security.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.6,
    };

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("Chat OpenAI API error:", response.status, t);
      addChatMessage(
        "system",
        "Error calling OpenAI for chat. Check the console for details."
      );
      return;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (reply) {
      addChatMessage("assistant", reply);
    } else {
      addChatMessage(
        "system",
        "OpenAI returned an empty response for chat."
      );
    }
  } catch (err) {
    console.error("Chat error:", err);
    addChatMessage(
      "system",
      "Unexpected error during chat. Check the console for details."
    );
  } finally {
    sendBtn.disabled = false;
    loading.classList.add("hidden");
  }
}

function setupChatInterface() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-chat-btn");
  if (!input || !sendBtn) return;

  sendBtn.addEventListener("click", handleChatSubmit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });
}

/* =========================
   RAW TRAFFIC VIEWER
   ========================= */

function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setupTrafficDataViewer() {
  const viewBtn = document.getElementById("view-data-btn");
  const closeBtn = document.getElementById("close-data-viewer");
  const viewer = document.getElementById("traffic-data-viewer");
  const content = document.getElementById("traffic-data-content");
  const exportBtn = document.getElementById("export-data-btn");
  const autoScroll = document.getElementById("auto-scroll");

  if (!viewBtn || !closeBtn || !viewer || !content || !exportBtn || !autoScroll) {
    console.warn("[WebTrafficMonitor] Missing traffic data viewer elements.");
    return;
  }

  function renderEvents(events) {
    content.innerHTML = "";

    if (!events || !events.length) {
      content.textContent =
        "No traffic events recorded yet. Browse some pages to capture data.";
      return;
    }

    events.forEach((event, index) => {
      const eventDiv = document.createElement("div");
      eventDiv.className = "traffic-event";
      eventDiv.innerHTML = `
            <div class="traffic-event-header">
              <span class="traffic-event-number">#${index + 1}</span>
              <span class="traffic-event-kind">${event.kind || "unknown"}</span>
              <span class="traffic-event-time">${new Date(
                event.timestamp || event.time
              ).toLocaleTimeString()}</span>
            </div>
            <div class="traffic-event-details">
              <div class="traffic-event-method">${event.method || "N/A"}</div>
              <div class="traffic-event-url">${escapeHtml(
                event.url || "N/A"
              )}</div>
              ${
                event.statusCode
                  ? `<div class="traffic-event-status">Status: ${event.statusCode}</div>`
                  : ""
              }
              ${
                event.type
                  ? `<div class="traffic-event-type">Type: ${event.type}</div>`
                  : ""
              }
              ${
                event.requestBody
                  ? `<div class="traffic-event-fields">${escapeHtml(
                      JSON.stringify(event.requestBody, null, 2)
                    )}</div>`
                  : ""
              }
            </div>
          `;
      content.appendChild(eventDiv);
    });

    if (autoScroll.checked) {
      content.scrollTop = content.scrollHeight;
    }
  }

  viewBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
      if (!response || !response.success || !response.data) {
        content.textContent = "No traffic data available.";
        viewer.classList.remove("hidden");
        return;
      }

      const data = response.data;
      renderEvents(data.events || []);
      viewer.classList.remove("hidden");
    });
  });

  closeBtn.addEventListener("click", () => {
    viewer.classList.add("hidden");
  });

  exportBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
      if (!response || !response.success || !response.data) {
        alert("No traffic data to export.");
        return;
      }

      const dataStr = JSON.stringify(response.data, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "web-traffic-data.json";
      a.click();

      URL.revokeObjectURL(url);
    });
  });
}

/* =========================
   CREATE AI PROMPT PAGE
   ========================= */

function createAIPrompt() {
  chrome.runtime.sendMessage(
    { type: "get_traffic_data" },
    async (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        showError("Error getting traffic data");
        return;
      }

      if (!response.success || !response.data || response.data.events.length === 0) {
        showError("No traffic data available to create a prompt");
        return;
      }

      const data = response.data;
      const events = data.events;

      // Get current tab URL for context
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const currentTab = tabs[0];

      // Create a comprehensive summary
      const summary = {
        currentUrl: currentTab.url,
        totalEvents: events.length,
        monitoringStartTime: new Date(data.startTime).toISOString(),
        eventTypes: {},
        domains: new Set(),
        endpointsByType: {},
      };

      // Analyze events
      events.forEach((event) => {
        // Count event types
        summary.eventTypes[event.kind] =
          (summary.eventTypes[event.kind] || 0) + 1;

        // Extract domains
        if (event.url && event.url !== "N/A") {
          try {
            const urlObj = new URL(event.url);
            summary.domains.add(urlObj.hostname);

            // Track endpoints by type
            if (!summary.endpointsByType[event.kind]) {
              summary.endpointsByType[event.kind] = new Set();
            }
            summary.endpointsByType[event.kind].add(
              urlObj.hostname + urlObj.pathname
            );
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });

      // Convert sets to arrays
      summary.domains = Array.from(summary.domains);
      for (const type in summary.endpointsByType) {
        summary.endpointsByType[type] = Array.from(
          summary.endpointsByType[type]
        );
      }

      // Compute monitoring duration
      const firstTs =
        events.length > 0
          ? events[0].timestamp || data.startTime || Date.now()
          : data.startTime || Date.now();
      const lastTs =
        events.length > 0
          ? events[events.length - 1].timestamp || Date.now()
          : Date.now();

      const durationMs = Math.max(0, lastTs - firstTs);
      const monitoringDuration = formatDuration(durationMs);

      // Format the prompt
      let prompt = `# Web Traffic Analysis Request

    ## Context
    - **Website URL**: ${currentTab.url}
    - **Analysis Start Time**: ${new Date(data.startTime).toLocaleString()}
    - **Total Events Captured**: ${events.length}
    - **Monitoring Duration**: ${monitoringDuration}

  ## Traffic Overview
  `;

      // Add event type breakdown
      prompt += `\n### Event Types Breakdown:\n`;
      for (const [type, count] of Object.entries(summary.eventTypes)) {
        const percentage = ((count / events.length) * 100).toFixed(1);
        prompt += `- **${type}**: ${count} events (${percentage}%)\n`;
      }

      // Add domains contacted
      prompt += `\n### Top Domains Contacted (${summary.domains.length} total):\n`;
      summary.domains.slice(0, 15).forEach((domain) => {
        prompt += `- ${domain}\n`;
      });
      if (summary.domains.length > 15) {
        prompt += `- ... and ${summary.domains.length - 15} more\n`;
      }

      // Add specific endpoints by type
      prompt += `\n### Key Endpoints by Type:\n`;
      for (const [type, endpoints] of Object.entries(
        summary.endpointsByType
      )) {
        prompt += `\n- **${type.toUpperCase()}**:\n`;
        endpoints.slice(0, 10).forEach((endpoint) => {
          prompt += `- ${endpoint}\n`;
        });
        if (endpoints.length > 10) {
          prompt += `  - ... and ${endpoints.length - 10} more\n`;
        }
      }

      // Add sample of recent events
      prompt += `\n## Recent Activity (last 20 events):\n`;
      const recentEvents = events.slice(-20);
      recentEvents.forEach((event, index) => {
        const eventNum = events.length - 20 + index + 1;
        prompt += `\n**Event #${eventNum}** [${event.kind.toUpperCase()}]:\n`;
        prompt += `- **Time**: ${new Date(
          event.timestamp || event.time
        ).toLocaleTimeString()}\n`;
        if (event.method && event.method !== "N/A") {
          prompt += `- **Method**: ${event.method}\n`;
        }
        if (event.url && event.url !== "N/A") {
          prompt += `- **URL**: ${event.url}\n`;
        }
        if (event.statusCode) {
          prompt += `- **Status code**: ${event.statusCode}\n`;
        }
        if (event.type) {
          prompt += `- **Type**: ${event.type}\n`;
        }
        if (event.requestBody) {
          const bodyStr =
            typeof event.requestBody === "string"
              ? event.requestBody
              : JSON.stringify(event.requestBody).slice(0, 500);
          prompt += `- **Request body (truncated)**: ${bodyStr}\n`;
        }
      });

      // Add statistics
      prompt += `\n## Statistics:\n`;
      prompt += `- Requests per minute: ${(
        events.length /
        ((Date.now() - data.startTime) / 1000 / 60)
      ).toFixed(2)}\n`;

      // Add analysis request
      prompt += `\n## Analysis Request:

Please analyze this web traffic data and provide insights on:

1. **Data Collection Patterns**: What types of data is this website collecting?
2. **Third-Party Services**: Which external services is the website communicating with?
3. **Privacy Implications**: What user data might be exposed to these services?
4. **Security Assessment**: Any suspicious or potentially malicious activity?
5. **Recommendations**: What should users be aware of, and what protections might help?

Please structure your response with clear sections and actionable insights.`;

      // Create a new tab with the prompt
      createPromptTab(prompt, {
        totalEvents: events.length,
        uniqueDomains: summary.domains.length,
        monitoringDuration
      });
    }
  );
}

function createPromptTab(prompt, stats) {
  const promptHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI Analysis Prompt - Web Traffic Monitor</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #1e1e1e;
      color: #f5f5f5;
    }
    h1, h2, h3 {
      color: #4a9eff;
    }
    .stats {
      display: flex;
      gap: 15px;
      margin: 20px 0;
      flex-wrap: wrap;
    }
    .stat-card {
      background: #333;
      padding: 15px;
      border-radius: 6px;
      text-align: center;
      flex: 1;
      min-width: 0;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #4a9eff;
      margin: 5px 0;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #aaa;
    }
    .controls {
      display: flex;
      gap: 10px;
      margin: 20px 0;
      flex-wrap: wrap;
    }
    button {
      padding: 10px 20px;
      background: #4a9eff;
      border: none;
      border-radius: 6px;
      color: white;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }
    button:hover {
      background: #3a8eef;
    }
    button.secondary {
      background: #555;
    }
    button.secondary:hover {
      background: #444;
    }
    .success-message {
      background: #2a4a2a;
      border: 1px solid #2ecc71;
      color: #2ecc71;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
      display: none;
      font-size: 13px;
    }
    .prompt-box {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 15px;
      margin: 15px 0;
      white-space: pre-wrap;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.4;
      max-height: 400px;
      overflow-y: auto;
    }
    .container {
      background: #252525;
      border-radius: 6px;
      padding: 15px 20px;
      margin-top: 20px;
    }
    .url-list {
      background: #1a1a1a;
      border-radius: 4px;
      padding: 10px;
      margin: 10px 0;
      max-height: 200px;
      overflow-y: auto;
    }
    .url-item {
      padding: 5px 10px;
      border-bottom: 1px solid #333;
      font-family: monospace;
      font-size: 12px;
    }
    .url-item:last-child {
      border-bottom: none;
    }
  </style>
</head>
<body>
  <h1>🔍 Web Traffic Analysis Prompt</h1>
  
  <div class="stats">
    <div class="stat-card">
      <div class="stat-value" id="event-count">${stats && typeof stats.totalEvents !== 'undefined' ? stats.totalEvents : '0'}</div>
      <div class="stat-label">Total Events</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="domain-count">${stats && typeof stats.uniqueDomains !== 'undefined' ? stats.uniqueDomains : '0'}</div>
      <div class="stat-label">Unique Domains</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="duration">${stats && stats.monitoringDuration ? stats.monitoringDuration : '0s'}</div>
      <div class="stat-label">Monitoring Time</div>
    </div>
  </div>
  
  <div class="controls">
    <button id="open-chatgpt" class="secondary">🤖 Open ChatGPT</button>
    <button id="open-claude" class="secondary">🧠 Open Claude</button>
    <button id="open-gemini" class="secondary">✨ Open Gemini</button>
    <button id="open-deepseek" class="secondary">🔎 Open DeepSeek</button>
  </div>
  
  <div class="container">
    <h2>Analysis Prompt</h2>
    <p>Copy this prompt and paste it into your preferred AI assistant for analysis:</p>
    
    <div class="prompt-box" id="prompt-content"></div>
  </div>
  
  <div class="container">
    <h2>Quick Stats</h2>
    <div id="event-types"></div>
    
    <h3>Top Domains Contacted:</h3>
    <div class="url-list" id="domain-list"></div>
  </div>
  
  <script>
    const promptContent = ${JSON.stringify(prompt)};
    const statsData = ${JSON.stringify(stats || {})};
    document.getElementById('prompt-content').textContent = promptContent;
    
    // Apply stats from the extension (no regex parsing)
    (function applyStats() {
      const s = statsData || {};
      const eventEl = document.getElementById('event-count');
      const domainEl = document.getElementById('domain-count');
      const durationEl = document.getElementById('duration');
      if (eventEl && typeof s.totalEvents !== 'undefined') eventEl.textContent = s.totalEvents;
      if (domainEl && typeof s.uniqueDomains !== 'undefined') domainEl.textContent = s.uniqueDomains;
      if (durationEl && s.monitoringDuration) durationEl.textContent = s.monitoringDuration;
    })();
    
    // Extract event types section (from the prompt text)
    const eventTypesSection = promptContent.match(/### Event Types Breakdown:[\\s\\S]*?(?=\\n\\n###|$)/);
    if (eventTypesSection) {
      const eventTypesDiv = document.getElementById('event-types');
      eventTypesDiv.innerHTML = eventTypesSection[0]
        .replace('### Event Types Breakdown:', '<strong>Event Types Breakdown:</strong><br>')
        .replace(/\\n- \\*\\*(.+?)\\*\\*: (.+)/g, '<br><strong>$1</strong>: $2');
    }
    
    // Extract domains section
    const domainSection = promptContent.match(/### Top Domains Contacted[\\s\\S]*?(?=\\n\\n###|$)/);
    if (domainSection) {
      const lines = domainSection[0].split('\\n');
      const domainList = document.getElementById('domain-list');
      lines.forEach((line) => {
        if (line.trim().startsWith('- ') && !line.includes('... and')) {
          const domain = line.replace('- ', '').trim();
          if (domain) {
            const div = document.createElement('div');
            div.className = 'url-item';
            div.textContent = domain;
            domainList.appendChild(div);
          }
        }
      });
    }
    
    // Open AI services
    document.getElementById('open-chatgpt').addEventListener('click', () => {
      window.open('https://chat.openai.com/', '_blank');
    });
    document.getElementById('open-claude').addEventListener('click', () => {
      window.open('https://claude.ai/', '_blank');
    });
    document.getElementById('open-gemini').addEventListener('click', () => {
      window.open('https://gemini.google.com/', '_blank');
    });
    document.getElementById('open-deepseek').addEventListener('click', () => {
      window.open('https://chat.deepseek.com/', '_blank');
    });
  </script>
</body>
</html>`;

  chrome.tabs.create({
    url: "data:text/html;charset=utf-8," + encodeURIComponent(promptHtml),
  });
}


function showError(message) {
  const errorDiv = document.getElementById("error");
  if (!errorDiv) return;
  errorDiv.textContent = message;
  errorDiv.classList.remove("hidden");
  setTimeout(() => {
    errorDiv.classList.add("hidden");
  }, 5000);
}

document.addEventListener("DOMContentLoaded", () => {
  // Remember current tab id
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      currentTabId = tabs[0].id;
    }
  });

  // Load traffic stats and summary
  updateTrafficStats();          // normal (shows spinner once)
  refreshTrafficSummary();

  // Keep refreshing while the popup is open (quietly)
  const REFRESH_INTERVAL_MS = 1000;
  setInterval(() => {
    updateTrafficStats(true);   // quiet: no spinner flicker
    refreshTrafficSummary();    // smooth summary update
  }, REFRESH_INTERVAL_MS);

  // Load API key
  loadApiKey();

  // Save API key button
  const saveBtn = document.getElementById("save-api-key");
  if (saveBtn) {
    saveBtn.addEventListener("click", saveApiKey);
  }

  // Analyze button
  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", analyzeTrafficWithAI);
  }

  // Clear button listener
  const clearBtn = document.getElementById("clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearTrafficData);
  }

  // Reload page button
  const reloadBtn = document.getElementById("reload-btn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      chrome.tabs.reload(currentTabId, () => {
        setTimeout(() => {
          updateTrafficStats();
          refreshTrafficSummary();
        }, 1000);
      });
    });
  }

  // Create AI prompt button
  const createPromptBtn = document.getElementById("create-ai-prompt-btn");
  if (createPromptBtn) {
    createPromptBtn.addEventListener("click", createAIPrompt);
  }

  // Chat interface
  setupChatInterface();

  // Traffic data viewer
  setupTrafficDataViewer();
});
