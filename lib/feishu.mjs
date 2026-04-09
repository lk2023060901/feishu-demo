import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  buildCookieStringFromCookies,
  mergeCookieString,
  normalizeText,
  parseJsonResponse,
  pickCookieValue,
  sleep,
  withTimeout,
} from './common.mjs';
import { launchBrowser } from './playwright.mjs';
import { renderQrPngDataUrl } from './qr.mjs';
import { resolveAvatarPath } from './runtime-deps.mjs';

const FEISHU_ACCOUNTS_BASE_URL = 'https://accounts.feishu.cn';
const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn';
const FEISHU_PASSPORT_BASE_URL = 'https://passport.feishu.cn';
const FEISHU_API_BASE_URL = `${FEISHU_OPEN_BASE_URL}/developers/v1`;
const FEISHU_IM_API_BASE_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/im/v1`;
const FEISHU_TENANT_ACCESS_TOKEN_URL = `${FEISHU_OPEN_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`;
const FEISHU_APP_LIST_URL = `${FEISHU_OPEN_BASE_URL}/app`;
const FEISHU_LOGIN_URL = `${FEISHU_ACCOUNTS_BASE_URL}/accounts/page/login?app_id=7&force_login=1&no_trap=1&redirect_uri=${encodeURIComponent(`${FEISHU_OPEN_BASE_URL}/`)}`;
const FEISHU_QR_POLLING_STEP = 'qr_login_polling';
const FEISHU_EVENT_MODE_WEBSOCKET = 4;
const FEISHU_EVENT_FORMAT_V2 = 1;
const FEISHU_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const DEFAULT_APP_DESCRIPTION = 'Created by feishu-demo';
const DEFAULT_WELCOME_MESSAGE = '欢迎使用你的新机器人，创建与发布已经完成。';
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const AUTH_CAPTURE_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;
const WELCOME_MESSAGE_TIMEOUT_MS = 10_000;
const WELCOME_MESSAGE_RETRY_COUNT = 3;
const FEISHU_QR_TTL_MS = 60_000;

const FEISHU_REQUIRED_EVENT_NAMES = [
  'im.chat.member.bot.added_v1',
  'im.chat.member.bot.deleted_v1',
  'im.message.message_read_v1',
  'im.message.receive_v1',
];

const REQUIRED_APP_SCOPE_NAMES = [
  'contact:contact.base:readonly',
  'docx:document:readonly',
  'im:chat:read',
  'im:chat:update',
  'im:message.group_at_msg:readonly',
  'im:message.p2p_msg:readonly',
  'im:message.reactions:read',
  'im:message:readonly',
  'im:message:recall',
  'im:message:send_as_bot',
  'im:message:send_multi_users',
  'im:message:send_sys_msg',
  'im:message:update',
  'im:resource',
  'application:application:self_manage',
  'cardkit:card:write',
  'cardkit:card:read',
];

const REQUESTED_SCOPE_NAMES = [
  'bitable:app',
  'bitable:app:readonly',
  'cardkit:card:read',
  'cardkit:card:write',
  'cardkit:template:read',
  'contact:contact.base:readonly',
  'contact:user.base:readonly',
  'docx:document',
  'docx:document.block:convert',
  'docx:document:readonly',
  'drive:drive',
  'drive:drive:readonly',
  'im:chat:readonly',
  'im:datasync.feed_card.time_sensitive:write',
  'im:message',
  'im:message.group_at_msg:readonly',
  'im:message.group_msg',
  'im:message.p2p_msg:readonly',
  'im:message.reactions:read',
  'im:message:readonly',
  'im:message:recall',
  'im:message:send_as_bot',
  'im:message:update',
  'im:resource',
  'task:task:read',
  'task:task:write',
  'wiki:wiki',
  'wiki:wiki:readonly',
];

const SCOPE_NAME_ALIASES = {
  'bitable:app': [
    'base:app:copy',
    'base:app:create',
    'base:app:read',
    'base:app:update',
    'base:field:create',
    'base:field:delete',
    'base:field:read',
    'base:field:update',
    'base:record:create',
    'base:record:delete',
    'base:record:retrieve',
    'base:record:update',
    'base:table:create',
    'base:table:delete',
    'base:table:read',
    'base:table:update',
    'base:view:read',
    'base:view:write_only',
  ],
  'bitable:app:readonly': [
    'base:app:read',
    'base:field:read',
    'base:record:retrieve',
    'base:table:read',
    'base:view:read',
  ],
  'docx:document': [
    'docx:document:create',
    'docx:document:readonly',
    'docx:document:write_only',
  ],
  'drive:drive': [
    'drive:drive.metadata:readonly',
    'drive:file:download',
    'drive:file:upload',
    'space:document:delete',
    'space:document:move',
    'space:document:retrieve',
  ],
  'drive:drive:readonly': [
    'drive:drive.metadata:readonly',
    'space:document:retrieve',
  ],
  'im:chat:readonly': ['im:chat:read'],
  'task:task:write': ['task:task:write', 'task:task:writeonly'],
  'wiki:wiki': [
    'wiki:node:copy',
    'wiki:node:create',
    'wiki:node:move',
    'wiki:node:read',
    'wiki:node:retrieve',
    'wiki:space:read',
    'wiki:space:retrieve',
    'wiki:space:write_only',
  ],
  'wiki:wiki:readonly': [
    'wiki:node:read',
    'wiki:node:retrieve',
    'wiki:space:read',
    'wiki:space:retrieve',
  ],
};

const FALLBACK_SCOPE_IDS = {
  'application:application:self_manage': '8108',
  'base:app:copy': '1014365',
  'base:app:create': '1014381',
  'base:app:read': '1014379',
  'base:app:update': '1014380',
  'base:field:create': '1014368',
  'base:field:delete': '1014374',
  'base:field:read': '1014373',
  'base:field:update': '1014375',
  'base:record:create': '1014367',
  'base:record:delete': '1014370',
  'base:record:retrieve': '1014369',
  'base:record:update': '1014371',
  'base:table:create': '1014378',
  'base:table:delete': '1014376',
  'base:table:read': '1014366',
  'base:table:update': '1014377',
  'base:view:read': '1014392',
  'base:view:write_only': '1014393',
  'cardkit:card:read': '1014131',
  'cardkit:card:write': '1014132',
  'contact:contact.base:readonly': '100032',
  'contact:user.base:readonly': '14',
  'docx:document:create': '1013971',
  'docx:document:readonly': '41003',
  'docx:document:write_only': '1014878',
  'drive:drive.metadata:readonly': '26004',
  'drive:file:download': '1013982',
  'drive:file:upload': '101589',
  'im:chat:read': '1014181',
  'im:chat:update': '1014179',
  'im:message': '20001',
  'im:message.group_at_msg:readonly': '3001',
  'im:message.group_msg': '20012',
  'im:message.p2p_msg:readonly': '3000',
  'im:message.reactions:read': '1014176',
  'im:message:readonly': '20008',
  'im:message:recall': '20006',
  'im:message:send_as_bot': '1000',
  'im:message:send_multi_users': '1005',
  'im:message:send_sys_msg': '1014165',
  'im:message:update': '20004',
  'im:resource': '20009',
  'space:document:delete': '101596',
  'space:document:move': '101591',
  'space:document:retrieve': '101595',
  'task:task:read': '16201',
  'task:task:write': '16202',
  'task:task:writeonly': '1014840',
  'wiki:node:copy': '1014344',
  'wiki:node:create': '1014345',
  'wiki:node:move': '1014343',
  'wiki:node:read': '1014354',
  'wiki:node:retrieve': '1014346',
  'wiki:space:read': '1014353',
  'wiki:space:retrieve': '1014352',
  'wiki:space:write_only': '1014355',
};

function buildQrContentFromToken(token) {
  return JSON.stringify({ qrlogin: { token } });
}

function parseCookieString(cookieString) {
  const cookies = [];
  for (const pair of String(cookieString || '').split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }
    cookies.push({
      name: trimmed.slice(0, index).trim(),
      value: trimmed.slice(index + 1).trim(),
    });
  }
  return cookies;
}

async function seedFeishuContext(context, auth) {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const cookies = parseCookieString(auth.cookieString).map((cookie) => ({
    domain: '.feishu.cn',
    expires,
    httpOnly: false,
    name: cookie.name,
    path: '/',
    sameSite: 'Lax',
    secure: true,
    value: cookie.value,
  }));

  if (cookies.length) {
    await context.addCookies(cookies);
  }
}

function buildFeishuHeaders(auth, referer, contentType = 'application/json', origin = FEISHU_OPEN_BASE_URL) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Cookie: auth.cookieString,
    Origin: origin,
    Referer: referer,
    'User-Agent': FEISHU_USER_AGENT,
    'X-Requested-With': 'XMLHttpRequest',
    'x-csrf-token': auth.csrfToken,
    'x-timezone-offset': '-480',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

async function fetchJsonWithTimeout(input, init, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(response, label);
    if (!response.ok) {
      throw new Error(`Feishu request failed for ${label}: HTTP ${response.status}`);
    }
    return { payload, response };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function openPlatformApi(auth, pathName, options = {}) {
  const {
    body = {},
    method = 'POST',
    referer = FEISHU_APP_LIST_URL,
  } = options;

  const { payload } = await fetchJsonWithTimeout(
    `${FEISHU_API_BASE_URL}${pathName}`,
    {
      method,
      headers: buildFeishuHeaders(auth, referer),
      body: method === 'GET' ? undefined : JSON.stringify(body),
    },
    pathName,
  );

  if (payload.code !== 0) {
    throw new Error(`Feishu API error for ${pathName}: code=${String(payload.code)} msg=${String(payload.msg || '')}`);
  }
  return payload;
}

async function suiteAdminApi(auth, suiteOrigin, pathName, options = {}) {
  const {
    body = undefined,
    method = 'GET',
    referer = `${suiteOrigin}/admin/index`,
  } = options;

  const { payload } = await fetchJsonWithTimeout(
    `${suiteOrigin}${pathName}`,
    {
      method,
      headers: buildFeishuHeaders(auth, referer, 'application/json', suiteOrigin),
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    pathName,
  );

  if (payload.code !== 0) {
    throw new Error(`Feishu suite admin error for ${pathName}: code=${String(payload.code)} msg=${String(payload.message || payload.msg || '')}`);
  }
  return payload;
}

async function getRelevantCookies(context) {
  return await context.cookies([
    FEISHU_ACCOUNTS_BASE_URL,
    FEISHU_OPEN_BASE_URL,
    FEISHU_PASSPORT_BASE_URL,
  ]);
}

async function canAccessOpenPlatform(context) {
  const cookies = await getRelevantCookies(context);
  if (!cookies.length) {
    return false;
  }
  const cookieHeader = buildCookieStringFromCookies(cookies);
  const response = await fetch(FEISHU_APP_LIST_URL, {
    headers: {
      Cookie: cookieHeader,
      'User-Agent': FEISHU_USER_AGENT,
    },
    redirect: 'follow',
  });
  return response.ok && response.url.startsWith(`${FEISHU_OPEN_BASE_URL}/app`);
}

async function ensureOpenPlatformPage(page) {
  const listResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'POST'
      && response.url().includes('/developers/v1/app/list');
  }, { timeout: 60_000 });

  await page.goto(FEISHU_APP_LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/open\.feishu\.cn\/app/u, { timeout: 60_000 });
  const listResponse = await listResponsePromise;
  const requestHeaders = listResponse.request().headers();
  const reusableHeaders = {};

  for (const [key, value] of Object.entries(requestHeaders)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'accept'
      || lowerKey === 'content-type'
      || lowerKey === 'x-requested-with'
      || lowerKey.startsWith('x-')
    ) {
      reusableHeaders[key] = value;
    }
  }

  return {
    reusableHeaders,
  };
}

async function browserJsonFetch(page, url, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    headers = {},
    referrer = undefined,
  } = options;

  const result = await page.evaluate(async ({ body, headers, method, referrer, url: requestUrl }) => {
    const response = await fetch(requestUrl, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      referrer,
    });

    return {
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, {
    body,
    headers,
    method,
    referrer,
    url,
  });

  let json = null;
  if (result.text) {
    try {
      json = JSON.parse(result.text);
    } catch {
      json = null;
    }
  }

  return {
    ...result,
    json,
  };
}

async function browserFormDataFetch(page, url, options = {}) {
  const {
    base64 = '',
    fileName = 'bot-avatar.png',
    headers = {},
    mimeType = 'image/png',
    referrer = undefined,
  } = options;

  return await page.evaluate(async ({ base64, fileName, headers, mimeType, referrer, url: requestUrl }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const formData = new FormData();
    formData.append('file', new Blob([bytes], { type: mimeType }), fileName);
    formData.append('uploadType', '4');
    formData.append('isIsv', 'false');
    formData.append('scale', JSON.stringify({ width: 240, height: 240 }));

    const response = await fetch(requestUrl, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
      referrer,
    });

    return {
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, {
    base64,
    fileName,
    headers,
    mimeType,
    referrer,
    url,
  });
}

async function openPlatformPageApi(page, pathName, options = {}, baseHeaders = {}) {
  const requestUrl = `${FEISHU_OPEN_BASE_URL}${pathName}`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...baseHeaders,
    ...(options.headers || {}),
  };

  const response = await browserJsonFetch(page, requestUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Feishu request failed for ${pathName}: HTTP ${response.status} body=${response.text.slice(0, 300)}`);
  }
  if (response.json?.code !== 0) {
    throw new Error(`Feishu API error for ${pathName}: code=${String(response.json?.code)} msg=${String(response.json?.msg || '')}`);
  }

  return response.json;
}

