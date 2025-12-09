// contentScript.js

console.log("[WebTrafficMonitor] Content script loaded");

// Note: Most traffic is captured via webRequest API in background.js
// This script only captures form submissions and provides fallback for other events

// Try to inject hook using chrome.scripting API (CSP-safe)
// This is done from background script when needed
// For now, we'll use a simpler approach that doesn't violate CSP

// Listen for messages from injected page script (if injection succeeds)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  
  // Accept both old source name and new one
  if (!data || (data.source !== "privacy-lens" && data.source !== "webtrafficmonitor")) return;

  console.log("[WebTrafficMonitor] Forwarding event to background:", data.kind);
  
  chrome.runtime.sendMessage({
    type: "page_event",
    payload: data
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[WebTrafficMonitor] Error sending message:", chrome.runtime.lastError);
    }
  });
});

// Capture form submissions directly (doesn't require page injection)
document.addEventListener("submit", (e) => {
  try {
    const form = e.target;
    const fields = {};
    const fd = new FormData(form);
    fd.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower.includes("password") ||
        lower.includes("ssn") ||
        lower.includes("card") ||
        lower.includes("secret")
      ) {
        fields[key] = "<redacted>";
      } else {
        fields[key] = String(value).slice(0, 100);
      }
    });

    chrome.runtime.sendMessage({
      type: "page_event",
      payload: {
        kind: "form_submit",
        action: form.action || window.location.href,
        method: (form.method || "GET").toUpperCase(),
        fields,
        time: Date.now()
      }
    });
  } catch (err) {
    console.error("[WebTrafficMonitor] Error capturing form:", err);
  }
}, true);

// Note: Most network traffic (fetch, XHR, beacons, etc.) is now captured
// via the webRequest API in background.js, which bypasses CSP restrictions.
// This content script only handles form submissions which require DOM access.
