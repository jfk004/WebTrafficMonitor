// popup.js

let currentTabId = null;

// === Helpers ===

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

  // Default state while loading
  statusEl.textContent = "Loading summary...";
  eventsEl.textContent = "0";
  domainsEl.textContent = "0";
  durationEl.textContent = "0s";
  lastEventEl.textContent = "—";
  if (eventCountLabel) eventCountLabel.textContent = "Events: 0";

  chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
    if (!response || !response.success) {
      statusEl.textContent = "No traffic data yet. Visit or reload a page.";
      if (urlEl) urlEl.textContent = "No URL (no active tab data yet)";
      return;
    }

    const data = response.data || {};
    const events = data.events || [];
    const now = Date.now();

    // URL at top
    if (urlEl) {
      urlEl.textContent = data.url || "Unknown URL";
    }

    // Events count
    eventsEl.textContent = String(events.length);
    if (eventCountLabel) {
      eventCountLabel.textContent = `Events: ${events.length}`;
    }

    // Unique domains
    const domains = new Set();
    events.forEach((e) => {
      if (!e.url) return;
      try {
        const u = new URL(e.url);
        domains.add(u.hostname);
      } catch (err) {
        // ignore parse errors
      }
    });
    domainsEl.textContent = String(domains.size);

    // Monitoring duration
    if (data.startTime) {
      const elapsed = now - data.startTime;
      durationEl.textContent = formatDuration(elapsed);
    } else {
      durationEl.textContent = "0s";
    }

    // Last activity & status
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

// =======================
// API key handling
// =======================

// Load API key from storage
async function loadApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  const input = document.getElementById("api-key-input");
  if (result.openai_api_key) {
    input.value = result.openai_api_key;
    updateApiKeyStatus("✓ API key saved", "success");
  } else {
    updateApiKeyStatus("⚠ API key not set", "warning");
  }
}

// Save API key
document.getElementById("save-api-key").addEventListener("click", async () => {
  const apiKey = document.getElementById("api-key-input").value.trim();
  if (!apiKey) {
    updateApiKeyStatus("Please enter an API key", "error");
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
    const errorMsgs = chatMessages.querySelectorAll(".chat-message-system");
    errorMsgs.forEach((msg) => {
      if (msg.textContent.includes("API key")) {
        msg.remove();
      }
    });
  } catch (error) {
    updateApiKeyStatus(`Error saving: ${error.message}`, "error");
  }
});

function updateApiKeyStatus(message, type) {
  const status = document.getElementById("api-key-status");
  status.textContent = message;
  status.className = type;
}

// =======================
// Traffic stats
// =======================

async function updateTrafficStats() {
  chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      document.getElementById("event-count").textContent =
        "Events: Error loading data";
      return;
    }

    if (response && response.success) {
      const eventCount = response.data.events.length;
      const eventCountEl = document.getElementById("event-count");
      if (eventCountEl) {
        eventCountEl.textContent = `Events: ${eventCount}`;
      }

      // Show message if no events yet
      const statsEl = document.getElementById("traffic-stats");
      if (eventCount === 0) {
        if (statsEl && !statsEl.querySelector(".no-events-msg")) {
          const msg = document.createElement("div");
          msg.className = "no-events-msg";
          msg.style.cssText =
            "font-size: 11px; color: #aaa; margin-top: 8px; font-style: italic;";
          msg.textContent =
            "No traffic collected yet. Navigate or interact with the page to collect data.";
          statsEl.appendChild(msg);
        }
      } else {
        const msg = statsEl?.querySelector(".no-events-msg");
        if (msg) msg.remove();
      }
    } else {
      document.getElementById("event-count").textContent =
        "Events: No data";
    }
  });
}

// =======================
// AI analysis
// =======================

