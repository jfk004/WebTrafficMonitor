// content.js - Basic DOM monitoring
console.log('Web Traffic Monitor content script loaded');

// Monitor fetch requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const [url, options] = args;
  console.log('Fetch intercepted:', url);
  
  // Send to background script
  chrome.runtime.sendMessage({
    action: 'logRequest',
    type: 'fetch',
    url: typeof url === 'string' ? url : url.url || 'unknown',
    method: options?.method || 'GET'
  });
  
  return originalFetch.apply(this, args);
};

// Monitor XMLHttpRequest
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  console.log('XHR intercepted:', method, url);
  
  chrome.runtime.sendMessage({
    action: 'logRequest',
    type: 'xhr',
    url: url,
    method: method
  });
  
  return originalXHROpen.apply(this, arguments);
};