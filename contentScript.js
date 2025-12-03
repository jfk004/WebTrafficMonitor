// contentScript.js

//Detect if the page likely contains a login form
function scanForCredentials() {
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length === 0) return;

  const forms = new Set();
  passwordInputs.forEach(input => {
    if (input.form) forms.add(input.form);
  });

  const formSummaries = Array.from(forms).map(form => {
    const fields = Array.from(form.elements)
      .filter(el => el.name || el.type)
      .map(el => ({
        name: el.name || '',
        type: el.type || '',
        placeholder: el.placeholder || ''
      }));
    return { action: form.action || window.location.href, fields };
  });

  chrome.runtime.sendMessage({
    type: "CREDENTIAL_FORM_DETECTED",
    payload: {
      url: window.location.href,
      title: document.title,
      forms: formSummaries
    }
  });
}

// Observe DOM changes to catch dynamically injected login modals
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes.length > 0) {
      scanForCredentials();
      break;
    }
  }
});

observer.observe(document.documentElement || document.body, {
  childList: true,
  subtree: true
});

// Initial scan
scanForCredentials();
