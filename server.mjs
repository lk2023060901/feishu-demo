import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAvatarPresetPayload, normalizeAvatarAppearance, renderAvatarAsset } from './lib/avatar.mjs';
import { createFeishuBot, authorizeFeishu, deleteFeishuBotsByNames, validateFeishuAuth } from './lib/feishu.mjs';
import { createQqBotWithProfile, authorizeQq, deleteQqBotsByNames, validateQqAuth } from './lib/qq.mjs';
import { summarizeBatchResults, uniqueNonEmptyLines, sanitizeBotForClient } from './lib/common.mjs';
import { PUBLIC_DIR, SERVER_PORT } from './lib/config.mjs';
import {
  clearAuth,
  ensureStorage,
  markBotsDeleted,
  readAuth,
  readInventory,
  upsertBot,
  writeAuth,
} from './lib/storage.mjs';
import {
  appendTaskLog,
  appendTaskResult,
  createTask,
  failTask,
  finishTask,
  getTask,
  updateTask,
} from './lib/tasks.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${String(error)}`);
  }
}

async function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${relativePath}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extname = path.extname(filePath);
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES[extname] || 'application/octet-stream',
    });
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      notFound(res);
      return;
    }
    throw error;
  }
}

async function getState() {
  const [inventory, feishuAuth, qqAuth] = await Promise.all([
    readInventory(),
    readAuth('feishu'),
    readAuth('qq'),
  ]);

  const [feishuStatus, qqStatus] = await Promise.all([
    feishuAuth ? validateFeishuAuth(feishuAuth) : Promise.resolve({ valid: false, message: '尚未授权。' }),
    qqAuth ? validateQqAuth(qqAuth) : Promise.resolve({ valid: false, message: '尚未授权。' }),
  ]);

  return {
    auth: {
      feishu: {
        exists: Boolean(feishuAuth),
        savedAt: feishuAuth?.savedAt || null,
        ...feishuStatus,
      },
      qq: {
        exists: Boolean(qqAuth),
        savedAt: qqAuth?.savedAt || null,
        ...qqStatus,
      },
    },
    inventory: {
      feishu: inventory.feishu.map(sanitizeBotForClient),
      qq: inventory.qq.map(sanitizeBotForClient),
    },
  };
}

function startBackgroundTask(task, runner) {
  void (async () => {
    try {
      await runner();
    } catch (error) {
      updateTask(task.id, {
        qrDataUrl: null,
        qrExpiresAt: null,
      });
      appendTaskLog(task.id, error instanceof Error ? error.message : String(error));
      failTask(task.id, error);
    }
  })();
}

async function loadValidatedAuth(platform) {
  const auth = await readAuth(platform);
  if (!auth) {
    throw new Error(`${platform === 'feishu' ? '飞书' : 'QQ'} 尚未授权。`);
  }

  const validation = platform === 'feishu'
    ? await validateFeishuAuth(auth)
    : await validateQqAuth(auth);

  if (!validation.valid) {
    throw new Error(validation.message || `${platform} 授权已失效。`);
  }

  return auth;
}

async function handleStartAuth(platform, res) {
  const task = createTask({
    kind: 'auth',
    platform,
    title: `${platform} auth`,
    message: `准备启动 ${platform} 授权`,
  });

  startBackgroundTask(task, async () => {
    appendTaskLog(task.id, `开始 ${platform === 'feishu' ? '飞书' : 'QQ'} 授权流程。`);
    let qrRefreshCount = 0;
    const publishQrToTask = (payload) => {
      const qrDataUrl = typeof payload === 'string' ? payload : payload?.dataUrl;
      if (!qrDataUrl) {
        return;
      }

      qrRefreshCount += 1;
      updateTask(task.id, {
        qrDataUrl,
        qrExpiresAt: typeof payload === 'string' ? null : payload?.expiresAt || null,
        qrRefreshCount,
        message: qrRefreshCount === 1
          ? '请扫码登录'
          : `二维码已自动刷新，请使用最新二维码扫码（第 ${qrRefreshCount} 次）。`,
      });
    };
    const auth = platform === 'feishu'
      ? await authorizeFeishu({
          onLog: (message) => appendTaskLog(task.id, message),
          onQr: publishQrToTask,
        })
      : await authorizeQq({
          onLog: (message) => appendTaskLog(task.id, message),
          onQr: publishQrToTask,
        });

    await writeAuth(platform, auth);
    appendTaskResult(task.id, {
      ok: true,
      message: '授权已保存到项目目录。',
      savedAt: auth.savedAt,
    });
    finishTask(task.id, {
      message: '授权完成。',
      qrDataUrl: null,
      qrExpiresAt: null,
    });
  });

  json(res, 202, task);
}

async function handleClearAuth(platform, res) {
  await clearAuth(platform);
  json(res, 200, { ok: true });
}

