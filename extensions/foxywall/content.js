// Proxy Router Extension - Content Script
// This script runs in the context of web pages

console.log('Proxy Router Extension content script loaded');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectProxy') {
    // Inject proxy functionality into the page
    injectProxyFunctionality();
    sendResponse({ success: true });
  }
});

function injectProxyFunctionality() {
  // Create a floating proxy indicator
  const indicator = document.createElement('div');
  indicator.id = 'proxy-router-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    cursor: pointer;
    transition: all 0.3s ease;
  `;
  
  indicator.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="width: 8px; height: 8px; background: #4CAF50; border-radius: 0; animation: pulse 2s infinite;"></div>
      <span>Proxy Router Active</span>
    </div>
    <style>
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    </style>
  `;
  
  // Add click handler to show proxy info
  indicator.addEventListener('click', () => {
    showProxyInfo();
  });
  
  document.body.appendChild(indicator);
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (indicator.parentNode) {
      indicator.style.opacity = '0.7';
    }
  }, 5000);
}

function showProxyInfo() {
  // Remove existing info if any
  const existingInfo = document.getElementById('proxy-router-info');
  if (existingInfo) {
    existingInfo.remove();
    return;
  }
  
  const info = document.createElement('div');
  info.id = 'proxy-router-info';
  info.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 0;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 10001;
    max-width: 300px;
    color: #333;
  `;
  
  info.innerHTML = `
    <div style="margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #333;">Proxy Router Status</h4>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: #666;">Status:</span>
        <span style="color: #4CAF50; font-weight: 500;">Active</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: #666;">Mode:</span>
        <span style="color: #333;">Chrome Extension</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: #666;">Server:</span>
        <span style="color: #333; font-family: monospace; font-size: 11px;">api.theholylabs.com</span>
      </div>
    </div>
    <div style="border-top: 1px solid #e0e0e0; padding-top: 8px;">
      <p style="margin: 0; color: #666; font-size: 11px;">
        Your traffic is being routed through the distributed proxy network.
        Click the extension icon to manage settings.
      </p>
    </div>
  `;
  
  document.body.appendChild(info);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (info.parentNode) {
      info.remove();
    }
  }, 10000);
}

// Intercept fetch requests to add proxy headers
const originalFetch = window.fetch;
window.fetch = function(...args) {
  // Add proxy headers to requests
  const [url, options = {}] = args;
  
  if (options.headers) {
    options.headers['X-Proxy-Router'] = 'chrome-extension';
    options.headers['X-Proxy-Client'] = 'true';
  } else {
    options.headers = {
      'X-Proxy-Router': 'chrome-extension',
      'X-Proxy-Client': 'true'
    };
  }
  
  return originalFetch.apply(this, args);
};

// Intercept XMLHttpRequest to add proxy headers
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...args) {
  this._proxyUrl = url;
  return originalXHROpen.apply(this, [method, url, ...args]);
};

const originalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(data) {
  if (this._proxyUrl) {
    this.setRequestHeader('X-Proxy-Router', 'chrome-extension');
    this.setRequestHeader('X-Proxy-Client', 'true');
  }
  return originalXHRSend.apply(this, [data]);
};

console.log('Proxy Router Extension content script ready');