async function analyzeTraffic() {
  if (!currentTabId) return;

  const loading = document.getElementById("loading");
  const results = document.getElementById("analysis-results");
  const error = document.getElementById("error");

  loading.classList.remove("hidden");
  results.classList.add("hidden");
  error.classList.add("hidden");

  chrome.runtime.sendMessage({ type: "analyze_traffic" }, (response) => {
    loading.classList.add("hidden");

    if (chrome.runtime.lastError) {
      error.textContent = chrome.runtime.lastError.message;
      error.classList.remove("hidden");
      return;
    }

    if (response.error) {
      error.textContent = response.error;
      error.classList.remove("hidden");
      return;
    }

    if (response.success && response.analysis) {
      displayAnalysis(response.analysis, response.metadata);
      results.classList.remove("hidden");
    }
  });
}

document.getElementById("analyze-btn").addEventListener("click", analyzeTraffic);

function displayAnalysis(analysis, metadata) {
  document.getElementById("summary").innerHTML = `
    <h3>Summary</h3>
    <p>${analysis.summary || "No summary available"}</p>
  `;

  document.getElementById("privacy-concerns").innerHTML = `
    <h3>Privacy Concerns</h3>
    <p>${
      analysis.privacyConcerns ||
      "No specific privacy concerns identified"
    }</p>
  `;

  document.getElementById("security-concerns").innerHTML = `
    <h3>Security Concerns</h3>
    <p>${
      analysis.securityConcerns ||
      "No specific security concerns identified"
    }</p>
  `;

  document.getElementById("recommendations").innerHTML = `
    <h3>Recommendations</h3>
    <p>${analysis.recommendations || "No specific recommendations"}</p>
  `;

  if (metadata) {
    const eventCountEl = document.getElementById("event-count");
    if (eventCountEl) {
      eventCountEl.textContent = `Events: ${metadata.totalEvents}`;
    }
  }
}

// =======================
// Clear traffic data
// =======================

function clearTrafficData() {
  chrome.runtime.sendMessage({ type: "clear_traffic_data" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      return;
    }
    updateTrafficStats();
    refreshTrafficSummary();
    document
      .getElementById("analysis-results")
      .classList.add("hidden");
    const msg = document.querySelector(".no-events-msg");
    if (msg) msg.remove();
  });
}

// =======================
// Popup init
// =======================

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.url) return;

  currentTabId = tab.id;
  const url = tab.url;
  document.getElementById("url").textContent = url;

  loadApiKey();
  updateTrafficStats();
  refreshTrafficSummary();

  // Update stats every 2 seconds
  setInterval(() => {
    updateTrafficStats();
    refreshTrafficSummary();
  }, 2000);

  // Attach clear button listener
  document
    .getElementById("clear-btn")
    .addEventListener("click", clearTrafficData);

  // Reload page button
  document.getElementById("reload-btn").addEventListener("click", () => {
    chrome.tabs.reload(currentTabId, () => {
      setTimeout(() => {
        updateTrafficStats();
        refreshTrafficSummary();
      }, 1000);
    });
  });

  document
    .getElementById("create-ai-prompt-btn")
    .addEventListener("click", createAIPrompt);

  // Test webRequest API
  chrome.runtime.sendMessage({ type: "test_webrequest" }, (response) => {
    if (response && response.status) {
      console.log("webRequest test:", response.status);
    }
  });

  // Chat interface
  setupChatInterface();

  // Traffic data viewer
  setupTrafficDataViewer();
});

// =======================
// Traffic data viewer
// =======================

