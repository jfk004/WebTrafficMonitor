// background.js

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Store traffic data per tab
const trafficData = new Map();

// Expose for DevTools debugging
globalThis.trafficData = trafficData;

/* =========================
   GOOGLE TRACKING HELPERS
   ========================= */

function isTrackingParam(key) {
  if (key.startsWith("utm_")) return true;

    const known = [
    "gclid", "gbraid", "wbraid",   // Google Ads IDs
    "fbclid",                      // Facebook click ID
    "ttclid",                      // TikTok click ID
    "igshid",                      // Instagram share ID
    "mc_cid", "mc_eid",            // Mailchimp
    "yclid",                       // Yandex
    "vero_id",
    "msclkid"                      // Microsoft Ads
  ];


  return known.includes(key.toLowerCase());
}

function extractTrackingInfo(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return null; // invalid URL
  }

  const tracking = {};
  url.searchParams.forEach((value, key) => {
    if (isTrackingParam(key)) {
      tracking[key] = value;
    }
  });

  // Build a "clean" URL without tracking params
  const cleanUrl = new URL(url.origin + url.pathname);
  url.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) {
      cleanUrl.searchParams.append(key, value);
    }
  });

  return {
    originalUrl: rawUrl,
    cleanUrl: cleanUrl.toString(),
    trackingParams: tracking,
    destinationOrigin: cleanUrl.origin
  };
}

function handleGoogleRequest(url) {
  const info = extractTrackingInfo(url);
  if (!info) return;

  // Only log if we actually found tracking params
  if (Object.keys(info.trackingParams).length === 0) return;

  chrome.storage.local.get({ googleTrackingLog: [] }, (data) => {
    const log = data.googleTrackingLog || [];

    log.push({
      time: Date.now(),
      ...info
    });

    const MAX = 200;
    while (log.length > MAX) log.shift();

    chrome.storage.local.set({ googleTrackingLog: log });
  });
}

/* =========================
   OPENAI HELPER
   ========================= */

async function getApiKey() {
  const result = await chrome.storage.local.get(["openai_api_key"]);
  return result.openai_api_key || null;
}

/* =========================
   TRAFFIC COLLECTION
   ========================= */

function addTrafficEvent(tabId, event) {
  // Initialize storage for this tab
  if (!trafficData.has(tabId)) {
    trafficData.set(tabId, {
      url: null,
      events: [],
      startTime: Date.now()
    });
  }

  const data = trafficData.get(tabId);

  const fullEvent = {
    ...event,
    timestamp: Date.now()
  };

  data.events.push(fullEvent);

  // Log the event with full details
  console.log(`[WebTrafficMonitor] 📤 OUTGOING REQUEST [Tab ${tabId}]:`, {
    kind: event.kind,
    method: event.method || "N/A",
    url: event.url,
    type: event.type || "N/A",
    time: new Date(fullEvent.timestamp).toLocaleTimeString()
  });

  // Keep only last 200 events per tab to avoid memory issues
  if (data.events.length > 200) {
    data.events = data.events.slice(-200);
  }
}

/* =========================
   OPENAI ANALYSIS
   ========================= */

