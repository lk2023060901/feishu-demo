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

const QQ_BASE_URL = 'https://q.qq.com';
const QQ_BOT_BASE_URL = 'https://bot.q.qq.com';
const QQ_API_BASE_URL = 'https://api.sgroup.qq.com';
const QQ_APP_ACCESS_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const QQ_LOGIN_URL = `${QQ_BASE_URL}/qqbot/openclaw/login.html`;
const QQ_INDEX_URL = `${QQ_BASE_URL}/qqbot/openclaw/index.html`;
const QQ_ENTITY_PICKER_URL = `${QQ_BASE_URL}/qqbot/openclaw/entity-picker.html`;
const QQ_CREATE_SESSION_URL = `${QQ_BASE_URL}/lite/create_session`;
const QQ_POLL_URL = `${QQ_BASE_URL}/lite/poll`;
const QQ_CREATE_BOT_URL = `${QQ_BOT_BASE_URL}/cgi-bin/lite_create`;
const QQ_UPLOAD_AVATAR_URL = `${QQ_BOT_BASE_URL}/cgi-bin/resource/lite_upload_avatar`;
const QQ_MODIFY_BOT_URL = `${QQ_BOT_BASE_URL}/cgi-bin/info/lite_modify`;
const QQ_DELETE_BOT_URL = `${QQ_BOT_BASE_URL}/cgi-bin/info/lite_delete`;
const QQ_VALIDATE_URL = `${QQ_BOT_BASE_URL}/cgi-bin/create/lite_remain`;
const QQ_DEFAULT_BKN = '5381';
const QQ_LOGIN_EXPIRED_RETCODE = 10004;
const QQ_POLL_SUCCESS = 0;
const QQ_POLL_WAITING = 1;
const QQ_POLL_EXPIRED = 2;
const QQ_POLL_SCANNED = 3;
const QQ_POLL_REJECTED = 4;
const QQ_POLL_INTERVAL_MS = 2_000;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const FIRST_QR_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const WELCOME_MESSAGE_TIMEOUT_MS = 10_000;
const WELCOME_MESSAGE_RETRY_COUNT = 3;
const DEFAULT_APP_DESCRIPTION = 'Created by feishu-demo';
const DEFAULT_WELCOME_MESSAGE = '欢迎使用你的新 QQ 机器人，创建已经完成。';
const QQ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function buildQqHeaders(auth, referer, contentType = 'application/json') {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: QQ_BASE_URL,
    Referer: referer,
    'User-Agent': QQ_USER_AGENT,
  };

  if (auth?.cookieString) {
    headers.Cookie = auth.cookieString.includes('developer_id_lite=')
      ? auth.cookieString
      : mergeCookieString(`developer_id_lite=${auth.developerId || ''}`, auth.cookieString);
  }

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

function computeBkn(skey) {
  const value = skey || '';
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash += (hash << 5) + value.charCodeAt(index);
  }
  return String(hash & 0x7fffffff);
}

function buildQrRawValue(sessionId) {
  return `${QQ_ENTITY_PICKER_URL}?session_id=${encodeURIComponent(sessionId)}&_wv=16777218`;
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
      throw new Error(`QQ request failed for ${label}: HTTP ${response.status}`);
    }
    return { payload, response };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postQqJson(auth, url, body, referer) {
  const { payload } = await fetchJsonWithTimeout(
    `${url}?bkn=${encodeURIComponent(auth.bkn)}`,
    {
      method: 'POST',
      headers: buildQqHeaders(auth, referer),
      body: JSON.stringify(body),
    },
    url,
  );

  if (payload.retcode === QQ_LOGIN_EXPIRED_RETCODE) {
    throw new Error('QQ 登录状态已过期。');
  }
  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ 接口返回异常: ${String(payload.retcode ?? 'unknown')}`);
  }
  return payload;
}

async function getQqJson(auth, url, referer) {
  const { payload } = await fetchJsonWithTimeout(
    `${url}?bkn=${encodeURIComponent(auth.bkn)}`,
    {
      headers: buildQqHeaders(auth, referer, ''),
    },
    url,
  );

  if (payload.retcode === QQ_LOGIN_EXPIRED_RETCODE) {
    throw new Error('QQ 登录状态已过期。');
  }
  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ 接口返回异常: ${String(payload.retcode ?? 'unknown')}`);
  }
  return payload;
}

