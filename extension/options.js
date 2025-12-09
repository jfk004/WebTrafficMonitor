// options.js
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusDiv = document.getElementById('status');
  
  // Load saved key
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
      showStatus('Loaded saved API key', 'info');
    }
  });
  
  // Save key
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }
    
    chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
      showStatus('API key saved successfully!', 'success');
    });
  });
  
  // Test connection
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }
    
    showStatus('Testing connection to Gemini API...', 'info');
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: 'Say "Connection successful!"' }]
            }]
          })
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        showStatus('✅ Connection successful! Gemini is working.', 'success');
        console.log('Full response:', data);
      } else {
        const errorData = await response.json();
        showStatus(`❌ API Error: ${errorData.error?.message || 'Unknown error'}`, 'error');
        console.error('Error details:', errorData);
      }
    } catch (error) {
      showStatus(`❌ Network error: ${error.message}`, 'error');
      console.error('Network error:', error);
    }
  });
  
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.style.color = type === 'error' ? '#d32f2f' : 
                           type === 'success' ? '#388e3c' : '#1976d2';
    statusDiv.style.fontWeight = 'bold';
  }
});