async function suiteAdminPageApi(page, suiteOrigin, pathName, baseHeaders = {}, options = {}) {
  const requestUrl = `${suiteOrigin}${pathName}`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...baseHeaders,
    ...(options.headers || {}),
  };

  const response = await browserJsonFetch(page, requestUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Feishu suite request failed for ${pathName}: HTTP ${response.status} body=${response.text.slice(0, 300)}`);
  }
  if (response.json?.code !== 0) {
    throw new Error(`Feishu suite API error for ${pathName}: code=${String(response.json?.code)} msg=${String(response.json?.message || response.json?.msg || '')}`);
  }

  return response.json;
}

async function withFeishuBrowserSession(auth, callback) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent: FEISHU_USER_AGENT,
  });

  try {
    await seedFeishuContext(context, auth);
    const page = await context.newPage();
    const session = await ensureOpenPlatformPage(page);
    return await callback({
      browser,
      context,
      page,
      reusableHeaders: session.reusableHeaders,
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function activateQrLogin(page) {
  return await page.evaluate(() => {
    const selectors = [
      '.switch-login-mode-box',
      '[class*="switch-login-mode"]',
      '[class*="qrcode-switch"]',
      '[class*="qr-switch"]',
      '[class*="scan-switch"]',
      '[data-testid="qrcode-login"]',
    ];
    const labels = ['扫码登录', '二维码登录', 'Scan QR Code', 'Log In With QR'];
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.offsetParent !== null;
    };
    const tryClick = (node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        return false;
      }
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      node.click();
      return true;
    };

    for (const selector of selectors) {
      if (tryClick(document.querySelector(selector))) {
        return true;
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || '').trim();
      if (labels.some((label) => text.includes(label)) && tryClick(node)) {
        return true;
      }
    }

    return Boolean(
      document.querySelector('[class*="qrcode"]')
      || document.querySelector('[class*="qr-code"]')
      || document.querySelector('canvas'),
    );
  });
}

async function captureRenderedQrFromLoginPage(page) {
  return await page.evaluate(() => {
    const imageSelectors = [
      'img[alt*="QR"]',
      'img[alt*="二维码"]',
      '[class*="qrcode"] img',
      '[class*="qr-code"] img',
      '[class*="scan-QR-code"] img',
    ];
    const canvasSelectors = [
      '[class*="qrcode"] canvas',
      '[class*="qr-code"] canvas',
      '[class*="scan-QR-code"] canvas',
      'canvas',
    ];

    for (const selector of imageSelectors) {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLImageElement)) {
        continue;
      }
      const src = (node.currentSrc || node.src || '').trim();
      if (src.startsWith('data:image/') || src.startsWith('https://') || src.startsWith('http://')) {
        return {
          qrcodeUrl: src,
          summary: `img:${selector}`,
        };
      }
    }

    for (const selector of canvasSelectors) {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLCanvasElement)) {
        continue;
      }
      if (node.width < 64 || node.height < 64) {
        continue;
      }
      try {
        return {
          qrcodeUrl: node.toDataURL('image/png'),
          summary: `canvas:${selector}:${node.width}x${node.height}`,
        };
      } catch {
        // Ignore and continue trying.
      }
    }

    const bodyText = (document.body?.innerText || '').trim();
    const hasQrHints = Boolean(
      document.querySelector('[class*="qrcode"]')
      || document.querySelector('[class*="qr-code"]')
      || document.querySelector('[class*="scan-QR-code"]')
      || bodyText.includes('扫码登录')
      || bodyText.includes('二维码登录')
      || bodyText.includes('Scan QR Code')
      || bodyText.includes('Log In With QR'),
    );

    return {
      qrcodeUrl: null,
      summary: hasQrHints ? 'qr-hints-present-no-exportable-image' : 'qr-not-found',
    };
  });
}

async function waitForLogin(page, onQr, onLog) {
  let lastToken = '';
  let lastQrDataUrl = '';
  let settled = false;
  let resolveLogin;
  let rejectLogin;
  let lastProbeSummary = '';
  let lastActivateAt = 0;
  let qrRefreshCount = 0;

  const publishQr = (dataUrl, sourceLabel) => {
    if (!dataUrl || dataUrl === lastQrDataUrl) {
      return;
    }
    lastQrDataUrl = dataUrl;
    qrRefreshCount += 1;
    if (sourceLabel) {
      onLog?.(sourceLabel);
    }
    onQr?.({
      dataUrl,
      expiresAt: new Date(Date.now() + FEISHU_QR_TTL_MS).toISOString(),
      refreshCount: qrRefreshCount,
    });
  };

  const finishResolve = (reason) => {
    if (settled) {
      return;
    }
    settled = true;
    resolveLogin?.(reason);
  };

  const finishReject = (error) => {
    if (settled) {
      return;
    }
    settled = true;
    rejectLogin?.(error);
  };

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('/accounts/qrlogin/init') && !url.includes('/accounts/qrlogin/polling')) {
      return;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return;
    }

    if (payload?.code !== 0) {
      return;
    }

    if (url.includes('/accounts/qrlogin/init')) {
      const token = payload?.data?.step_info?.token?.trim();
      if (token && token !== lastToken) {
        lastToken = token;
        publishQr(
          renderQrPngDataUrl(buildQrContentFromToken(token)),
          '二维码已刷新，等待飞书扫码确认。',
        );
      }
      return;
    }

    const nextStep = payload?.data?.next_step;
    const status = payload?.data?.step_info?.status;

    if (status === 3) {
      finishReject(new Error('飞书扫码登录已取消。'));
      return;
    }

    if (status === 5) {
      onLog?.('二维码已过期，正在刷新。');
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await activateQrLogin(page).catch(() => {});
      return;
    }

    if ((nextStep && nextStep !== FEISHU_QR_POLLING_STEP) || status === 0) {
      finishResolve('polling-complete');
    }
  };

  page.on('response', onResponse);

  const loginPromise = new Promise((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });

  const navigationPromise = page.waitForURL((url) => {
    const value = url.toString();
    return value.startsWith(`${FEISHU_OPEN_BASE_URL}/`) || /^https:\/\/[^/]+\.feishu\.cn\/admin\//u.test(value);
  }, { timeout: LOGIN_TIMEOUT_MS }).then(() => {
    finishResolve('navigated');
  }).catch(() => {});

  const qrProbeLoop = (async () => {
    while (!settled) {
      try {
        const probe = await captureRenderedQrFromLoginPage(page);
        if (probe?.qrcodeUrl) {
          publishQr(probe.qrcodeUrl, `已从登录页捕获二维码 (${probe.summary})。`);
        } else if (probe?.summary && probe.summary !== lastProbeSummary) {
          lastProbeSummary = probe.summary;
          if (probe.summary === 'qr-not-found' && Date.now() - lastActivateAt > 4_000) {
            lastActivateAt = Date.now();
            await activateQrLogin(page).catch(() => {});
          }
        }
      } catch {
        // Ignore probe failures and continue.
      }
      await sleep(1500);
    }
  })();

  const openPlatformProbe = (async () => {
    while (!settled) {
      try {
        if (await canAccessOpenPlatform(page.context())) {
          finishResolve('open-platform-ready');
          return;
        }
      } catch {
        // Ignore transient probe failures while login is still in progress.
      }
      await sleep(1500);
    }
  })();

  await page.goto(FEISHU_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await activateQrLogin(page).catch(() => {});
  onLog?.('飞书登录页已打开，等待二维码初始化。');

  try {
    await withTimeout(loginPromise, LOGIN_TIMEOUT_MS, '等待飞书扫码确认超时。');
  } finally {
    page.off('response', onResponse);
    await Promise.allSettled([navigationPromise, openPlatformProbe, qrProbeLoop]);
  }
}

async function captureCredentials(page) {
  const context = page.context();
  const deadline = Date.now() + AUTH_CAPTURE_TIMEOUT_MS;
  let lastCookieNames = [];
  let lastWarmupAt = 0;

  while (Date.now() < deadline) {
    if (Date.now() - lastWarmupAt >= 3_000) {
      lastWarmupAt = Date.now();
      await page.goto(FEISHU_APP_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    const cookies = await getRelevantCookies(context);
    lastCookieNames = cookies.map((cookie) => cookie.name).filter(Boolean);
    const sessionCookie = pickCookieValue(cookies, 'session');
    const csrfToken = pickCookieValue(cookies, 'lark_oapi_csrf_token', 'swp_csrf_token');
    const cookieString = buildCookieStringFromCookies(cookies);

    if (sessionCookie && csrfToken && cookieString) {
      return {
        cookieString: mergeCookieString(`lark_oapi_csrf_token=${csrfToken}`, cookieString),
        csrfToken,
        savedAt: Date.now(),
      };
    }

    await sleep(500);
  }

  throw new Error(`登录完成后未能捕获飞书会话凭据，当前 Cookies: ${lastCookieNames.join(', ')}`);
}

function normalizeAppName(name) {
  return normalizeText(name, 'Feishu Bot');
}

function normalizeAppDescription(description) {
  return normalizeText(description, DEFAULT_APP_DESCRIPTION);
}

async function readDefaultAvatar() {
  const avatarPath = resolveAvatarPath();
  if (!avatarPath) {
    return null;
  }
  try {
    return await fs.readFile(avatarPath);
  } catch {
    return null;
  }
}

async function resolveAvatarAsset(avatarAsset) {
  if (avatarAsset?.buffer?.length) {
    return avatarAsset;
  }

  const buffer = await readDefaultAvatar();
  if (!buffer) {
    return null;
  }

  return {
    appearance: null,
    buffer,
    fileName: 'bot-avatar.png',
    mimeType: 'image/png',
  };
}

async function uploadDefaultAvatar(auth) {
  const asset = await resolveAvatarAsset(null);
  if (!asset) {
    return '';
  }

  const formData = new FormData();
  formData.append('file', new Blob([asset.buffer], { type: asset.mimeType }), asset.fileName);
  formData.append('uploadType', '4');
  formData.append('isIsv', 'false');
  formData.append('scale', JSON.stringify({ width: 240, height: 240 }));

  const headers = buildFeishuHeaders(auth, FEISHU_APP_LIST_URL, '');
  delete headers['Content-Type'];

  const { payload } = await fetchJsonWithTimeout(
    `${FEISHU_API_BASE_URL}/app/upload/image`,
    {
      method: 'POST',
      headers,
      body: formData,
    },
    '/app/upload/image',
  );

  if (payload.code !== 0) {
    throw new Error(`飞书上传头像失败: ${String(payload.msg || '')}`);
  }
  return payload.data?.url?.trim() || '';
}

async function uploadAvatarInBrowser(page, reusableHeaders, avatarAsset) {
  const asset = await resolveAvatarAsset(avatarAsset);
  if (!asset) {
    return {
      appliedAppearance: null,
      url: '',
    };
  }

  const headers = {
    Accept: 'application/json, text/plain, */*',
    ...reusableHeaders,
  };
  delete headers['Content-Type'];
  delete headers['content-type'];

  const response = await browserFormDataFetch(page, `${FEISHU_API_BASE_URL}/app/upload/image`, {
    base64: asset.buffer.toString('base64'),
    fileName: asset.fileName,
    headers,
    mimeType: asset.mimeType,
    referrer: FEISHU_APP_LIST_URL,
  });

  if (!response.ok) {
    throw new Error(`飞书上传头像失败: HTTP ${response.status}`);
  }

  const payload = response.text ? JSON.parse(response.text) : {};
  if (payload.code !== 0) {
    throw new Error(`飞书上传头像失败: ${String(payload.msg || '')}`);
  }

  return {
    appliedAppearance: asset.appearance || null,
    url: payload.data?.url?.trim() || '',
  };
}

async function createFeishuApp(auth, name, description, avatar) {
  const payload = await openPlatformApi(auth, '/app/create', {
    body: {
      appSceneType: 0,
      name,
      desc: description,
      avatar,
      i18n: {
        zh_cn: {
          name,
          description,
        },
      },
      primaryLang: 'zh_cn',
    },
  });

  const appId = payload.data?.ClientID?.trim();
  if (!appId) {
    throw new Error('飞书未返回 App ID。');
  }
  return appId;
}

async function createFeishuAppInBrowser(page, reusableHeaders, name, description, avatar) {
  const payload = await openPlatformPageApi(page, '/developers/v1/app/create', {
    method: 'POST',
    body: {
      appSceneType: 0,
      name,
      desc: description,
      avatar,
      i18n: {
        zh_cn: {
          name,
          description,
        },
      },
      primaryLang: 'zh_cn',
    },
    referrer: FEISHU_APP_LIST_URL,
  }, reusableHeaders);

  const appId = payload.data?.ClientID?.trim();
  if (!appId) {
    throw new Error('飞书未返回 App ID。');
  }
  return appId;
}

async function getFeishuAppSecret(auth, appId) {
  const payload = await openPlatformApi(auth, `/secret/${appId}`, {
    body: {},
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`,
  });
  const appSecret = payload.data?.secret?.trim();
  if (!appSecret) {
    throw new Error('飞书未返回 App Secret。');
  }
  return appSecret;
}