async function pageJsonFetch(page, url, options = {}) {
  const { method = 'GET', body = undefined, headers = {} } = options;
  const result = await page.evaluate(async ({ body, headers, method, url: requestUrl }) => {
    const response = await fetch(requestUrl, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, {
    body,
    headers,
    method,
    url,
  });

  if (!result.ok) {
    throw new Error(`QQ 页面请求失败: ${url} -> HTTP ${result.status}`);
  }

  return JSON.parse(result.text || '{}');
}

function normalizeBotName(name) {
  return normalizeText(name, 'QQ Bot');
}

function normalizeBotDescription(description) {
  return normalizeText(description, DEFAULT_APP_DESCRIPTION);
}

function buildWelcomeMessage(name) {
  const trimmed = String(name || '').trim();
  if (trimmed) {
    return `欢迎使用 ${trimmed}，机器人已经创建完成。`;
  }
  return DEFAULT_WELCOME_MESSAGE;
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

async function createQqLoginSession(page) {
  const payload = await pageJsonFetch(
    page,
    `${QQ_CREATE_SESSION_URL}?bkn=${encodeURIComponent(QQ_DEFAULT_BKN)}`,
    {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    },
  );

  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ 登录会话创建失败: ${String(payload.retcode ?? 'unknown')}`);
  }

  const sessionCode = payload.data?.code;
  const sessionId = payload.data?.session_id?.trim();
  if (sessionCode !== 0 || !sessionId) {
    throw new Error(payload.data?.message || 'QQ 登录会话未返回 session_id。');
  }

  return {
    sessionId,
    qrcodeUrl: renderQrPngDataUrl(buildQrRawValue(sessionId)),
  };
}

async function pollQqLoginSession(page, sessionId) {
  const payload = await pageJsonFetch(
    page,
    `${QQ_POLL_URL}?session_id=${encodeURIComponent(sessionId)}&bkn=${encodeURIComponent(QQ_DEFAULT_BKN)}`,
    {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    },
  );

  if (payload.retcode !== 0) {
    throw new Error(payload.msg || `QQ 登录轮询失败: ${String(payload.retcode ?? 'unknown')}`);
  }
  return payload.data || {};
}

async function captureQqAuth(context, page, developerId) {
  await context.addCookies([{
    name: 'developer_id_lite',
    value: developerId,
    domain: '.q.qq.com',
    path: '/',
    secure: true,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  }]).catch(() => {});

  await page.goto(QQ_INDEX_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const cookies = await context.cookies([QQ_BASE_URL, QQ_BOT_BASE_URL]);
  const cookieString = buildCookieStringFromCookies(cookies);
  const skey = pickCookieValue(cookies, 'skey', 'p_skey');

  return {
    bkn: computeBkn(skey) || QQ_DEFAULT_BKN,
    cookieString: mergeCookieString(`developer_id_lite=${developerId}`, cookieString),
    developerId,
    savedAt: Date.now(),
  };
}

async function createQqBot(auth) {
  const payload = await postQqJson(auth, QQ_CREATE_BOT_URL, {
    apply_source: 1,
    idempotency_key: Date.now().toString(),
  }, QQ_INDEX_URL);

  const appId = payload.data?.appid?.trim();
  const clientSecret = payload.data?.client_secret?.trim();
  if (!appId || !clientSecret) {
    throw new Error('QQ 未返回 App ID 或 Client Secret。');
  }
  return {
    appId,
    clientSecret,
  };
}

async function uploadDefaultAvatar(auth) {
  const avatar = await readDefaultAvatar();
  if (!avatar) {
    return null;
  }

  const formData = new FormData();
  formData.set('file', new Blob([avatar], { type: 'image/png' }), 'avatar.png');
  formData.set('type', '0');

  const { payload } = await fetchJsonWithTimeout(
    `${QQ_UPLOAD_AVATAR_URL}?bkn=${encodeURIComponent(auth.bkn)}`,
    {
      method: 'POST',
      headers: buildQqHeaders(auth, QQ_INDEX_URL, ''),
      body: formData,
    },
    QQ_UPLOAD_AVATAR_URL,
  );

  if (payload.retcode !== 0) {
    return null;
  }

  const uri = payload.data?.uri?.trim();
  const sign = payload.data?.sign?.trim();
  if (!uri || !sign) {
    return null;
  }

  return {
    uri,
    sign,
  };
}

async function modifyQqBotProfile(auth, appId, name, description, avatar) {
  const body = {
    bot_appid: appId,
    bot_desc: description,
    bot_name: name,
  };

  if (avatar?.uri && avatar?.sign) {
    body.avatar_url = avatar.uri;
    body.avatar_url_sign = avatar.sign;
  }

  await postQqJson(auth, QQ_MODIFY_BOT_URL, body, QQ_INDEX_URL);
}

async function fetchQqAppAccessToken(appId, clientSecret) {
  const { payload, response } = await fetchJsonWithTimeout(
    QQ_APP_ACCESS_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': QQ_USER_AGENT,
      },
      body: JSON.stringify({
        appId,
        clientSecret,
      }),
    },
    QQ_APP_ACCESS_TOKEN_URL,
    WELCOME_MESSAGE_TIMEOUT_MS,
  );

  if (!response.ok || !payload.access_token?.trim()) {
    throw new Error(`获取 QQ access_token 失败: ${String(payload.message || '')}`);
  }
  return payload.access_token.trim();
}

async function sendQqWelcomeMessage(appId, clientSecret, developerId, content) {
  const accessToken = await fetchQqAppAccessToken(appId, clientSecret);
  let lastError = null;

  for (let attempt = 1; attempt <= WELCOME_MESSAGE_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(`${QQ_API_BASE_URL}/v2/users/${encodeURIComponent(developerId)}/messages`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `QQBot ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': QQ_USER_AGENT,
        },
        body: JSON.stringify({
          content,
          msg_type: 0,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw.slice(0, 200) || `HTTP ${response.status}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < WELCOME_MESSAGE_RETRY_COUNT) {
        await sleep(1_500);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export async function authorizeQq({ onLog, onQr } = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: QQ_USER_AGENT,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    await page.goto(QQ_LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    onLog?.('QQ 登录页已初始化，正在生成二维码。');

    let login = await withTimeout(createQqLoginSession(page), FIRST_QR_TIMEOUT_MS, '等待 QQ 初始二维码超时。');
    onQr?.(login.qrcodeUrl);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let developerId = '';

    while (Date.now() < deadline) {
      const payload = await pollQqLoginSession(page, login.sessionId);
      const code = payload.code;

      if (code === QQ_POLL_SUCCESS) {
        developerId = payload.developer_id?.trim() || '';
        if (!developerId) {
          throw new Error('QQ 登录成功，但未拿到 developer_id。');
        }
        break;
      }

      if (code === QQ_POLL_EXPIRED || code === QQ_POLL_REJECTED) {
        onLog?.('QQ 二维码已失效，正在刷新。');
        login = await createQqLoginSession(page);
        onQr?.(login.qrcodeUrl);
      }

      if (code === QQ_POLL_SCANNED) {
        onLog?.('QQ 已扫码，等待手机端确认。');
      }

      await sleep(QQ_POLL_INTERVAL_MS);
    }

    if (!developerId) {
      throw new Error('等待 QQ 扫码确认超时。');
    }

    onLog?.('QQ 扫码确认完成，正在保存登录态。');
    return await captureQqAuth(context, page, developerId);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function validateQqAuth(auth) {
  if (!auth?.cookieString || !auth?.bkn || !auth?.developerId) {
    return {
      valid: false,
      message: '缺少 QQ 授权信息。',
    };
  }

  try {
    await getQqJson(auth, QQ_VALIDATE_URL, QQ_INDEX_URL);
    return {
      valid: true,
      message: 'QQ 授权可用。',
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createQqBotWithProfile(auth, options = {}) {
  const name = normalizeBotName(options.name);
  const description = normalizeBotDescription(options.description);
  const onLog = options.onLog;

  onLog?.(`开始创建 QQ 机器人：${name}`);
  const { appId, clientSecret } = await createQqBot(auth);
  const avatar = await uploadDefaultAvatar(auth).catch(() => null);
  await modifyQqBotProfile(auth, appId, name, description, avatar).catch(() => {});
  await sendQqWelcomeMessage(appId, clientSecret, auth.developerId, buildWelcomeMessage(name)).catch(() => {});

  return {
    appId,
    clientSecret,
    name,
    description,
    developerId: auth.developerId,
  };
}

async function deleteQqBot(auth, appId) {
  await postQqJson(auth, QQ_DELETE_BOT_URL, {
    bot_appid: appId,
    op: 1,
  }, QQ_INDEX_URL);
}

export async function deleteQqBotsByNames(auth, names, inventoryItems = [], { onLog } = {}) {
  const activeItems = inventoryItems.filter((item) => item?.name && !item.deletedAt);
  const results = [];

  for (const name of names) {
    const matches = activeItems.filter((item) => item.name === name);
    if (!matches.length) {
      results.push({
        appId: null,
        message: '未在本地清单中找到匹配的 QQ 机器人。',
        name,
        ok: false,
      });
      continue;
    }

    for (const item of matches) {
      try {
        await deleteQqBot(auth, item.appId);
        onLog?.(`已删除 QQ 机器人：${item.name} (${item.appId})`);
        results.push({
          appId: item.appId,
          message: '删除成功。',
          name: item.name,
          ok: true,
        });
      } catch (error) {
        results.push({
          appId: item.appId,
          message: error instanceof Error ? error.message : String(error),
          name: item.name,
          ok: false,
        });
      }
    }
  }

  return results;
}
