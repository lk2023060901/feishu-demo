const platforms = ['feishu', 'qq'];
const activeTasks = {
  feishu: null,
  qq: null,
};
const avatarSelections = {
  feishu: null,
  qq: null,
};

let avatarPresets = null;

function formatTime(value) {
  if (!value) {
    return '未保存';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    avatarBackgrounds: panel.querySelector('[data-role="avatar-backgrounds"]'),
    avatarIcons: panel.querySelector('[data-role="avatar-icons"]'),
    avatarPreview: panel.querySelector('[data-role="avatar-preview"]'),
    description: panel.querySelector('[data-role="description"]'),
    inventory: panel.querySelector('[data-role="inventory"]'),
    inventoryCount: panel.querySelector('[data-role="inventory-count"]'),
    names: panel.querySelector('[data-role="names"]'),
    qrFrame: panel.querySelector('[data-role="qr-frame"]'),
    qrMeta: panel.querySelector('[data-role="qr-meta"]'),
    taskLog: panel.querySelector('[data-role="task-log"]'),
    taskSummary: panel.querySelector('[data-role="task-summary"]'),
    toolbarButtons: panel.querySelectorAll('button[data-action]'),
  };
}

function hasAvatarControls(elements) {
  return Boolean(elements.avatarBackgrounds && elements.avatarIcons && elements.avatarPreview);
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

function getDefaultAvatarAppearance() {
  return avatarPresets?.defaultAppearance || {
    backgroundColor: 'violet',
    icon: 'cube',
  };
}

function ensureAvatarSelection(platform) {
  if (!avatarSelections[platform]) {
    avatarSelections[platform] = { ...getDefaultAvatarAppearance() };
  }
  return avatarSelections[platform];
}

function findAvatarBackground(id) {
  return avatarPresets?.backgrounds?.find((item) => item.id === id) || null;
}

function findAvatarIcon(id) {
  return avatarPresets?.icons?.find((item) => item.id === id) || null;
}

function buildAvatarSvgMarkup(appearance, size = 88) {
  if (!avatarPresets || !appearance) {
    return '';
  }

  const background = findAvatarBackground(appearance.backgroundColor);
  const icon = findAvatarIcon(appearance.icon);
  if (!background || !icon) {
    return '';
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <rect width="240" height="240" fill="${background.color}" />
      <circle cx="54" cy="48" r="42" fill="#ffffff" opacity="0.18" />
      <circle cx="192" cy="192" r="62" fill="#000000" opacity="0.12" />
      <g fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
        ${icon.markup}
      </g>
    </svg>
  `;
}

function buildIconArtMarkup(icon) {
  return `
    <span class="avatar-icon-art" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none">
        <g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
          ${icon.markup}
        </g>
      </svg>
    </span>
  `;
}

function renderAvatarControls(platform) {
  if (!avatarPresets) {
    return;
  }

  const selection = ensureAvatarSelection(platform);
  const { avatarBackgrounds, avatarIcons, avatarPreview } = getElements(platform);
  if (!avatarBackgrounds || !avatarIcons || !avatarPreview) {
    return;
  }

  avatarBackgrounds.innerHTML = avatarPresets.backgrounds.map((background) => `
    <button
      class="avatar-swatch ${selection.backgroundColor === background.id ? 'is-selected' : ''}"
      type="button"
      title="${escapeHtml(background.label)}"
      aria-label="${escapeHtml(background.label)}"
      aria-pressed="${selection.backgroundColor === background.id}"
      data-avatar-bg="${background.id}"
    >
      <span class="avatar-swatch-fill" style="background:${background.color}"></span>
    </button>
  `).join('');

  avatarIcons.innerHTML = avatarPresets.icons.map((icon) => `
    <button
      class="avatar-icon ${selection.icon === icon.id ? 'is-selected' : ''}"
      type="button"
      title="${escapeHtml(icon.label)}"
      aria-label="${escapeHtml(icon.label)}"
      aria-pressed="${selection.icon === icon.id}"
      data-avatar-icon="${icon.id}"
    >
      ${buildIconArtMarkup(icon)}
    </button>
  `).join('');

  avatarPreview.innerHTML = buildAvatarSvgMarkup(selection, 88);
}

function getSelectedAvatarAppearance(platform) {
  const selection = ensureAvatarSelection(platform);
  return {
    backgroundColor: selection.backgroundColor,
    icon: selection.icon,
  };
}

function getQrMetaText(task) {
  if (!task || task.status !== 'running' || !task.qrDataUrl) {
    return '';
  }

  const parts = [];
  if (task.qrRefreshCount > 1) {
    parts.push(`已自动刷新 ${task.qrRefreshCount - 1} 次`);
  }

  if (task.qrExpiresAt) {
    const remainingMs = new Date(task.qrExpiresAt).getTime() - Date.now();
    if (remainingMs > 0) {
      parts.push(`${Math.ceil(remainingMs / 1000)} 秒后过期`);
      parts.push('过期后自动刷新');
    } else {
      parts.push('二维码已过期，正在自动刷新');
    }
  }

  return parts.join(' · ');
}

function formatTaskResult(platform, task, item) {
  if (item.ok) {
    if (platform === 'feishu' && task.kind === 'create') {
      const details = [
        `名称: ${item.name || '-'}`,
        `App ID: ${item.appId || '-'}`,
        `Secret: ${item.secret || '-'}`,
      ];
      if (item.attempts > 1) {
        details.push(`尝试次数: ${item.attempts}`);
      }
      if (item.message) {
        details.push(item.message);
      }
      return details.join(' | ');
    }

    const details = [];
    if (item.name) {
      details.push(`名称: ${item.name}`);
    }
    if (item.appId) {
      details.push(`App ID: ${item.appId}`);
    }
    if (item.savedAt) {
      details.push(`保存时间: ${formatTime(item.savedAt)}`);
    }
    if (item.message) {
      details.push(item.message);
    }
    return details.join(' | ') || '成功';
  }

  const details = [];
  if (item.name) {
    details.push(`名称: ${item.name}`);
  }
  if (item.appId) {
    details.push(`App ID: ${item.appId}`);
  }
  if (item.message) {
    details.push(`原因: ${item.message}`);
  }
  if (item.attempts) {
    details.push(`尝试次数: ${item.attempts}`);
  }
  return details.join(' | ') || '失败';
}

function renderTask(platform, task) {
  const { authMessage, qrMeta, taskLog, taskSummary } = getElements(platform);
  if (!task) {
    taskSummary.textContent = '空闲';
    taskLog.textContent = '暂无任务。';
    authMessage.textContent = '尚未启动授权流程。';
    qrMeta.textContent = '';
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
    const successItems = task.results.filter((item) => item.ok);
    const failureItems = task.results.filter((item) => !item.ok);

    lines.push('');
    lines.push('结果:');
    if (successItems.length) {
      lines.push('成功:');
      for (const item of successItems) {
        lines.push(formatTaskResult(platform, task, item));
      }
    }
    if (failureItems.length) {
      if (successItems.length) {
        lines.push('');
      }
      lines.push('失败:');
      for (const item of failureItems) {
        lines.push(formatTaskResult(platform, task, item));
      }
    }
  }
  taskLog.textContent = lines.join('\n') || '暂无日志。';
  authMessage.textContent = task.message || '任务执行中。';
  qrMeta.textContent = getQrMetaText(task);
  renderQr(platform, task.qrDataUrl || '');
}

function renderInventory(platform, items) {
  const { inventory, inventoryCount } = getElements(platform);
  inventoryCount.textContent = `${items.length} 条`;
  if (!items.length) {
    inventory.innerHTML = '<div class="inventory-empty">暂无记录</div>';
    return;
  }

  inventory.innerHTML = items.map((item) => {
    const avatarMarkup = buildAvatarSvgMarkup(item.meta?.avatarAppearance || null, 44);
    return `
      <article class="inventory-item ${item.deletedAt ? 'is-deleted' : ''}">
        <div class="inventory-main">
          ${avatarMarkup ? `<div class="inventory-avatar">${avatarMarkup}</div>` : ''}
          <div class="inventory-copy">
            <div class="inventory-name">${escapeHtml(item.name)}</div>
            <div class="inventory-meta">${escapeHtml(item.appId)}</div>
          </div>
        </div>
        <div class="inventory-side">
          <span class="inventory-tag">${item.deletedAt ? '已删除' : '有效'}</span>
          <span class="inventory-time">${formatTime(item.updatedAt || item.createdAt)}</span>
        </div>
      </article>
    `;
  }).join('');
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
    qrExpiresAt: null,
    qrRefreshCount: 0,
    results: [],
    status: 'error',
    title: 'request failed',
  });
  setBusy(platform, false);
}

async function loadAvatarPresets() {
  const response = await fetch('/api/avatar-presets', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || '加载头像预设失败');
  }

  avatarPresets = payload;
  for (const platform of platforms) {
    const elements = getElements(platform);
    if (hasAvatarControls(elements)) {
      ensureAvatarSelection(platform);
      renderAvatarControls(platform);
    }
  }
}

function bindPlatform(platform) {
  const panel = getPanel(platform);
  const elements = getElements(platform);

  if (hasAvatarControls(elements)) {
    panel.addEventListener('click', (event) => {
      const backgroundButton = event.target.closest('[data-avatar-bg]');
      if (backgroundButton) {
        ensureAvatarSelection(platform).backgroundColor = backgroundButton.dataset.avatarBg;
        renderAvatarControls(platform);
        return;
      }

      const iconButton = event.target.closest('[data-avatar-icon]');
      if (iconButton) {
        ensureAvatarSelection(platform).icon = iconButton.dataset.avatarIcon;
        renderAvatarControls(platform);
      }
    });
  }

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
        ...(platform === 'feishu'
          ? { avatarAppearance: getSelectedAvatarAppearance(platform) }
          : {}),
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

  await loadAvatarPresets();
  await loadState();
}

bootstrap().catch((error) => {
  console.error(error);
});