async function getFeishuAppSecretInBrowser(page, reusableHeaders, appId) {
  const payload = await openPlatformPageApi(page, `/developers/v1/secret/${appId}`, {
    method: 'POST',
    body: {},
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`,
  }, reusableHeaders);

  const appSecret = payload.data?.secret?.trim();
  if (!appSecret) {
    throw new Error('飞书未返回 App Secret。');
  }
  return appSecret;
}

async function enableFeishuBot(auth, appId) {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await openPlatformApi(auth, `/robot/switch/${appId}`, {
    body: { enable: true },
    referer,
  });
  await openPlatformApi(auth, `/robot/${appId}`, {
    body: {},
    referer,
  });
}

async function enableFeishuBotInBrowser(page, reusableHeaders, appId) {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await openPlatformPageApi(page, `/developers/v1/robot/switch/${appId}`, {
    method: 'POST',
    body: { enable: true },
    referrer: referer,
  }, reusableHeaders);

  await openPlatformPageApi(page, `/developers/v1/robot/${appId}`, {
    method: 'POST',
    body: {},
    referrer: referer,
  }, reusableHeaders);
}

async function fetchAvailableScopes(auth, appId) {
  const payload = await openPlatformApi(auth, `/scope/all/${appId}`, {
    body: {},
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  });
  return Array.isArray(payload.data?.scopes) ? payload.data.scopes : [];
}

async function fetchAvailableScopesInBrowser(page, reusableHeaders, appId) {
  const payload = await openPlatformPageApi(page, `/developers/v1/scope/all/${appId}`, {
    method: 'POST',
    body: {},
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  }, reusableHeaders);

  return Array.isArray(payload.data?.scopes) ? payload.data.scopes : [];
}

function resolveScopeIds(scopes) {
  const scopeIds = new Set();
  const scopeNames = new Map();

  for (const scope of scopes) {
    const name = scope?.name?.trim();
    const id = scope?.id?.trim();
    if (!name || !id) {
      continue;
    }
    if (!scopeNames.has(name)) {
      scopeNames.set(name, new Set());
    }
    scopeNames.get(name).add(id);
  }

  const requestedNames = Array.from(new Set([...REQUESTED_SCOPE_NAMES, ...REQUIRED_APP_SCOPE_NAMES]));
  const unresolvedScopes = [];

  for (const requestedName of requestedNames) {
    const candidateNames = Array.from(new Set([requestedName, ...(SCOPE_NAME_ALIASES[requestedName] || [])]));
    let resolved = false;

    for (const candidateName of candidateNames) {
      const resolvedIds = scopeNames.get(candidateName);
      if (resolvedIds?.size) {
        resolved = true;
        for (const id of resolvedIds) {
          scopeIds.add(id);
        }
        continue;
      }

      const fallbackId = FALLBACK_SCOPE_IDS[candidateName];
      if (fallbackId) {
        resolved = true;
        scopeIds.add(fallbackId);
      }
    }

    if (!resolved) {
      unresolvedScopes.push(requestedName);
    }
  }

  return {
    appScopeIDs: Array.from(scopeIds),
    unresolvedScopes,
  };
}

async function updateFeishuScopes(auth, appId) {
  const availableScopes = await fetchAvailableScopes(auth, appId);
  const resolution = resolveScopeIds(availableScopes);
  if (!resolution.appScopeIDs.length) {
    throw new Error('没有解析到任何飞书权限 ID。');
  }

  await openPlatformApi(auth, `/scope/update/${appId}`, {
    body: {
      appScopeIDs: resolution.appScopeIDs,
      userScopeIDs: [],
      scopeIds: [],
      operation: 'add',
      isDeveloperPanel: true,
    },
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  });

  return resolution.unresolvedScopes;
}

async function updateFeishuScopesInBrowser(page, reusableHeaders, appId) {
  const availableScopes = await fetchAvailableScopesInBrowser(page, reusableHeaders, appId);
  const resolution = resolveScopeIds(availableScopes);
  if (!resolution.appScopeIDs.length) {
    throw new Error('没有解析到任何飞书权限 ID。');
  }

  await openPlatformPageApi(page, `/developers/v1/scope/update/${appId}`, {
    method: 'POST',
    body: {
      appScopeIDs: resolution.appScopeIDs,
      userScopeIDs: [],
      scopeIds: [],
      operation: 'add',
      isDeveloperPanel: true,
    },
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/auth`,
  }, reusableHeaders);

  return resolution.unresolvedScopes;
}