function setupTrafficDataViewer() {
  const viewBtn = document.getElementById("view-data-btn");
  const closeBtn = document.getElementById("close-data-viewer");
  const viewer = document.getElementById("traffic-data-viewer");
  const content = document.getElementById("traffic-data-content");
  const exportBtn = document.getElementById("export-data-btn");
  const autoScroll = document.getElementById("auto-scroll");

  viewBtn.addEventListener("click", () => {
    viewer.classList.remove("hidden");
    updateTrafficDataView();
    // Auto-update every second
    const interval = setInterval(() => {
      if (!viewer.classList.contains("hidden")) {
        updateTrafficDataView();
      } else {
        clearInterval(interval);
      }
    }, 1000);
  });

  closeBtn.addEventListener("click", () => {
    viewer.classList.add("hidden");
  });

  exportBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
      if (response && response.success) {
        const dataStr = JSON.stringify(response.data, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `traffic-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  });

  function updateTrafficDataView() {
    chrome.runtime.sendMessage({ type: "get_traffic_data" }, (response) => {
      if (response && response.success && response.data.events) {
        const events = response.data.events;
        content.innerHTML = "";

        if (events.length === 0) {
          content.innerHTML =
            "<div style='padding: 20px; text-align: center; color: #aaa;'>No traffic data collected yet.</div>";
          return;
        }

        events.forEach((event, index) => {
          const eventDiv = document.createElement("div");
          eventDiv.className = "traffic-event";
          eventDiv.innerHTML = `
            <div class="traffic-event-header">
              <span class="traffic-event-number">#${index + 1}</span>
              <span class="traffic-event-kind">${
                event.kind || "unknown"
              }</span>
              <span class="traffic-event-time">${new Date(
                event.timestamp || event.time
              ).toLocaleTimeString()}</span>
            </div>
            <div class="traffic-event-details">
              <div class="traffic-event-method">${
                event.method || "N/A"
              }</div>
              <div class="traffic-event-url">${escapeHtml(
                event.url || "N/A"
              )}</div>
              ${
                event.statusCode
                  ? `<div class="traffic-event-status">Status: ${event.statusCode} ${
                      event.statusLine || ""
                    }</div>`
                  : ""
              }
              ${
                event.type
                  ? `<div class="traffic-event-type">Type: ${event.type}</div>`
                  : ""
              }
              ${
                event.fields
                  ? `<div class="traffic-event-fields">Fields: ${JSON.stringify(
                      event.fields,
                      null,
                      2
                    )}</div>`
                  : ""
              }
            </div>
          `;
          content.appendChild(eventDiv);
        });

        // Auto-scroll to bottom if enabled
        if (autoScroll.checked) {
          content.scrollTop = content.scrollHeight;
        }
      }
    });
  }
}

// =======================
// Chat with OpenAI
// =======================

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();

  if (!message) return;

  // Get API key
  const result = await chrome.storage.local.get(["openai_api_key"]);
  const apiKey = result.openai_api_key;

  if (!apiKey) {
    addChatMessage(
      "system",
      "Please set your OpenAI API key first in the settings above."
    );
    return;
  }

  // Add user message to chat
  addChatMessage("user", message);
  input.value = "";

  // Show loading
  const loading = document.getElementById("chat-loading");
  loading.classList.remove("hidden");

  // Get current traffic data for context
  let trafficContext = "";
  chrome.runtime.sendMessage(
    { type: "get_traffic_data" },
    async (response) => {
      if (response && response.success && response.data.events.length > 0) {
        const events = response.data.events.slice(-10); // Last 10 events for context
        trafficContext = `\n\nCurrent web traffic context (last 10 events):\n${JSON.stringify(
          events,
          null,
          2
        )}`;
      }

      // Send to OpenAI
      try {
        const openaiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant that can analyze web traffic and answer questions. Be concise and helpful."
                },
                {
                  role: "user",
                  content: message + trafficContext
                }
              ],
              temperature: 0.7,
              max_tokens: 1000
            })
          }
        );

        loading.classList.add("hidden");

        if (!openaiResponse.ok) {
          const errorData = await openaiResponse.json().catch(() => ({}));
          throw new Error(
            `OpenAI API error: ${openaiResponse.status} - ${
              errorData.error?.message || openaiResponse.statusText
            }`
          );
        }

        const result = await openaiResponse.json();
        const aiMessage =
          result.choices[0]?.message?.content || "No response from AI";
        addChatMessage("assistant", aiMessage);
      } catch (error) {
        loading.classList.add("hidden");
        let errorMsg = error.message;

        if (errorMsg.includes("429")) {
          errorMsg =
            "API quota exceeded. Please check your OpenAI billing and usage limits. You may need to add credits to your account.";
        } else if (errorMsg.includes("401")) {
          errorMsg =
            "Invalid API key. Please check your API key in the settings above.";
        } else if (errorMsg.includes("403")) {
          errorMsg =
            "API access forbidden. Your API key may not have permission or your account may be restricted.";
        }

        addChatMessage("system", `Error: ${errorMsg}`);
      }
    }
  );
}

function addChatMessage(role, content) {
  const messagesContainer = document.getElementById("chat-messages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-message chat-message-${role}`;

  const roleLabel =
    role === "user" ? "You" : role === "assistant" ? "AI" : "System";
  messageDiv.innerHTML = `
    <div class="chat-message-role">${roleLabel}</div>
    <div class="chat-message-content">${escapeHtml(content)}</div>
  `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, "<br>");
}

function setupChatInterface() {
  const sendBtn = document.getElementById("send-chat-btn");
  const input = document.getElementById("chat-input");

  sendBtn.addEventListener("click", sendChatMessage);

  // Send on Enter (but allow Shift+Enter for new line)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Add welcome message
  addChatMessage(
    "system",
    "Hello! I can help you analyze web traffic or answer questions. Type a message below."
  );
}

// =======================
// Prompt generator
// =======================

async function createAIPrompt() {
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      // Create a comprehensive summary
      const summary = {
        currentUrl: currentTab.url,
        totalEvents: events.length,
        monitoringStartTime: new Date(data.startTime).toISOString(),
        eventTypes: {},
        domains: new Set(),
        endpointsByType: {}
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
        ).slice(0, 10); // Limit to top 10
      }

      // Format the prompt
      let prompt = `# Web Traffic Analysis Request

## Context
- **Website URL**: ${currentTab.url}
- **Analysis Start Time**: ${new Date(
        data.startTime
      ).toLocaleString()}
- **Total Events Captured**: ${events.length}
- **Monitoring Duration**: ${Math.round(
        (Date.now() - data.startTime) / 1000 / 60
      )} minutes

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
        if (endpoints.length > 0) {
          prompt += `\n**${type.toUpperCase()}**:\n`;
          endpoints.forEach((endpoint) => {
            prompt += `- ${endpoint}\n`;
          });
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
          prompt += `- **Response**: ${event.statusCode} ${
            event.statusLine || ""
          }\n`;
        }
        if (event.type && event.type !== "other") {
          prompt += `- **Content Type**: ${event.type}\n`;
        }
        if (event.fields) {
          prompt += `- **Form Data**: ${JSON.stringify(
            event.fields,
            null,
            2
          )}\n`;
        }
      });

      // Add statistics
      prompt += `\n## Statistics:\n`;
      prompt += `- Requests per minute: ${(
        events.length / ((Date.now() - data.startTime) / 1000 / 60)
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

      createPromptTab(prompt);
    }
  );
}

function createPromptTab(prompt) {
  const promptHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI Analysis Prompt - Web Traffic Monitor</title>
  <!-- styles omitted here for brevity in this explanation -->
</head>
<body>
  <!-- body content omitted for brevity -->
</body>
</html>`;

  // Create a new tab with the HTML
  chrome.tabs.create({
    url: "data:text/html;charset=utf-8," + encodeURIComponent(promptHtml)
  });
}

function showError(message) {
  const errorDiv = document.getElementById("error");
  errorDiv.textContent = message;
  errorDiv.classList.remove("hidden");
  setTimeout(() => {
    errorDiv.classList.add("hidden");
  }, 5000);
}
