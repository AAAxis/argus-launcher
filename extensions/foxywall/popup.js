// Proxy Router Extension - SOCKS5 Client Only
class SimplePopupController {
  constructor() {
    this.elements = {};
    this.isConnected = false;
    this.isLoading = false;
    this.privacyAccepted = false;
    
    this.init();
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.loadInitialData();
  }

  cacheElements() {
    this.elements = {
      statusText: document.getElementById('statusText'),
      currentIP: document.getElementById('currentIP'),
      ipLabel: document.getElementById('ipLabel'),
      ipRow: document.getElementById('ipRow'),
      connectBtn: document.getElementById('connectBtn'),
      socks5HelpText: document.getElementById('socks5HelpText'),
      loadingOverlay: document.getElementById('loadingOverlay'),
      errorMessage: document.getElementById('errorMessage'),
      errorText: document.getElementById('errorText'),
      closeError: document.getElementById('closeError'),
      privacyPage: document.getElementById('privacyPage'),
      acceptPrivacy: document.getElementById('acceptPrivacy'),
      licenseStatus: document.getElementById('licenseStatus'),
      accountDot: document.getElementById('accountDot'),
      accountPill: document.getElementById('accountPill'),
      hero: document.querySelector('.hero'),
      locationHint: document.getElementById('locationHint'),
      countrySelect: document.getElementById('countrySelect'),
      autoRow: document.getElementById('autoRow'),
      autoFlag: document.getElementById('autoFlag'),
      autoText: document.getElementById('autoText'),
      upgradeSheet: document.getElementById('upgradeSheet'),
      closeUpgrade: document.getElementById('closeUpgrade'),
      buyProBtn: document.getElementById('buyProBtn'),
      upgradeCodeInput: document.getElementById('upgradeCodeInput'),
      applyCodeBtn: document.getElementById('applyCodeBtn'),
      upgradeErr: document.getElementById('upgradeErr'),
      mainContent: document.querySelector('.main-content'),
      container: document.querySelector('.container')
    };
    
    console.log('Cached elements:', this.elements);
  }