async function updateFeishuEvents(auth, appId) {
  await openPlatformApi(auth, `/event/update/${appId}`, {
    body: {
      operation: 'add',
      events: [],
      appEvents: FEISHU_REQUIRED_EVENT_NAMES,
      userEvents: [],
      eventMode: FEISHU_EVENT_FORMAT_V2,
    },
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/event`,
  });
}

async function updateFeishuEventsInBrowser(page, reusableHeaders, appId) {
  await openPlatformPageApi(page, `/developers/v1/event/update/${appId}`, {
    method: 'POST',
    body: {
      operation: 'add',
      events: [],
      appEvents: FEISHU_REQUIRED_EVENT_NAMES,
      userEvents: [],
      eventMode: FEISHU_EVENT_FORMAT_V2,
    },
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/event`,
  }, reusableHeaders);
}

async function switchFeishuCallbackMode(auth, appId) {
  await openPlatformApi(auth, `/event/switch/${appId}`, {
    body: {
      eventMode: FEISHU_EVENT_MODE_WEBSOCKET,
    },
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/event?tab=callback`,
  });
}

async function switchFeishuCallbackModeInBrowser(page, reusableHeaders, appId) {
  await openPlatformPageApi(page, `/developers/v1/event/switch/${appId}`, {
    method: 'POST',
    body: {
      eventMode: FEISHU_EVENT_MODE_WEBSOCKET,
    },
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/event?tab=callback`,
  }, reusableHeaders);
}

