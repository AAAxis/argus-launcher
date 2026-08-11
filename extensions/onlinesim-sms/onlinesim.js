const OnlineSim = (() => {
  const SERVICES = [
    { slug: 'facebook', label: 'Facebook' },
    { slug: 'apple', label: 'Apple' },
    { slug: 'google', label: 'Google' },
    { slug: 'aliexpress', label: 'AliExpress' },
    { slug: 'telegram', label: 'Telegram' },
    { slug: 'airbnb', label: 'Airbnb' },
    { slug: 'blizzard', label: 'Blizzard' },
    { slug: 'openai', label: 'OpenAI' },
    { slug: 'craigslist', label: 'Craigslist' },
    { slug: 'cursor', label: 'Cursor' },
    { slug: 'discord', label: 'Discord' },
    { slug: 'uber', label: 'Uber' },
    { slug: 'adidas', label: 'Adidas' },
    { slug: 'adobe', label: 'Adobe' },
    { slug: 'whatsapp', label: 'WhatsApp' },
    { slug: 'instagram', label: 'Instagram' },
    { slug: 'tiktok', label: 'TikTok' },
    { slug: 'snapchat', label: 'Snapchat' },
    { slug: 'paypal', label: 'PayPal' },
    { slug: 'amazon', label: 'Amazon' },
    { slug: 'netflix', label: 'Netflix' },
    { slug: 'microsoft', label: 'Microsoft' },
    { slug: 'yahoo', label: 'Yahoo' },
    { slug: 'linkedin', label: 'LinkedIn' },
    { slug: 'steam', label: 'Steam' },
    { slug: 'tinder', label: 'Tinder' },
    { slug: 'bumble', label: 'Bumble' },
    { slug: 'bolt', label: 'Bolt' },
    { slug: 'grab', label: 'Grab' },
    { slug: 'line', label: 'LINE' },
    { slug: 'viber', label: 'Viber' },
    { slug: 'wechat', label: 'WeChat' },
    { slug: 'vkcom', label: 'VK' },
    { slug: 'signal', label: 'Signal' },
  ];

  const COUNTRIES = [
    { code: '1', name: 'USA' },
    { code: '44', name: 'United Kingdom' },
    { code: '49', name: 'Germany' },
    { code: '33', name: 'France' },
    { code: '39', name: 'Italy' },
    { code: '34', name: 'Spain' },
    { code: '31', name: 'Netherlands' },
    { code: '46', name: 'Sweden' },
    { code: '48', name: 'Poland' },
    { code: '351', name: 'Portugal' },
    { code: '40', name: 'Romania' },
    { code: '420', name: 'Czech Republic' },
    { code: '421', name: 'Slovakia' },
    { code: '43', name: 'Austria' },
    { code: '45', name: 'Denmark' },
    { code: '372', name: 'Estonia' },
    { code: '371', name: 'Latvia' },
    { code: '370', name: 'Lithuania' },
    { code: '380', name: 'Ukraine' },
    { code: '7', name: 'Kazakhstan' },
    { code: '998', name: 'Uzbekistan' },
    { code: '996', name: 'Kyrgyzstan' },
  ];

  const DEFAULTS = {
    onlinesimEnabled: true,
    // No baked-in key: the user enters their own on first launch (see
    // sidepanel.js's showSetupIfNeeded()), with a link to onlinesim.io to
    // get one.
    onlinesimApiKey: '',
    onlinesimService: 'facebook',
    onlinesimCountry: '1',
  };

  async function getConfig() {
    return chrome.storage.local.get(DEFAULTS);
  }

  async function saveConfig(config) {
    const current = await getConfig();
    await chrome.storage.local.set({
      onlinesimEnabled: config.onlinesimEnabled === undefined ? current.onlinesimEnabled : Boolean(config.onlinesimEnabled),
      onlinesimApiKey: config.onlinesimApiKey === undefined ? current.onlinesimApiKey : String(config.onlinesimApiKey || ''),
      onlinesimService: config.onlinesimService === undefined ? current.onlinesimService : String(config.onlinesimService || 'facebook'),
      onlinesimCountry: config.onlinesimCountry === undefined ? current.onlinesimCountry : String(config.onlinesimCountry || '1'),
    });
  }

  function services() {
    return SERVICES;
  }

  function countries() {
    return COUNTRIES;
  }

  function baseParams(config) {
    return new URLSearchParams({
      apikey: config.onlinesimApiKey,
      lang: 'en',
    });
  }

  function paramsFrom(config) {
    const params = baseParams(config);
    if (config.onlinesimCountry) params.set('country', config.onlinesimCountry);
    params.set('service', config.onlinesimService);
    params.set('number', 'true');
    return { path: '/api/getNum.php', params };
  }

  function findPhone(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = value.number || value.phone || value.tel || value.msisdn;
    if (direct) return String(direct);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = findPhone(item);
          if (found) return found;
        }
      } else if (child && typeof child === 'object') {
        const found = findPhone(child);
        if (found) return found;
      }
    }
    return '';
  }

  function findSmsText(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = value.msg || value.message || value.sms || value.text || value.sms_text;
    if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = findSmsText(item);
          if (found) return found;
        }
      } else if (child && typeof child === 'object') {
        const found = findSmsText(child);
        if (found) return found;
      }
    }
    return '';
  }

  function findSmsCode(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = value.code || value.sms_code || value.smsCode;
    if (direct) return String(direct);
    const text = findSmsText(value);
    const match = text.match(/\b\d{4,8}\b/);
    return match ? match[0] : '';
  }

  function findStatus(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = value.status || value.response || value.state;
    if (direct) return String(direct);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const found = findStatus(child);
        if (found) return found;
      }
    }
    return '';
  }

  function findOperationId(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = value.tzid || value.id || value.operation_id || value.operationId;
    if (direct) return String(direct);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const found = findOperationId(child);
        if (found) return found;
      }
    }
    return '';
  }

  function normalizeState(data, operationId = '') {
    const phone = findPhone(data);
    const smsText = findSmsText(data);
    const smsCode = findSmsCode(data);
    const status = findStatus(data);
    return {
      operationId: operationId || findOperationId(data),
      phone,
      smsText,
      smsCode,
      status,
      data,
    };
  }

  async function requestNumber() {
    const config = await getConfig();
    if (!config.onlinesimEnabled) return { skipped: true };
    if (!config.onlinesimApiKey) throw new Error('OnlineSim API key missing.');
    if (!config.onlinesimService) {
      throw new Error('OnlineSim service missing.');
    }

    const request = paramsFrom(config);
    const response = await fetch(`https://onlinesim.io${request.path}?${request.params}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
      cache: 'no-store',
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = { response: raw };
    }

    if (!response.ok) throw new Error(`OnlineSim HTTP ${response.status}`);
    if (typeof data.response === 'string' && /^ERROR|WARNING|NO_|ACCOUNT_|API_/i.test(data.response)) {
      throw new Error(data.response);
    }

    const phone = findPhone(data);
    const operationId = findOperationId(data);
    if (!phone) throw new Error('OnlineSim response did not include a phone number.');

    await chrome.storage.local.set({
      lastOnlineSimNumber: phone,
      lastOnlineSimOperationId: operationId,
      lastOnlineSimResponse: data,
    });

    return { phone, operationId, data };
  }

  async function getState(operationId) {
    const config = await getConfig();
    if (!config.onlinesimApiKey) throw new Error('OnlineSim API key missing.');
    const params = baseParams(config);
    if (operationId) params.set('tzid', operationId);
    params.set('message_to_code', '1');
    params.set('msg_list', '1');
    params.set('orderby', 'desc');

    const response = await fetch(`https://onlinesim.io/api/getState.php?${params}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
      cache: 'no-store',
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = { response: raw };
    }

    if (!response.ok) throw new Error(`OnlineSim HTTP ${response.status}`);
    if (typeof data.response === 'string' && /^ERROR|WARNING|NO_|ACCOUNT_|API_/i.test(data.response)) {
      throw new Error(data.response);
    }

    const state = normalizeState(data, operationId);
    await chrome.storage.local.set({
      lastOnlineSimState: data,
      lastOnlineSimSmsCode: state.smsCode,
      lastOnlineSimSmsText: state.smsText,
      lastOnlineSimStatus: state.status,
    });
    return state;
  }

  return { getConfig, saveConfig, services, countries, requestNumber, getState };
})();