async function handleCreateBots(platform, req, res) {
  const body = await readRequestBody(req);
  const names = uniqueNonEmptyLines(body.names || '', { dedupe: false });
  if (!names.length) {
    json(res, 400, { error: '请至少输入一个机器人名称。' });
    return;
  }

  const description = String(body.description || '').trim();
  const avatarAppearance = platform === 'feishu'
    ? normalizeAvatarAppearance(body.avatarAppearance)
    : null;
  const task = createTask({
    kind: 'create',
    platform,
    title: `${platform} create`,
    message: `准备批量创建 ${names.length} 个机器人`,
  });

  startBackgroundTask(task, async () => {
    const auth = await loadValidatedAuth(platform);
    let avatarAsset = null;
    if (avatarAppearance) {
      appendTaskLog(task.id, '正在生成机器人头像。');
      try {
        avatarAsset = await renderAvatarAsset(avatarAppearance);
        appendTaskLog(task.id, '头像模板已生成，将用于本次批量创建。');
      } catch (error) {
        appendTaskLog(
          task.id,
          `头像模板生成失败，已回退到默认头像：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const results = [];

    for (const name of names) {
      appendTaskLog(task.id, `开始处理：${name}`);
      try {
        const created = platform === 'feishu'
          ? await createFeishuBot(auth, {
              avatarAsset,
              description,
              name,
              onLog: (message) => appendTaskLog(task.id, `[${name}] ${message}`),
            })
          : await createQqBotWithProfile(auth, {
              description,
              name,
              onLog: (message) => appendTaskLog(task.id, `[${name}] ${message}`),
            });

        await upsertBot(platform, {
          appId: created.appId,
          createdAt: new Date().toISOString(),
          description: created.description,
          meta: platform === 'feishu'
            ? {
                avatarAppearance: created.avatarAppearance || null,
                unresolvedScopes: created.unresolvedScopes,
                versionId: created.versionId,
              }
            : {
                developerId: created.developerId,
              },
          name: created.name,
          platform,
        });

        const result = {
          appId: created.appId,
          message: '创建成功。',
          name: created.name,
          ok: true,
        };
        results.push(result);
        appendTaskResult(task.id, result);
      } catch (error) {
        const result = {
          appId: null,
          message: error instanceof Error ? error.message : String(error),
          name,
          ok: false,
        };
        results.push(result);
        appendTaskResult(task.id, result);
      }
    }

    finishTask(task.id, {
      message: summarizeBatchResults(results),
    });
  });

  json(res, 202, task);
}

async function handleDeleteBots(platform, req, res) {
  const body = await readRequestBody(req);
  const names = uniqueNonEmptyLines(body.names || '', { dedupe: true });
  if (!names.length) {
    json(res, 400, { error: '请至少输入一个机器人名称。' });
    return;
  }

  const task = createTask({
    kind: 'delete',
    platform,
    title: `${platform} delete`,
    message: `准备批量删除 ${names.length} 个机器人`,
  });

  startBackgroundTask(task, async () => {
    const auth = await loadValidatedAuth(platform);
    const inventory = await readInventory();
    const results = platform === 'feishu'
      ? await deleteFeishuBotsByNames(auth, names, inventory.feishu, {
          onLog: (message) => appendTaskLog(task.id, message),
        })
      : await deleteQqBotsByNames(auth, names, inventory.qq, {
          onLog: (message) => appendTaskLog(task.id, message),
        });

    for (const result of results) {
      appendTaskResult(task.id, result);
    }

    const deletedIds = results
      .filter((item) => item.ok && item.appId)
      .map((item) => item.appId);
    if (deletedIds.length) {
      await markBotsDeleted(platform, deletedIds);
    }

    finishTask(task.id, {
      message: summarizeBatchResults(results),
    });
  });

  json(res, 202, task);
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/avatar-presets') {
    json(res, 200, getAvatarPresetPayload());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    json(res, 200, await getState());
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/tasks/')) {
    const taskId = pathname.split('/').pop();
    const task = getTask(taskId);
    if (!task) {
      notFound(res);
      return;
    }
    json(res, 200, task);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/feishu/auth/start') {
    await handleStartAuth('feishu', res);
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/feishu/auth') {
    await handleClearAuth('feishu', res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/qq/auth/start') {
    await handleStartAuth('qq', res);
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/qq/auth') {
    await handleClearAuth('qq', res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/feishu/bots/create') {
    await handleCreateBots('feishu', req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/feishu/bots/delete') {
    await handleDeleteBots('feishu', req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/qq/bots/create') {
    await handleCreateBots('qq', req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/qq/bots/delete') {
    await handleDeleteBots('qq', req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, pathname);
    return;
  }

  notFound(res);
}

await ensureStorage();

const HOST = process.env.HOST || '127.0.0.1';
const NO_LISTEN = process.env.NO_LISTEN === '1';

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    json(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

if (!NO_LISTEN) {
  server.listen(SERVER_PORT, HOST, () => {
    const rootDir = path.dirname(fileURLToPath(import.meta.url));
    console.log(`feishu-demo listening on http://${HOST}:${SERVER_PORT} (${rootDir})`);
  });
}

export { server };