  bindEvents() {
    // Auto-connect still runs on launch, but the ring is tappable again so
    // the user can manually reconnect/disconnect on demand.
    if (this.elements.connectBtn) {
      this.elements.connectBtn.addEventListener('click', () => {
        this.toggleConnection();
      });
    }

    // Error close
    if (this.elements.closeError) {
      this.elements.closeError.addEventListener('click', () => {
        this.hideError();
      });
    }

    // Country selection (Pro)
    if (this.elements.countrySelect) {
      this.elements.countrySelect.addEventListener('change', () => {
        this.onCountryChange();
      });
    }

    // Upgrade triggers: Free pill, the "Upgrade" hint, or the locked auto row.
    if (this.elements.accountPill) {
      this.elements.accountPill.addEventListener('click', () => {
        if (!this.isPro) this.openUpgrade();
      });
    }
    if (this.elements.locationHint) {
      this.elements.locationHint.addEventListener('click', () => {
        if (!this.isPro) this.openUpgrade();
      });
    }
    if (this.elements.autoRow) {
      this.elements.autoRow.addEventListener('click', () => {
        if (!this.isPro) this.openUpgrade();
      });
    }
    if (this.elements.closeUpgrade) {
      this.elements.closeUpgrade.addEventListener('click', () => this.closeUpgrade());
    }
    if (this.elements.buyProBtn) {
      this.elements.buyProBtn.addEventListener('click', () => this.buyPro());
    }
    if (this.elements.applyCodeBtn) {
      this.elements.applyCodeBtn.addEventListener('click', () => this.applyCode());
    }
    if (this.elements.upgradeCodeInput) {
      this.elements.upgradeCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.applyCode();
      });
    }

    // Privacy policy buttons
    if (this.elements.acceptPrivacy) {
      this.elements.acceptPrivacy.addEventListener('click', () => {
        this.acceptPrivacyPolicy();
      });
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });

    // The panel now auto-opens the moment a connection attempt *starts*
    // (see background.js's showPanelForActiveWindow), well before
    // connectProxy() resolves a few seconds later -- without this, the
    // popup would load its status once, show "Connecting...", and never
    // learn the attempt actually succeeded (or failed) afterward.
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if ('isConnected' in changes) {
        this.isConnected = changes.isConnected.newValue || false;
        this.updateConnectionStatus();
        void this.getCurrentIP();
      }
    });
  }

  async loadInitialData() {
    try {
      console.log('Loading initial data...');

      // No data collection consent gate: this extension only ever handles
      // proxy connection state and license/account lookups already covered
      // by its own privacy terms, so there's no separate collection to
      // disclose here.
      this.privacyAccepted = true;

      // Load settings
      await this.loadSettings();

      // Load license state (auto-creates the account) then the server list
      await this.loadLicense();
      await this.loadServers();

      // Update UI based on loaded settings
      this.updateConnectionStatus();
      
      // Try to get current IP (works offline with fallback)
      await this.getCurrentIP();
      
    } catch (error) {
      console.error('Error loading initial data:', error);
      // Don't show error, just use defaults
      this.updateConnectionStatus();
    }
  }

  async loadSettings() {
    try {
      console.log('Loading settings from storage...');
      const result = await chrome.storage.local.get(['isConnected']);
      
      // Load settings with defaults
      this.isConnected = result.isConnected || false;
      console.log('Loaded settings:', { isConnected: this.isConnected });
    } catch (error) {
      console.error('Error loading settings:', error);
      // Use defaults if loading fails
      this.isConnected = false;
    }
  }

  async saveSettings() {
    try {
      console.log('Saving settings:', {
        isConnected: this.isConnected
      });
      
      await chrome.storage.local.set({
        isConnected: this.isConnected
      });
      
      console.log('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  async loadLicense() {
    try {
      const result = await this.sendMessage({ action: 'getLicense' });
      this.renderLicense(result);
    } catch (error) {
      console.error('Error loading license:', error);
    }
  }

  renderLicense(result) {
    const ent = result.entitlement || { exists: false, is_pro: false };
    const accountId = result.accountId || null;
    this.accountId = accountId;
    this.isPro = !!ent.is_pro;

    // Header pill: short status + dot colour.
    const pillText = ent.is_pro ? 'Pro' : 'Free';
    const dotState = ent.is_pro ? 'pro' : 'nopro';
    if (this.elements.licenseStatus) this.elements.licenseStatus.textContent = pillText;
    if (this.elements.accountDot) this.elements.accountDot.className = 'account-dot ' + dotState;
  }

  // ── Server / country selection ──────────────────────────────────────────
  async loadServers() {
    try {
      const result = await this.sendMessage({ action: 'getServers' });
      this.renderServers(result || {});
    } catch (error) {
      console.error('Error loading servers:', error);
    }
  }

  renderServers(result) {
    const servers = Array.isArray(result.servers) ? result.servers : [];
    const isPro = !!result.is_pro;
    const selectedId = result.selectedServerId || null;
    const def = servers.find((s) => s.is_default) || servers[0] || null;

    if (isPro) {
      // Pro: dropdown of countries.
      if (this.elements.autoRow) this.elements.autoRow.style.display = 'none';
      if (this.elements.locationHint) this.elements.locationHint.textContent = '';
      const sel = this.elements.countrySelect;
      if (sel) {
        sel.style.display = 'block';
        sel.innerHTML = '';
        servers.forEach((s) => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${this.ccToFlag(s.country_code)}  ${s.country}${s.city ? ' · ' + s.city : ''}`;
          if (s.id === selectedId || (!selectedId && s.is_default)) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    } else {
      // Always free, always the US default server -- shown as a fixed label
      // rather than "Auto" or waiting on an IP lookup (which can be slow or
      // fail outright), since there's nothing to actually pick.
      if (this.elements.countrySelect) this.elements.countrySelect.style.display = 'none';
      if (this.elements.autoRow) this.elements.autoRow.style.display = 'flex';
      if (this.elements.locationHint) this.elements.locationHint.textContent = '';
      if (this.elements.autoFlag) this.elements.autoFlag.textContent = this.ccToFlag((def?.country_code) || 'US');
      if (this.elements.autoText) this.elements.autoText.textContent = def?.country || 'United States';
    }
  }

  async onCountryChange() {
    const serverId = this.elements.countrySelect?.value || null;
    await this.sendMessage({ action: 'setServer', serverId });
    // If already connected, re-dial through the newly chosen country.
    if (this.isConnected) {
      this.showLoading();
      try {
        await this.sendMessage({ action: 'toggleProxy', enabled: true });
        await this.getCurrentIP();
      } finally {
        this.hideLoading();
      }
    }
  }

  // ── Upgrade flow (enter a Pro code, or buy — same link as desktop) ───────
  openUpgrade() {
    if (this.elements.upgradeErr) this.elements.upgradeErr.textContent = '';
    if (this.elements.upgradeCodeInput) this.elements.upgradeCodeInput.value = '';
    if (this.elements.upgradeSheet) this.elements.upgradeSheet.style.display = 'flex';
  }

  closeUpgrade() {
    if (this.elements.upgradeSheet) this.elements.upgradeSheet.style.display = 'none';
  }

  buyPro() {
    // RevenueCat hosted paywall (same as the desktop app). The account id is passed
    // as the RC app_user_id path segment so the purchase ties to this account and its
    // entitlement flips to Pro after checkout.
    const base = 'https://pay.rev.cat/pzcicgzdkqlwadcj/';
    const url = base + encodeURIComponent(this.accountId || '');
    chrome.tabs.create({ url });
  }

  async applyCode() {
    const code = (this.elements.upgradeCodeInput?.value || '').trim().toUpperCase();
    if (!/^VPN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
      if (this.elements.upgradeErr) this.elements.upgradeErr.textContent = 'Code must look like VPN-XXXX-XXXX-XXXX';
      return;
    }
    this.showLoading();
    try {
      const result = await this.sendMessage({ action: 'setAccountId', accountId: code });
      this.renderLicense(result);
      await this.loadServers();
      if (result.entitlement && result.entitlement.is_pro) {
        this.closeUpgrade();
      } else if (result.entitlement && result.entitlement.exists) {
        if (this.elements.upgradeErr) this.elements.upgradeErr.textContent = 'That account has no active Pro subscription.';
      } else {
        if (this.elements.upgradeErr) this.elements.upgradeErr.textContent = 'Account code not found.';
      }
    } catch (e) {
      if (this.elements.upgradeErr) this.elements.upgradeErr.textContent = 'Could not verify the code. Try again.';
    } finally {
      this.hideLoading();
    }
  }

  // ISO 3166-1 alpha-2 → flag emoji (regional indicator pair).
  ccToFlag(cc) {
    if (!cc || cc.length !== 2) return '🌐';
    const base = 0x1f1e6;
    const A = 'A'.charCodeAt(0);
    const up = cc.toUpperCase();
    return String.fromCodePoint(base + (up.charCodeAt(0) - A), base + (up.charCodeAt(1) - A));
  }

  async toggleConnection() {
    if (this.isLoading) return;

    const target = !this.isConnected; // tap toggles current state
    console.log('Connect button → target:', target);

    this.isLoading = true;
    this.showLoading();

    try {
      const result = await this.sendMessage({ action: 'toggleProxy', enabled: target });

      if (result.success) {
        this.isConnected = target;
        await this.saveSettings();
        this.updateConnectionStatus();
        await this.getCurrentIP();
      } else if (result.code && result.code.startsWith('LICENSE_')) {
        await this.loadLicense();
        this.updateConnectionStatus();
        this.showError(result.error || 'A Pro license is required.');
      } else {
        throw new Error(result.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Error toggling proxy connection:', error);
      this.updateConnectionStatus();
      this.showError('Failed to connect: ' + error.message);
    } finally {
      this.isLoading = false;
      this.hideLoading();
    }
  }

  updateConnectionStatus() {
    console.log('Updating connection status, connected:', this.isConnected);

    if (this.elements.statusText) {
      this.elements.statusText.textContent = this.isConnected ? 'Connected' : 'Connecting…';
    }
    if (this.elements.hero) {
      this.elements.hero.classList.toggle('connected', this.isConnected);
    }

    // Ring is tappable again -- colour conveys state, aria-label conveys the
    // available action.
    if (this.elements.connectBtn) {
      this.elements.connectBtn.classList.toggle('connected', this.isConnected);
      this.elements.connectBtn.setAttribute(
        'aria-label', this.isConnected ? 'Disconnect' : 'Connect'
      );
    }

    if (this.elements.socks5HelpText) {
      this.elements.socks5HelpText.textContent = this.isConnected
        ? 'Connected to your FoxyWall proxy'
        : 'Securing your connection automatically -- tap to retry';
    }
  }

  async getCurrentIP() {
    try {
      // Try backend network-info endpoint first
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/network-info`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.network_info) {
            const networkInfo = data.network_info;
            const ip = networkInfo.public_ip || networkInfo.client_ip;
            const country = networkInfo.country;

            if (this.elements.currentIP) {
              this.elements.currentIP.textContent = ip || 'Unknown';
            }

            // Update country if we have that element
            if (country && country !== 'Unknown') {
              console.log(`Detected country: ${country}`);
            }
            
            return; // Success, exit
          }
        }
      } catch (error) {
        console.log('Backend network-info failed, trying fallback services:', error);
      }
      
      // Fallback to external IP services
      const ipServices = [
        'https://api.ipify.org?format=json',
        'https://ipapi.co/json/',
        'https://api.myip.com',
        'https://httpbin.org/ip'
      ];
      
      for (const service of ipServices) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(service, { 
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Chrome Extension)'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            const ip = data.ip || data.query || data.origin;

            if (ip) {
              this.setLocationIp(ip);
              console.log(`IP detected from ${service}: ${ip}`);
              return; // Success, exit
            }
          }
        } catch (error) {
          console.log(`Failed to get IP from ${service}:`, error.message);
          continue; // Try next service
        }
      }

      // All lookup services failed -- hide the row rather than show a
      // contradictory "Offline"/"Error" next to an otherwise-Connected state.
      if (this.elements.ipRow) {
        this.elements.ipRow.style.display = 'none';
      }

    } catch (error) {
      console.error('Error getting current IP:', error);
      if (this.elements.ipRow) {
        this.elements.ipRow.style.display = 'none';
      }
    }
  }

  // Was called above but never defined -- every successful IP lookup threw,
  // got silently swallowed by that loop's own per-service catch, and fell
  // through to "hide the row" even when a service had just returned a valid
  // IP. Restores the row's visibility too, in case an earlier failed attempt
  // (e.g. before the proxy finished connecting) had already hidden it.
  setLocationIp(ip) {
    if (this.elements.currentIP) {
      this.elements.currentIP.textContent = ip;
    }
    if (this.elements.ipRow) {
      this.elements.ipRow.style.removeProperty('display');
    }
  }

  async sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  handleMessage(message) {
    switch (message.action) {
      case 'connectionStatusChanged':
        this.isConnected = message.connected;
        this.updateConnectionStatus();
        break;
      case 'ipChanged':
        if (this.elements.currentIP) {
          this.elements.currentIP.textContent = message.ip;
        }
        break;
    }
  }

  showLoading() {
    if (this.elements.loadingOverlay) {
      this.elements.loadingOverlay.style.display = 'flex';
    }
  }

  hideLoading() {
    if (this.elements.loadingOverlay) {
      this.elements.loadingOverlay.style.display = 'none';
    }
  }

  showError(message) {
    if (this.elements.errorMessage && this.elements.errorText) {
      this.elements.errorText.textContent = message;
      this.elements.errorMessage.style.display = 'flex';
    }
  }

  hideError() {
    if (this.elements.errorMessage) {
      this.elements.errorMessage.style.display = 'none';
    }
  }

  async checkPrivacyAccepted() {
    try {
      const result = await chrome.storage.local.get(['privacyAccepted']);
      return result.privacyAccepted || false;
    } catch (error) {
      console.error('Error checking privacy acceptance:', error);
      return false;
    }
  }

  showPrivacyPage() {
    if (this.elements.privacyPage) {
      this.elements.privacyPage.style.display = 'block';
    }
    if (this.elements.mainContent) {
      this.elements.mainContent.style.display = 'none';
    }
  }

  async acceptPrivacyPolicy() {
    try {
      await chrome.storage.local.set({ privacyAccepted: true });
      this.privacyAccepted = true;
      
      if (this.elements.privacyPage) {
        this.elements.privacyPage.style.display = 'none';
      }
      if (this.elements.mainContent) {
        this.elements.mainContent.style.display = 'block';
      }
      
      // Reload data after accepting privacy policy
      await this.loadInitialData();
    } catch (error) {
      console.error('Error accepting privacy policy:', error);
    }
  }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing popup controller');
  new SimplePopupController();
});