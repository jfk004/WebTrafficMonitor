// contentScript.js

console.log("[WebTrafficMonitor] Content script loaded");

// Note: Most traffic is captured via webRequest API in background.js
// This script only captures form submissions and provides fallback for other events.

/* -------------------------------------------------
   Helper: safely send messages to the background
   ------------------------------------------------- */

function safeSendMessage(message, callback) {
  // If the extension is truly gone, bail out early
  if (!chrome.runtime || !chrome.runtime.id) {
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      let msg = "";

      // Protect access to chrome.runtime.lastError – this is where
      // "Extension context invalidated" is usually thrown.
      try {
        if (chrome.runtime && chrome.runtime.lastError) {
          msg = chrome.runtime.lastError.message || "";
        }
      } catch (err) {
        const em = err && err.message ? err.message : String(err);

        // This is the noisy case we want to ignore
        if (em.includes("Extension context invalidated")) {
          return;
        }

        console.error(
          "[WebTrafficMonitor] Error reading chrome.runtime.lastError:",
          em
        );
        return;
      }

      // No error -> run optional callback and exit
      if (!msg) {
        if (typeof callback === "function") {
          callback(response);
        }
        return;
      }

      // Ignore the “normal” noisy cases
      if (
        msg.includes("Extension context invalidated") ||
        msg.includes("Receiving end does not exist")
      ) {
        return;
      }

      console.error(
        "[WebTrafficMonitor] Error sending message from content script:",
        msg
      );

      if (typeof callback === "function") {
        callback(response);
      }
    });
  } catch (err) {
    const em = err && err.message ? err.message : String(err);

    // Also ignore synchronous throws of the same error
    if (em.includes("Extension context invalidated")) {
      return;
    }

    console.error(
      "[WebTrafficMonitor] Exception calling chrome.runtime.sendMessage:",
      em
    );
  }
}

/* -------------------------------------------------
   Listen for messages from injected page script
   ------------------------------------------------- */

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;

  // Accept both old source name and new one
  if (
    !data ||
    (data.source !== "privacy-lens" && data.source !== "webtrafficmonitor")
  ) {
    return;
  }

  console.log("[WebTrafficMonitor] Forwarding event to background:", data.kind);

  safeSendMessage({
    type: "page_event",
    payload: data,
  });
});

/* -------------------------------------------------
   Capture form submissions directly (DOM-only concern)
   ------------------------------------------------- */

document.addEventListener(
  "submit",
  (e) => {
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

      safeSendMessage({
        type: "page_event",
        payload: {
          kind: "form_submit",
          action: form.action || window.location.href,
          method: (form.method || "GET").toUpperCase(),
          fields,
          time: Date.now(),
        },
      });
    } catch (err) {
      console.error("[WebTrafficMonitor] Error capturing form:", err);
    }
  },
  true
);

// Most network traffic (fetch, XHR, beacons, etc.) is captured
// via the webRequest API in background.js. This script only handles
// form submissions and page-level events.
