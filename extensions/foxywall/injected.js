// Proxy Router Extension - Injected Script
// This script is injected into web pages for advanced proxy functionality

(function() {
  'use strict';
  
  console.log('Proxy Router Extension injected script loaded');
  
  // Create a global proxy router object
  window.ProxyRouter = {
    version: '1.0.0',
    isActive: true,
    
    // Method to check if proxy is active
    isProxyActive: function() {
      return this.isActive;
    },
    
    // Method to get proxy status
    getStatus: function() {
      return {
        active: this.isActive,
        version: this.version,
        timestamp: Date.now()
      };
    },
    
    // Method to intercept and modify requests
    interceptRequests: function() {
      // This would contain advanced request interception logic
      console.log('Request interception enabled');
    }
  };
  
  // Add visual indicator to the page
  function addProxyIndicator() {
    if (document.getElementById('proxy-router-injected-indicator')) {
      return; // Already added
    }
    
    const indicator = document.createElement('div');
    indicator.id = 'proxy-router-injected-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: rgba(102, 126, 234, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      z-index: 9999;
      cursor: pointer;
      transition: all 0.3s ease;
      opacity: 0.8;
    `;
    
    indicator.innerHTML = '🌐 Proxy Router';
    
    indicator.addEventListener('mouseenter', function() {
      this.style.opacity = '1';
      this.style.transform = 'scale(1.05)';
    });
    
    indicator.addEventListener('mouseleave', function() {
      this.style.opacity = '0.8';
      this.style.transform = 'scale(1)';
    });
    
    indicator.addEventListener('click', function() {
      // Send message to content script
      window.postMessage({
        type: 'PROXY_ROUTER_CLICK',
        source: 'injected-script'
      }, '*');
    });
    
    document.body.appendChild(indicator);
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.style.opacity = '0.3';
      }
    }, 10000);
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addProxyIndicator);
  } else {
    addProxyIndicator();
  }
  
  // Listen for messages from content script
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'PROXY_ROUTER_STATUS') {
      console.log('Proxy Router status:', event.data.status);
    }
  });
  
})();