async function getCurrentUserId(auth) {
  const { payload } = await fetchJsonWithTimeout(
    `${FEISHU_PASSPORT_BASE_URL}/accounts/web/user?app_id=7&support_anonymous=0&_t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/json',
        Cookie: auth.cookieString,
        Origin: FEISHU_OPEN_BASE_URL,
        Referer: `${FEISHU_OPEN_BASE_URL}/`,
        'User-Agent': FEISHU_USER_AGENT,
        'X-Api-Version': '1.0.28',
        'X-App-Id': '7',
        'X-Device-Info': 'platform=websdk',
      },
    },
    '/accounts/web/user',
  );

  if (payload.code !== 0) {
    throw new Error(`读取飞书用户信息失败: ${String(payload.msg || '')}`);
  }
  const userId = payload.data?.user?.id?.trim();
  if (!userId) {
    throw new Error('飞书未返回当前用户 ID。');
  }
  return userId;
}

async function createVersionAndPublish(auth, appId, creatorId) {
  const createPayload = await openPlatformApi(auth, `/app_version/create/${appId}`, {
    body: {
      appVersion: '0.0.1',
      mobileDefaultAbility: 'bot',
      pcDefaultAbility: 'bot',
      changeLog: '0.0.1',
      visibleSuggest: {
        departments: [],
        members: [creatorId],
        groups: [],
        isAll: 0,
      },
      applyReasonConfig: {
        apiPrivilegeNeedReason: false,
        contactPrivilegeNeedReason: false,
        dataPrivilegeReasonMap: {},
        visibleScopeNeedReason: false,
        apiPrivilegeReasonMap: {},
        contactPrivilegeReason: '',
        isDataPrivilegeExpandMap: {},
        visibleScopeReason: '',
        dataPrivilegeNeedReason: false,
        isAutoAudit: false,
        isContactExpand: false,
      },
      b2cShareSuggest: false,
      autoPublish: false,
      blackVisibleSuggest: {
        departments: [],
        members: [],
        groups: [],
        isAll: 0,
      },
    },
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/create`,
  });

  const versionId = createPayload.data?.versionId?.trim();
  if (!versionId) {
    throw new Error('飞书未返回版本 ID。');
  }

  await openPlatformApi(auth, `/publish/commit/${appId}/${versionId}`, {
    body: {},
    referer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/${versionId}`,
  });

  return versionId;
}

async function createVersionAndPublishInBrowser(page, reusableHeaders, appId, creatorId) {
  const createPayload = await openPlatformPageApi(page, `/developers/v1/app_version/create/${appId}`, {
    method: 'POST',
    body: {
      appVersion: '0.0.1',
      mobileDefaultAbility: 'bot',
      pcDefaultAbility: 'bot',
      changeLog: '0.0.1',
      visibleSuggest: {
        departments: [],
        members: [creatorId],
        groups: [],
        isAll: 0,
      },
      applyReasonConfig: {
        apiPrivilegeNeedReason: false,
        contactPrivilegeNeedReason: false,
        dataPrivilegeReasonMap: {},
        visibleScopeNeedReason: false,
        apiPrivilegeReasonMap: {},
        contactPrivilegeReason: '',
        isDataPrivilegeExpandMap: {},
        visibleScopeReason: '',
        dataPrivilegeNeedReason: false,
        isAutoAudit: false,
        isContactExpand: false,
      },
      b2cShareSuggest: false,
      autoPublish: false,
      blackVisibleSuggest: {
        departments: [],
        members: [],
        groups: [],
        isAll: 0,
      },
    },
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/create`,
  }, reusableHeaders);

  const versionId = createPayload.data?.versionId?.trim();
  if (!versionId) {
    throw new Error('飞书未返回版本 ID。');
  }

  await openPlatformPageApi(page, `/developers/v1/publish/commit/${appId}/${versionId}`, {
    method: 'POST',
    body: {},
    referrer: `${FEISHU_OPEN_BASE_URL}/app/${appId}/version/${versionId}`,
  }, reusableHeaders);

  return versionId;
}