async function analyzeTrafficWithOpenAI(tabId) {
  const data = trafficData.get(tabId);
  if (!data || data.events.length === 0) {
    return {
      error: "No traffic data collected yet"
    };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      error: "OpenAI API key not configured. Please set it in the extension popup."
    };
  }

  // Prepare traffic summary
  const summary = {
    currentUrl: data.url,
    totalEvents: data.events.length,
    eventTypes: {},
    domains: new Set(),
    timeRange: {
      start: new Date(data.startTime).toISOString(),
      end: new Date().toISOString()
    },
    events: data.events.map((e) => ({
      type: e.kind,
      url: e.url || "N/A",
      method: e.method || "N/A",
      time: new Date(e.timestamp || Date.now()).toISOString()
    }))
  };

  // Count event types and domains
  data.events.forEach((e) => {
    summary.eventTypes[e.kind] = (summary.eventTypes[e.kind] || 0) + 1;
    if (e.url) {
      try {
        const urlObj = new URL(e.url);
        summary.domains.add(urlObj.hostname);
      } catch (_) {
        // ignore URL parse errors
      }
    }
  });

  summary.domains = Array.from(summary.domains);

  // Create prompt for OpenAI
  const prompt = `You are a web security and privacy analyst. Analyze the following web traffic data and provide insights about what the website is doing with user data.

Current URL: ${summary.currentUrl}
Total Events: ${summary.totalEvents}
Event Types: ${JSON.stringify(summary.eventTypes)}
Unique Domains Contacted: ${summary.domains.length}
Domains: ${summary.domains.slice(0, 20).join(", ")}${summary.domains.length > 20 ? " (and more)" : ""}

Recent Traffic Events (last 20):
${JSON.stringify(summary.events.slice(-20), null, 2)}

Please provide:
1. A brief summary of what's happening (2-3 sentences)
2. Privacy concerns (what data might be sent where)
3. Security concerns (any suspicious activity)
4. Recommendations for the user

Format your response as JSON with keys: summary, privacyConcerns, securityConcerns, recommendations.`;

  try {
    const response = await fetch(OPENAI_API_URL, {
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
            content: "You are a web security and privacy analyst. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} - ${
          errorData.error?.message || response.statusText
        }`
      );
    }

    const result = await response.json();
    const content = result.choices[0]?.message?.content || "";

    // Try to parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (_) {
      // If not JSON, treat as plain text
      analysis = {
        summary: content,
        privacyConcerns: "See summary above",
        securityConcerns: "See summary above",
        recommendations: "See summary above"
      };
    }

    return {
      success: true,
      analysis,
      metadata: {
        totalEvents: summary.totalEvents,
        eventTypes: summary.eventTypes,
        domains: summary.domains,
        timestamp: Date.now()
      }
    };
  } catch (error) {
    console.error("OpenAI API error:", error);
    return {
      error: error.message || "Failed to analyze traffic with OpenAI"
    };
  }
}

/* =========================
   MESSAGE HANDLER
   ========================= */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "refresh_prompt") {
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "page_event") {
    // Collect traffic data from content script
    if (tabId !== undefined && tabId !== null) {
      const url = sender.tab?.url;
      if (url && !trafficData.has(tabId)) {
        trafficData.set(tabId, {
          url,
          events: [],
          startTime: Date.now()
        });
      }

      if (trafficData.has(tabId)) {
        trafficData.get(tabId).url = url || trafficData.get(tabId).url;
        addTrafficEvent(tabId, message.payload);
      }
    } else {
      console.warn("Page event received but tab ID is undefined");
    }
    sendResponse({ status: "received" });
    return false;
  }

  if (message.type === "analyze_traffic") {
    (async () => {
      const result = await analyzeTrafficWithOpenAI(tabId);
      sendResponse(result);
    })();
    return true; // async
  }

  if (message.type === "get_traffic_data") {
    (async () => {
      let targetTabId = tabId;

      if (targetTabId === undefined || targetTabId === null) {
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });
          if (tabs.length > 0) {
            targetTabId = tabs[0].id;
          }
        } catch (e) {
          console.error("Error getting active tab:", e);
        }
      }

      const data =
        targetTabId !== undefined && targetTabId !== null
          ? trafficData.get(targetTabId)
          : null;

      sendResponse({
        success: true,
        data: data || { events: [], url: null, startTime: Date.now() }
      });
    })();
    return true;
  }

  if (message.type === "clear_traffic_data") {
    (async () => {
      let targetTabId = tabId;

      if (targetTabId === undefined || targetTabId === null) {
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });
          if (tabs.length > 0) {
            targetTabId = tabs[0].id;
          }
        } catch (e) {
          console.error("Error getting active tab:", e);
        }
      }

      if (targetTabId !== undefined && targetTabId !== null) {
        trafficData.delete(targetTabId);
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === "test_webrequest") {
    const hasWebRequest = typeof chrome.webRequest !== "undefined";
    sendResponse({
      status: hasWebRequest
        ? "webRequest API available"
        : "webRequest API not available",
      hasWebRequest
    });
    return false;
  }
});

/* =========================
   TAB LIFECYCLE HANDLERS
   ========================= */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // 🔁 Every time the tab finishes loading, start a fresh session
    trafficData.set(tabId, {
      url: tab.url,
      events: [],
      startTime: Date.now()
    });

    


    // Inject lightweight PerformanceObserver in the page
    if (
      tab.url &&
      !tab.url.startsWith("chrome://") &&
      !tab.url.startsWith("edge://") &&
      !tab.url.startsWith("chrome-extension://")
    ) {
      try {
        chrome.scripting
          .executeScript({
            target: { tabId },
            func: () => {
              const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  if (entry.entryType === "resource") {
                    window.postMessage(
                      {
                        source: "webtrafficmonitor",
                        kind: "resource",
                        url: entry.name,
                        time: entry.startTime
                      },
                      "*"
                    );
                  }
                }
              });
              try {
                observer.observe({ entryTypes: ["resource"] });
              } catch (_) {
                // PerformanceObserver might not be available
              }
            },
            world: "MAIN"
          })
          .catch(() => {
            // Ignore errors - webRequest will still capture traffic
          });
      } catch (_) {
        // Ignore injection errors
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  trafficData.delete(tabId);
});

/* =========================
   WEBREQUEST LISTENERS
   ========================= */

function setupWebRequestListeners() {
  if (typeof chrome.webRequest === "undefined") {
    console.error(
      "[WebTrafficMonitor] webRequest API not available. Check manifest permissions."
    );
    return false;
  }

  try {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        try {
          const tabId = details.tabId;
          if (tabId === -1) return; // Ignore non-tab requests

          // Skip extension / chrome URLs
          if (
            details.url.startsWith("chrome-extension://") ||
            details.url.startsWith("chrome://") ||
            details.url.startsWith("edge://") ||
            details.url.startsWith("moz-extension://")
          ) {
            return;
          }

          // Detect requests that originate from Google Search
          // const initiator = details.initiator || details.documentUrl || "";
          // if (initiator.startsWith("https://www.google.")) {
            // Triggered by a click/load from Google
            handleGoogleRequest(details.url);
          //}

          // Initialize if needed
          if (!trafficData.has(tabId)) {
            trafficData.set(tabId, {
              url: details.url,
              events: [],
              startTime: Date.now()
            });
          }

          // Add the request event
          addTrafficEvent(tabId, {
            kind: "webrequest",
            url: details.url,
            method: details.method || "GET",
            time: details.timeStamp,
            type: details.type || "other"
          });

        } catch (error) {
          console.error("[WebTrafficMonitor] Error in onBeforeRequest:", error);
        }
      },
      { urls: ["<all_urls>"] },
      [] // observation only
    );

    chrome.webRequest.onCompleted.addListener(
      (details) => {
        try {
          const tabId = details.tabId;
          if (tabId === -1 || !trafficData.has(tabId)) return;

          const data = trafficData.get(tabId);
          // Find matching event by URL (last 10 events for perf)
          for (
            let i = data.events.length - 1;
            i >= Math.max(0, data.events.length - 10);
            i--
          ) {
            if (data.events[i].url === details.url) {
              data.events[i].statusCode = details.statusCode;
              data.events[i].statusLine = details.statusLine;

              console.log(
                `[WebTrafficMonitor] 📥 INCOMING RESPONSE [Tab ${tabId}]:`,
                {
                  url: details.url,
                  statusCode: details.statusCode,
                  statusLine: details.statusLine,
                  method: data.events[i].method || "N/A",
                  time: new Date().toLocaleTimeString()
                }
              );
              break;
            }
          }
        } catch (error) {
          console.error("[WebTrafficMonitor] Error in onCompleted:", error);
        }
      },
      { urls: ["<all_urls>"] },
      []
    );

    console.log("[WebTrafficMonitor] webRequest listeners registered successfully");
    return true;
  } catch (error) {
    console.error("[WebTrafficMonitor] Failed to register webRequest listeners:", error);
    return false;
  }
}

// Initialize webRequest listeners on startup
setupWebRequestListeners();
