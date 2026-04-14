const platforms = ['feishu', 'qq'];
const platformLabels = {
  feishu: '飞书',
  qq: 'QQ',
};
const activeTasks = {
  feishu: null,
  qq: null,
};
const avatarSelections = {
  feishu: null,
  qq: null,
};
const currentState = {
  auth: {},
  inventory: {
    feishu: [],
    qq: [],
  },
};
const exportInventoryState = {
  inventory: {
    feishu: [],
    qq: [],
  },
  loading: false,
  error: '',
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

function formatPlatformLabel(platform) {
  return platformLabels[platform] || platform;
}

function getInventoryTimestamp(item) {
  return Date.parse(item?.updatedAt || item?.createdAt || '') || 0;
}

function sortInventoryItems(items) {
  return [...(items || [])].sort((left, right) => getInventoryTimestamp(right) - getInventoryTimestamp(left));
}

function getVisibleInventoryItems(items) {
  return sortInventoryItems(items).filter((item) => !item?.deletedAt);
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
  const visibleItems = getVisibleInventoryItems(items);
  const { inventory, inventoryCount } = getElements(platform);
  inventoryCount.textContent = `${visibleItems.length} 条`;
  if (!visibleItems.length) {
    inventory.innerHTML = '<div class="inventory-empty">暂无记录</div>';
    return;
  }

  inventory.innerHTML = visibleItems.map((item) => {
    const avatarMarkup = buildAvatarSvgMarkup(item.meta?.avatarAppearance || null, 44);
    return `
      <article class="inventory-item">
        <div class="inventory-main">
          ${avatarMarkup ? `<div class="inventory-avatar">${avatarMarkup}</div>` : ''}
          <div class="inventory-copy">
            <div class="inventory-name">${escapeHtml(item.name)}</div>
            <div class="inventory-meta">${escapeHtml(item.appId)}</div>
          </div>
        </div>
        <div class="inventory-side">
          <span class="inventory-tag">有效</span>
          <span class="inventory-time">${formatTime(item.updatedAt || item.createdAt)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function getExportRows() {
  const rows = [];

  for (const platform of platforms) {
    for (const item of sortInventoryItems(exportInventoryState.inventory[platform] || [])) {
      rows.push({
        platform: formatPlatformLabel(platform),
        name: item.name || '',
        appId: item.appId || '',
        secret: item.secret || '',
        description: item.description || '',
        updatedAt: formatTime(item.updatedAt || item.createdAt),
        createdAt: formatTime(item.createdAt),
      });
    }
  }

  return rows;
}

function csvEscape(value) {
  const normalized = String(value ?? '');
  if (!/[",\r\n]/u.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replaceAll('"', '""')}"`;
}

function buildCsvContent(rows) {
  const header = ['平台', '机器人名称', 'App ID', 'Secret', '描述', '更新时间', '创建时间'];
  const lines = [
    header.join(','),
    ...rows.map((row) => ([
      row.platform,
      row.name,
      row.appId,
      row.secret,
      row.description,
      row.updatedAt,
      row.createdAt,
    ].map(csvEscape).join(','))),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

function buildExcelContent(rows) {
  const header = ['平台', '机器人名称', 'App ID', 'Secret', '描述', '更新时间', '创建时间'];
  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.platform)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.appId)}</td>
      <td>${escapeHtml(row.secret)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>${escapeHtml(row.updatedAt)}</td>
      <td>${escapeHtml(row.createdAt)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d9d0c2; padding: 8px 10px; text-align: left; }
      th { background: #f5efe4; }
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr>${header.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </body>
</html>`;
}

function buildExportFileName(extension) {
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace('T', '-').slice(0, 15);
  return `bot-inventory-${timestamp}.${extension}`;
}

function downloadBlob(content, type, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function renderInventoryDialog() {
  const dialogTotal = document.getElementById('inventory-dialog-total');
  const dialogContent = document.getElementById('inventory-dialog-content');

  if (exportInventoryState.loading) {
    dialogTotal.textContent = '读取中';
    dialogContent.innerHTML = '<div class="inventory-empty">正在读取机器人清单并补齐 Secret，请稍候…</div>';
    return;
  }

  if (exportInventoryState.error) {
    dialogTotal.textContent = '失败';
    dialogContent.innerHTML = `<div class="inventory-empty">${escapeHtml(exportInventoryState.error)}</div>`;
    return;
  }

  const rows = getExportRows();

  dialogTotal.textContent = `${rows.length} 条`;
  if (!rows.length) {
    dialogContent.innerHTML = '<div class="inventory-empty">没有符合当前过滤条件的机器人记录。</div>';
    return;
  }

  dialogContent.innerHTML = platforms.map((platform) => {
    const items = sortInventoryItems(exportInventoryState.inventory[platform] || []);
    const label = formatPlatformLabel(platform);

    if (!items.length) {
      return `
        <section class="inventory-modal-section">
          <div class="task-head">
            <span>${escapeHtml(label)}</span>
            <span class="task-summary">0 条</span>
          </div>
          <div class="inventory-empty">暂无记录</div>
        </section>
      `;
    }

    return `
      <section class="inventory-modal-section">
        <div class="task-head">
          <span>${escapeHtml(label)}</span>
          <span class="task-summary">${items.length} 条</span>
        </div>
        <div class="inventory-modal-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>机器人</th>
                <th>App ID</th>
                <th>Secret</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item) => `
                <tr>
                  <td class="inventory-table-name">
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>${escapeHtml(item.description || '无描述')}</small>
                  </td>
                  <td><code>${escapeHtml(item.appId)}</code></td>
                  <td><code class="inventory-secret">${escapeHtml(item.secret || '-')}</code></td>
                  <td>${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');
}

function openInventoryDialog() {
  const dialog = document.getElementById('inventory-dialog');
  renderInventoryDialog();
  dialog.showModal();
  void loadExportInventory();
}

function getInventoryFilterValues() {
  return {
    from: document.getElementById('inventory-filter-from').value.trim(),
    name: document.getElementById('inventory-filter-name').value.trim(),
    to: document.getElementById('inventory-filter-to').value.trim(),
  };
}

function buildInventoryExportUrl() {
  const params = new URLSearchParams();
  const filters = getInventoryFilterValues();

  if (filters.name) {
    params.set('name', filters.name);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }

  const query = params.toString();
  return query ? `/api/inventory/export?${query}` : '/api/inventory/export';
}

async function loadExportInventory() {
  exportInventoryState.loading = true;
  exportInventoryState.error = '';
  renderInventoryDialog();

  try {
    const response = await fetch(buildInventoryExportUrl(), { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '加载导出清单失败');
    }

    exportInventoryState.inventory = payload.inventory || {
      feishu: [],
      qq: [],
    };
    exportInventoryState.loading = false;
    renderInventoryDialog();
  } catch (error) {
    exportInventoryState.loading = false;
    exportInventoryState.error = error instanceof Error ? error.message : String(error);
    renderInventoryDialog();
  }
}

async function exportInventory(format) {
  if (exportInventoryState.loading) {
    return;
  }

  await loadExportInventory();
  if (exportInventoryState.error) {
    return;
  }

  const rows = getExportRows();
  if (!rows.length) {
    return;
  }

  if (format === 'csv') {
    downloadBlob(buildCsvContent(rows), 'text/csv;charset=utf-8', buildExportFileName('csv'));
    return;
  }

  downloadBlob(buildExcelContent(rows), 'application/vnd.ms-excel;charset=utf-8', buildExportFileName('xls'));
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

  currentState.auth = data.auth || {};
  currentState.inventory = data.inventory || {
    feishu: [],
    qq: [],
  };

  for (const platform of platforms) {
    renderAuth(platform, currentState.auth[platform]);
    renderInventory(platform, currentState.inventory[platform] || []);
  }

  document.getElementById('open-inventory-button').textContent = '全部机器人';

  const inventoryDialog = document.getElementById('inventory-dialog');
  if (inventoryDialog.open) {
    renderInventoryDialog();
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

  document.getElementById('open-inventory-button').addEventListener('click', () => {
    openInventoryDialog();
  });

  document.getElementById('refresh-button').addEventListener('click', () => {
    loadState().catch((error) => {
      console.error(error);
    });
  });

  const inventoryDialog = document.getElementById('inventory-dialog');
  document.getElementById('close-inventory-button').addEventListener('click', () => {
    inventoryDialog.close();
  });
  document.getElementById('apply-inventory-filter-button').addEventListener('click', () => {
    void loadExportInventory();
  });
  document.getElementById('export-csv-button').addEventListener('click', () => {
    void exportInventory('csv');
  });
  document.getElementById('export-excel-button').addEventListener('click', () => {
    void exportInventory('excel');
  });
  inventoryDialog.addEventListener('click', (event) => {
    if (event.target === inventoryDialog) {
      inventoryDialog.close();
    }
  });
  document.getElementById('inventory-filter-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void loadExportInventory();
    }
  });

  await loadAvatarPresets();
  await loadState();
}

bootstrap().catch((error) => {
  console.error(error);
});