async function fetchFeishuTenantAccessToken(appId, appSecret) {
  const { payload, response } = await fetchJsonWithTimeout(
    FEISHU_TENANT_ACCESS_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': FEISHU_USER_AGENT,
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
    '/open-apis/auth/v3/tenant_access_token/internal',
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token?.trim()) {
    throw new Error(`获取飞书 tenant_access_token 失败: ${String(payload.msg || '')}`);
  }
  return payload.tenant_access_token.trim();
}

async function fetchFeishuAppOwnerOpenId(appId, tenantAccessToken) {
  const { payload } = await fetchJsonWithTimeout(
    `${FEISHU_OPEN_BASE_URL}/open-apis/application/v6/applications/${encodeURIComponent(appId)}?lang=zh_cn`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tenantAccessToken}`,
        'User-Agent': FEISHU_USER_AGENT,
      },
    },
    `/open-apis/application/v6/applications/${appId}`,
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  if (payload.code !== 0) {
    throw new Error(`读取飞书应用 owner 失败: ${String(payload.msg || '')}`);
  }

  const app = payload.data?.app;
  const creatorId = app?.creator_id?.trim() || '';
  const ownerId = app?.owner?.owner_id?.trim() || '';
  const ownerType = app?.owner?.owner_type ?? app?.owner?.type;
  if (ownerType === 2 && ownerId) {
    return ownerId;
  }
  if (ownerId.startsWith('ou_')) {
    return ownerId;
  }
  if (creatorId.startsWith('ou_')) {
    return creatorId;
  }
  return '';
}

function getReceiveIdTypes(candidateId) {
  if (candidateId.startsWith('ou_')) {
    return ['open_id', 'user_id'];
  }
  return ['user_id', 'open_id'];
}

async function sendFeishuWelcomeMessage(appId, appSecret, creatorId, content) {
  const tenantAccessToken = await fetchFeishuTenantAccessToken(appId, appSecret);
  const ownerOpenId = await fetchFeishuAppOwnerOpenId(appId, tenantAccessToken).catch(() => '');
  const candidateIds = Array.from(new Set([ownerOpenId, creatorId].map((item) => item.trim()).filter(Boolean)));
  let lastError = null;

  for (let attempt = 1; attempt <= WELCOME_MESSAGE_RETRY_COUNT; attempt += 1) {
    for (const candidateId of candidateIds) {
      for (const receiveIdType of getReceiveIdTypes(candidateId)) {
        try {
          const { payload } = await fetchJsonWithTimeout(
            `${FEISHU_IM_API_BASE_URL}/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${tenantAccessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': FEISHU_USER_AGENT,
              },
              body: JSON.stringify({
                content: JSON.stringify({ text: content }),
                msg_type: 'text',
                receive_id: candidateId,
              }),
            },
            `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
            WELCOME_MESSAGE_TIMEOUT_MS,
          );

          if (payload.code === 0) {
            return;
          }
          lastError = new Error(String(payload.msg || '发送欢迎消息失败'));
        } catch (error) {
          lastError = error;
        }
      }
    }

    if (attempt < WELCOME_MESSAGE_RETRY_COUNT) {
      await sleep(1_500);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function buildWelcomeMessage(name) {
  const trimmed = String(name || '').trim();
  if (trimmed) {
    return `欢迎使用 ${trimmed}，机器人已经创建并发布完成。`;
  }
  return DEFAULT_WELCOME_MESSAGE;
}

export async function authorizeFeishu({ onLog, onQr } = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: FEISHU_USER_AGENT,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    await waitForLogin(page, onQr, onLog);
    onLog?.('扫码确认完成，正在保存飞书登录态。');
    return await captureCredentials(page);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function validateFeishuAuth(auth) {
  if (!auth?.cookieString || !auth?.csrfToken) {
    return {
      valid: false,
      message: '缺少飞书授权信息。',
    };
  }

  try {
    const response = await fetch(FEISHU_APP_LIST_URL, {
      headers: {
        Cookie: auth.cookieString,
        'User-Agent': FEISHU_USER_AGENT,
      },
      redirect: 'follow',
    });

    if (!response.ok || !response.url.startsWith(FEISHU_APP_LIST_URL)) {
      throw new Error(`飞书登录态已失效: HTTP ${response.status} ${response.url}`);
    }

    return {
      valid: true,
      message: '飞书授权可用。',
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createFeishuBot(auth, options = {}) {
  const name = normalizeAppName(options.name);
  const description = normalizeAppDescription(options.description);
  const onLog = options.onLog;
  const avatarAsset = options.avatarAsset || null;

  onLog?.(`开始创建飞书机器人：${name}`);
  const result = await withFeishuBrowserSession(auth, async ({ page, reusableHeaders }) => {
    const avatarUpload = await uploadAvatarInBrowser(page, reusableHeaders, avatarAsset).catch((error) => {
      onLog?.(`上传头像失败，继续使用平台默认头像：${error instanceof Error ? error.message : String(error)}`);
      return {
        appliedAppearance: null,
        url: '',
      };
    });
    const avatar = avatarUpload.url;
    const appId = await createFeishuAppInBrowser(page, reusableHeaders, name, description, avatar);
    const appSecret = await getFeishuAppSecretInBrowser(page, reusableHeaders, appId);
    await enableFeishuBotInBrowser(page, reusableHeaders, appId);
    const unresolvedScopes = await updateFeishuScopesInBrowser(page, reusableHeaders, appId);
    await updateFeishuEventsInBrowser(page, reusableHeaders, appId);
    await switchFeishuCallbackModeInBrowser(page, reusableHeaders, appId);
    const creatorId = await getCurrentUserId(auth);
    const versionId = await createVersionAndPublishInBrowser(page, reusableHeaders, appId, creatorId);
    return {
      appId,
      appSecret,
      avatarAppearance: avatarUpload.appliedAppearance,
      creatorId,
      unresolvedScopes,
      versionId,
    };
  });

  const { appId, appSecret, creatorId, unresolvedScopes, versionId } = result;
  await sendFeishuWelcomeMessage(appId, appSecret, creatorId, buildWelcomeMessage(name)).catch(() => {});

  return {
    appId,
    appSecret,
    avatarAppearance: result.avatarAppearance || null,
    versionId,
    unresolvedScopes,
    name,
    description,
  };
}

async function listAllOpenApps(auth, sceneType = 0) {
  const items = [];
  let cursor = 0;
  let totalCount = Infinity;
  const count = 10;

  while (cursor < totalCount) {
    const payload = await openPlatformApi(auth, '/app/list', {
      body: {
        Count: count,
        Cursor: cursor,
        QueryFilter: {
          filterAppSceneTypeList: [sceneType],
        },
        OrderBy: 0,
      },
      referer: FEISHU_APP_LIST_URL,
    });

    const apps = Array.isArray(payload.data?.apps) ? payload.data.apps : [];
    totalCount = typeof payload.data?.totalCount === 'number' ? payload.data.totalCount : apps.length;
    items.push(...apps);
    if (!apps.length) {
      break;
    }
    cursor += apps.length;
  }

  return items;
}

async function listAllOpenAppsInBrowser(page, reusableHeaders, sceneType = 0) {
  const items = [];
  let cursor = 0;
  let totalCount = Infinity;
  const count = 10;

  while (cursor < totalCount) {
    const payload = await openPlatformPageApi(page, '/developers/v1/app/list', {
      method: 'POST',
      body: {
        Count: count,
        Cursor: cursor,
        QueryFilter: {
          filterAppSceneTypeList: [sceneType],
        },
        OrderBy: 0,
      },
      referrer: FEISHU_APP_LIST_URL,
    }, reusableHeaders);

    const apps = Array.isArray(payload.data?.apps) ? payload.data.apps : [];
    totalCount = typeof payload.data?.totalCount === 'number' ? payload.data.totalCount : apps.length;
    items.push(...apps);
    if (!apps.length) {
      break;
    }
    cursor += apps.length;
  }

  return items;
}

async function resolveSuiteAdminOrigin(auth) {
  const response = await fetch('https://www.feishu.cn/admin/index', {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      Cookie: auth.cookieString,
      Referer: FEISHU_APP_LIST_URL,
      'User-Agent': FEISHU_USER_AGENT,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`访问飞书管理员后台失败: HTTP ${response.status}`);
  }
  return new URL(response.url).origin;
}

async function resolveSuiteAdminOriginInBrowser(page) {
  await page.goto('https://www.feishu.cn/admin/index', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => {
    return /https:\/\/[^/]+\.feishu\.cn\/admin\/index/u.test(url.toString());
  }, { timeout: 60_000 });
  return new URL(page.url()).origin;
}

function uniqByAppId(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const appId = item?.appID;
    if (!appId || seen.has(appId)) {
      continue;
    }
    seen.add(appId);
    result.push(item);
  }
  return result;
}

async function disableAppIfEnabled(auth, suiteOrigin, appId) {
  const detail = await suiteAdminApi(auth, suiteOrigin, `/suite/admin/appcenter/v4/app/${appId}/detail`, {
    method: 'GET',
    referer: `${suiteOrigin}/admin/appCenter/manage/${appId}`,
  });

  const enabled = Boolean(detail.data?.config?.active?.open);
  if (!enabled) {
    return false;
  }

  await suiteAdminApi(auth, suiteOrigin, `/suite/admin/appcenter/v4/app/${appId}/stop`, {
    method: 'PUT',
    body: {},
    referer: `${suiteOrigin}/admin/appCenter/manage/${appId}`,
  });
  return true;
}

async function loadSuiteAppDetailInBrowser(page, suiteOrigin, appId) {
  const detailResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && response.url().includes(`/suite/admin/appcenter/v4/app/${appId}/detail`);
  }, { timeout: 30_000 });

  const manageUrl = `${suiteOrigin}/admin/appCenter/manage/${appId}`;
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded' });
  const detailResponse = await detailResponsePromise;
  const payload = await detailResponse.json();

  if (!detailResponse.ok() || payload?.code !== 0) {
    throw new Error(`Suite Admin detail request failed for ${appId}: HTTP ${detailResponse.status()}`);
  }

  const requestHeaders = detailResponse.request().headers();
  const reusableHeaders = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'accept'
      || lowerKey === 'content-type'
      || lowerKey === 'x-requested-with'
      || lowerKey.startsWith('x-')
    ) {
      reusableHeaders[key] = value;
    }
  }

  return {
    manageUrl,
    payload,
    reusableHeaders,
  };
}

async function disableAppIfEnabledInBrowser(page, suiteOrigin, appId) {
  const detailResult = await loadSuiteAppDetailInBrowser(page, suiteOrigin, appId);
  const enabled = Boolean(detailResult.payload?.data?.config?.active?.open);
  if (!enabled) {
    return false;
  }

  await suiteAdminPageApi(
    page,
    suiteOrigin,
    `/suite/admin/appcenter/v4/app/${appId}/stop`,
    detailResult.reusableHeaders,
    {
    method: 'PUT',
    body: {},
    referrer: detailResult.manageUrl,
    },
  );

  return true;
}

async function deleteFeishuApp(auth, appId) {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await openPlatformApi(auth, `/app/delete/${appId}`, {
    body: {
      challenge: crypto.randomBytes(64).toString('base64'),
    },
    referer,
  });
}

async function deleteFeishuAppInBrowser(page, reusableHeaders, appId) {
  const referer = `${FEISHU_OPEN_BASE_URL}/app/${appId}/baseinfo`;
  await page.goto(referer, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await openPlatformPageApi(page, `/developers/v1/app/delete/${appId}`, {
    method: 'POST',
    body: {
      challenge: crypto.randomBytes(64).toString('base64'),
    },
    referrer: referer,
  }, reusableHeaders);
}

export async function deleteFeishuBotsByNames(auth, names, inventoryItems = [], { onLog } = {}) {
  return await withFeishuBrowserSession(auth, async ({ context, page, reusableHeaders }) => {
    const results = [];
    const normalizedNames = new Set(names.map((item) => item.trim()).filter(Boolean));
    if (!normalizedNames.size) {
      return results;
    }

    const suitePage = await context.newPage();
    const remoteApps = uniqByAppId([
      ...await listAllOpenAppsInBrowser(page, reusableHeaders, 0).catch(() => []),
      ...await listAllOpenAppsInBrowser(page, reusableHeaders, 1).catch(() => []),
    ]);
    const inventoryLookup = new Map();
    const deletedInventoryLookup = new Map();
    for (const item of inventoryItems) {
      if (!item?.name) {
        continue;
      }
      const target = item.deletedAt ? deletedInventoryLookup : inventoryLookup;
      if (!target.has(item.name)) {
        target.set(item.name, []);
      }
      target.get(item.name).push({
        appId: item.appId,
        name: item.name,
        deletedAt: item.deletedAt || null,
      });
    }

    let suiteOrigin = null;

    for (const name of normalizedNames) {
      const candidates = new Map();
      for (const item of inventoryLookup.get(name) || []) {
        candidates.set(item.appId, item);
      }
      for (const app of remoteApps) {
        if (String(app?.name || '').trim() === name && String(app?.appID || '').trim()) {
          candidates.set(String(app.appID).trim(), {
            appId: String(app.appID).trim(),
            name,
          });
        }
      }

      if (!candidates.size) {
        const deletedItems = deletedInventoryLookup.get(name) || [];
        if (deletedItems.length) {
          results.push({
            appId: deletedItems[0].appId || null,
            message: '本地记录已标记删除，远端开发者后台也未找到匹配项，无需重复处理。',
            name,
            ok: true,
          });
        } else {
          results.push({
            appId: null,
            message: '未找到匹配的飞书机器人。',
            name,
            ok: false,
          });
        }
        continue;
      }

      for (const candidate of candidates.values()) {
        try {
          suiteOrigin = suiteOrigin || await resolveSuiteAdminOriginInBrowser(suitePage);
          let disabled = false;
          try {
            disabled = await disableAppIfEnabledInBrowser(suitePage, suiteOrigin, candidate.appId);
          } catch (error) {
            onLog?.(`停用飞书机器人失败：${candidate.name} (${candidate.appId}) ${error instanceof Error ? error.message : String(error)}`);
          }
          if (disabled) {
            onLog?.(`已停用飞书机器人：${candidate.name} (${candidate.appId})`);
          } else {
            onLog?.(`飞书机器人已是停用状态，或停用步骤未生效：${candidate.name} (${candidate.appId})`);
          }
          await deleteFeishuAppInBrowser(page, reusableHeaders, candidate.appId);
          onLog?.(`已删除飞书机器人：${candidate.name} (${candidate.appId})`);
          results.push({
            appId: candidate.appId,
            message: '删除成功。',
            name: candidate.name,
            ok: true,
          });
        } catch (error) {
          results.push({
            appId: candidate.appId,
            message: error instanceof Error ? error.message : String(error),
            name: candidate.name,
            ok: false,
          });
        }
      }
    }

    return results;
  });
}
