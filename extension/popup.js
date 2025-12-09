// popup.js

let currentTabId = null;

// Load API key from storage
async function loadApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  const input = document.getElementById("api-key-input");
  if (result.openai_api_key) {
    input.value = result.openai_api_key;
    updateApiKeyStatus("✓ API key saved", "success");
  } else {
    updateApiKeyStatus("⚠ API key not set", "warning");
    // Auto-fill if provided (for convenience during setup)
    // User can still manually enter it
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
    errorMsgs.forEach(msg => {
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

// Update traffic stats
async function updateTrafficStats() {
  chrome.runtime.sendMessage(
    { type: "get_traffic_data" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        document.getElementById("event-count").textContent = "Events: Error loading data";
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
            msg.style.cssText = "font-size: 11px; color: #aaa; margin-top: 8px; font-style: italic;";
            msg.textContent = "No traffic collected yet. Navigate or interact with the page to collect data.";
            statsEl.appendChild(msg);
          }
        } else {
          const msg = statsEl?.querySelector(".no-events-msg");
          if (msg) msg.remove();
        }
      } else {
        document.getElementById("event-count").textContent = "Events: No data";
      }
    }
  );
}

// Analyze traffic with AI
async function analyzeTraffic() {
  if (!currentTabId) return;
  
  const loading = document.getElementById("loading");
  const results = document.getElementById("analysis-results");
  const error = document.getElementById("error");
  
  loading.classList.remove("hidden");
  results.classList.add("hidden");
  error.classList.add("hidden");
  
  chrome.runtime.sendMessage(
    { type: "analyze_traffic" },
    (response) => {
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
    }
  );
}

document.getElementById("analyze-btn").addEventListener("click", analyzeTraffic);

// Display AI analysis
function displayAnalysis(analysis, metadata) {
  document.getElementById("summary").innerHTML = `
    <h3>Summary</h3>
    <p>${analysis.summary || "No summary available"}</p>
  `;
  
  document.getElementById("privacy-concerns").innerHTML = `
    <h3>Privacy Concerns</h3>
    <p>${analysis.privacyConcerns || "No specific privacy concerns identified"}</p>
  `;
  
  document.getElementById("security-concerns").innerHTML = `
    <h3>Security Concerns</h3>
    <p>${analysis.securityConcerns || "No specific security concerns identified"}</p>
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

// Clear traffic data
function clearTrafficData() {
  chrome.runtime.sendMessage(
    { type: "clear_traffic_data" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      updateTrafficStats();
      document.getElementById("analysis-results").classList.add("hidden");
      const msg = document.querySelector(".no-events-msg");
      if (msg) msg.remove();
    }
  );
}

// Initialize popup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.url) return;

  currentTabId = tab.id;
  const url = tab.url;
  document.getElementById("url").textContent = url;

  loadApiKey();
  updateTrafficStats();
  
  // Update stats every 2 seconds
  setInterval(updateTrafficStats, 2000);
  
  // Attach clear button listener
  document.getElementById("clear-btn").addEventListener("click", clearTrafficData);
  
  // Reload page button
  document.getElementById("reload-btn").addEventListener("click", () => {
    chrome.tabs.reload(currentTabId, () => {
      setTimeout(updateTrafficStats, 1000);
    });
  });
  
  // Test webRequest API
  chrome.runtime.sendMessage({ type: "test_webrequest" }, (response) => {
    if (response && response.status) {
      console.log("webRequest test:", response.status);
    }
  });

  // Chat interface
  setupChatInterface();
});

// Chat with OpenAI
async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();
  
  if (!message) return;
  
  // Get API key
  const result = await chrome.storage.local.get(["openai_api_key"]);
  const apiKey = result.openai_api_key;
  
  if (!apiKey) {
    addChatMessage("system", "Please set your OpenAI API key first in the settings above.");
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
        trafficContext = `\n\nCurrent web traffic context (last 10 events):\n${JSON.stringify(events, null, 2)}`;
      }
      
      // Send to OpenAI
      try {
        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant that can analyze web traffic and answer questions. Be concise and helpful."
              },
              {
                role: "user",
                content: message + trafficContext
              }
            ],
            temperature: 0.7,
            max_tokens: 1000
          })
        });
        
        loading.classList.add("hidden");
        
        if (!openaiResponse.ok) {
          const errorData = await openaiResponse.json().catch(() => ({}));
          throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorData.error?.message || openaiResponse.statusText}`);
        }
        
        const result = await openaiResponse.json();
        const aiMessage = result.choices[0]?.message?.content || "No response from AI";
        addChatMessage("assistant", aiMessage);
      } catch (error) {
        loading.classList.add("hidden");
        let errorMsg = error.message;
        
        // Provide helpful error messages
        if (errorMsg.includes("429")) {
          errorMsg = "API quota exceeded. Please check your OpenAI billing and usage limits. You may need to add credits to your account.";
        } else if (errorMsg.includes("401")) {
          errorMsg = "Invalid API key. Please check your API key in the settings above.";
        } else if (errorMsg.includes("403")) {
          errorMsg = "API access forbidden. Your API key may not have permission or your account may be restricted.";
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
  
  const roleLabel = role === "user" ? "You" : role === "assistant" ? "AI" : "System";
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
  addChatMessage("system", "Hello! I can help you analyze web traffic or answer questions. Type a message below.");
}
