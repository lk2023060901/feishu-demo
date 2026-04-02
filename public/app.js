const platforms = ['feishu', 'qq'];
const activeTasks = {
  feishu: null,
  qq: null,
};

function formatTime(value) {
  if (!value) {
    return '未保存';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getPanel(platform) {
  return document.querySelector(`[data-platform="${platform}"]`);
}

function getElements(platform) {
  const panel = getPanel(platform);
  return {
    authMessage: panel.querySelector('[data-role="auth-message"]'),
    authMeta: panel.querySelector('[data-role="auth-meta"]'),
    authStatus: panel.querySelector('[data-role="auth-status"]'),
    description: panel.querySelector('[data-role="description"]'),
    inventory: panel.querySelector('[data-role="inventory"]'),
    inventoryCount: panel.querySelector('[data-role="inventory-count"]'),
    names: panel.querySelector('[data-role="names"]'),
    qrFrame: panel.querySelector('[data-role="qr-frame"]'),
    taskLog: panel.querySelector('[data-role="task-log"]'),
    taskSummary: panel.querySelector('[data-role="task-summary"]'),
    toolbarButtons: panel.querySelectorAll('button[data-action]'),
  };
}

function setBusy(platform, busy) {
  const { toolbarButtons } = getElements(platform);
  toolbarButtons.forEach((button) => {
    button.disabled = busy;
  });
}

function renderQr(platform, dataUrl) {
  const { qrFrame } = getElements(platform);
  if (!dataUrl) {
    qrFrame.innerHTML = '<div class="qr-placeholder">等待扫码任务</div>';
    return;
  }
  qrFrame.innerHTML = `<img src="${dataUrl}" alt="QR Code" />`;
}

function renderTask(platform, task) {
  const { authMessage, taskLog, taskSummary } = getElements(platform);
  if (!task) {
    taskSummary.textContent = '空闲';
    taskLog.textContent = '暂无任务。';
    authMessage.textContent = '尚未启动授权流程。';
    return;
  }

  taskSummary.textContent = `${task.status} · ${task.message || task.title}`;
  const lines = [];
  if (task.logs?.length) {
    for (const item of task.logs) {
      lines.push(`[${formatTime(item.at)}] ${item.message}`);
    }
  }
  if (task.results?.length) {
    lines.push('');
    lines.push('结果:');
    for (const item of task.results) {
      const prefix = item.ok ? 'OK' : 'ERR';
      lines.push(`${prefix} ${item.name || '-'} ${item.appId || ''} ${item.message || ''}`.trim());
    }
  }
  taskLog.textContent = lines.join('\n') || '暂无日志。';
  authMessage.textContent = task.message || '任务执行中。';
  renderQr(platform, task.qrDataUrl || '');
}

function renderInventory(platform, items) {
  const { inventory, inventoryCount } = getElements(platform);
  inventoryCount.textContent = `${items.length} 条`;
  if (!items.length) {
    inventory.innerHTML = '<div class="inventory-empty">暂无记录</div>';
    return;
  }

  inventory.innerHTML = items.map((item) => `
    <article class="inventory-item ${item.deletedAt ? 'is-deleted' : ''}">
      <div class="inventory-main">
        <div class="inventory-name">${item.name}</div>
        <div class="inventory-meta">${item.appId}</div>
      </div>
      <div class="inventory-side">
        <span class="inventory-tag">${item.deletedAt ? '已删除' : '有效'}</span>
        <span class="inventory-time">${formatTime(item.updatedAt || item.createdAt)}</span>
      </div>
    </article>
  `).join('');
}

function renderAuth(platform, authState) {
  const { authMeta, authStatus } = getElements(platform);
  authStatus.textContent = authState.valid ? '已授权' : '未授权';
  authStatus.classList.toggle('is-valid', authState.valid);
  authStatus.classList.toggle('is-invalid', !authState.valid);
  authMeta.textContent = authState.exists
    ? `${authState.message} · ${formatTime(authState.savedAt)}`
    : authState.message;
}

async function loadState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  const data = await response.json();

  for (const platform of platforms) {
    renderAuth(platform, data.auth[platform]);
    renderInventory(platform, data.inventory[platform] || []);
  }
}

async function pollTask(platform, taskId) {
  const response = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' });
  const task = await response.json();
  renderTask(platform, task);

  if (task.status === 'running') {
    window.setTimeout(() => {
      pollTask(platform, taskId).catch((error) => {
        renderTask(platform, {
          message: error.message,
          results: [],
          status: 'error',
          title: 'poll failed',
          logs: [],
        });
        setBusy(platform, false);
      });
    }, 1000);
    return;
  }

  activeTasks[platform] = null;
  setBusy(platform, false);
  await loadState();
}

async function startTask(platform, endpoint, options) {
  setBusy(platform, true);
  const response = await fetch(endpoint, options);
  const task = await response.json();
  if (!response.ok) {
    setBusy(platform, false);
    throw new Error(task.error || '请求失败');
  }

  activeTasks[platform] = task.id;
  renderTask(platform, task);
  await pollTask(platform, task.id);
}

function showUiError(platform, error) {
  renderTask(platform, {
    logs: [],
    message: error instanceof Error ? error.message : String(error),
    qrDataUrl: '',
    results: [],
    status: 'error',
    title: 'request failed',
  });
  setBusy(platform, false);
}

function bindPlatform(platform) {
  const panel = getPanel(platform);
  const elements = getElements(platform);

  panel.querySelector('[data-action="auth"]').addEventListener('click', () => {
    startTask(platform, `/api/${platform}/auth/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch((error) => {
      showUiError(platform, error);
    });
  });

  panel.querySelector('[data-action="clear-auth"]').addEventListener('click', async () => {
    setBusy(platform, true);
    try {
      const response = await fetch(`/api/${platform}/auth`, { method: 'DELETE' });
      setBusy(platform, false);
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || '清除授权失败');
      }
      renderQr(platform, '');
      renderTask(platform, null);
      await loadState();
    } catch (error) {
      showUiError(platform, error);
    }
  });

  panel.querySelector('[data-action="create"]').addEventListener('click', () => {
    startTask(platform, `/api/${platform}/bots/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: elements.description.value,
        names: elements.names.value,
      }),
    }).catch((error) => {
      showUiError(platform, error);
    });
  });

  panel.querySelector('[data-action="delete"]').addEventListener('click', () => {
    startTask(platform, `/api/${platform}/bots/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        names: elements.names.value,
      }),
    }).catch((error) => {
      showUiError(platform, error);
    });
  });
}

async function bootstrap() {
  for (const platform of platforms) {
    bindPlatform(platform);
  }

  document.getElementById('refresh-button').addEventListener('click', () => {
    loadState().catch((error) => {
      console.error(error);
    });
  });

  await loadState();
}

bootstrap().catch((error) => {
  console.error(error);
});
