// Test script for Chrome extension API integration
// This script can be run in the browser console to test the API endpoints

class APITester {
  constructor() {
    this.apiBaseUrl = 'https://api.theholylabs.com';
  }

  async testHealthCheck() {
    try {
      console.log('Testing API health check...');
      const response = await fetch(`${this.apiBaseUrl}/api/health`);
      const data = await response.json();
      console.log('Health check result:', data);
      return data;
    } catch (error) {
      console.error('Health check failed:', error);
      return { success: false, error: error.message };
    }
  }

  async testClientRegistration() {
    try {
      console.log('Testing client registration...');
      const clientId = 'test-chrome-ext-' + Date.now();
      const clientData = {
        client_id: clientId,
        device_type: 'desktop',
        proxy_type: 'http',
        country: 'test',
        online: true,
        platform: 'Chrome Extension Test',
        user_agent: navigator.userAgent,
        is_chrome_extension: true,
        capabilities: ['http_proxy'],
        registration_time: Date.now(),
        is_proxy_enabled: false
      };

      const response = await fetch(`${this.apiBaseUrl}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(clientData)
      });

      const data = await response.json();
      console.log('Client registration result:', data);
      return { success: response.ok, data, clientId };
    } catch (error) {
      console.error('Client registration failed:', error);
      return { success: false, error: error.message };
    }
  }

  async testClientStatusUpdate(clientId) {
    try {
      console.log('Testing client status update...');
      const updateData = {
        online: true,
        proxy_type: 'http',
        is_proxy_enabled: true
      };

      const response = await fetch(`${this.apiBaseUrl}/api/clients/${clientId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      const data = await response.json();
      console.log('Client status update result:', data);
      return { success: response.ok, data };
    } catch (error) {
      console.error('Client status update failed:', error);
      return { success: false, error: error.message };
    }
  }

  async testAnalytics() {
    try {
      console.log('Testing analytics endpoint...');
      const response = await fetch(`${this.apiBaseUrl}/api/analytics`);
      const data = await response.json();
      console.log('Analytics result:', data);
      return { success: response.ok, data };
    } catch (error) {
      console.error('Analytics test failed:', error);
      return { success: false, error: error.message };
    }
  }

  async runAllTests() {
    console.log('Starting API integration tests...');
    
    // Test 1: Health check
    const healthResult = await this.testHealthCheck();
    if (!healthResult.firebase_connected) {
      console.error('❌ API health check failed - Firebase not connected');
      return;
    }
    console.log('✅ API health check passed');

    // Test 2: Client registration
    const registrationResult = await this.testClientRegistration();
    if (!registrationResult.success) {
      console.error('❌ Client registration failed');
      return;
    }
    console.log('✅ Client registration passed');
    const clientId = registrationResult.clientId;

    // Test 3: Client status update
    const statusResult = await this.testClientStatusUpdate(clientId);
    if (!statusResult.success) {
      console.error('❌ Client status update failed');
      return;
    }
    console.log('✅ Client status update passed');

    // Test 4: Analytics
    const analyticsResult = await this.testAnalytics();
    if (!analyticsResult.success) {
      console.error('❌ Analytics test failed');
      return;
    }
    console.log('✅ Analytics test passed');

    console.log('🎉 All API integration tests passed!');
  }
}

// Create global instance for easy testing
window.apiTester = new APITester();

// Auto-run tests if this script is loaded
console.log('API Tester loaded. Run apiTester.runAllTests() to test the API integration.');
