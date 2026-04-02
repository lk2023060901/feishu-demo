export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export function normalizeText(value, fallback) {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
}

export function uniqueNonEmptyLines(input, { dedupe = true } = {}) {
  const values = String(input || '')
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!dedupe) {
    return values;
  }

  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function mergeCookieString(primary, fallback = '') {
  const merged = new Map();
  for (const source of [fallback, primary]) {
    for (const pair of String(source || '').split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) {
        continue;
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) {
        continue;
      }
      const name = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!name) {
        continue;
      }
      merged.set(name, value);
    }
  }

  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function buildCookieStringFromCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => cookie?.name && cookie?.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function pickCookieValue(cookies, ...names) {
  for (const name of names) {
    const value = (Array.isArray(cookies) ? cookies : []).find((cookie) => cookie?.name === name)?.value?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

export async function parseJsonResponse(response, label) {
  const raw = await response.text();
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${label}: ${String(error)}; body=${raw.slice(0, 400)}`, {
      cause: error,
    });
  }
}

export function summarizeBatchResults(results) {
  const items = Array.isArray(results) ? results : [];
  const successCount = items.filter((item) => item?.ok).length;
  const failureCount = items.length - successCount;
  return `${successCount} succeeded, ${failureCount} failed`;
}

export function sanitizeBotForClient(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const {
    appSecret,
    clientSecret,
    cookieString,
    csrfToken,
    ...safe
  } = item;

  return safe;
}
