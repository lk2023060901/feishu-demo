import { Buffer } from 'node:buffer';
import { launchBrowser } from './playwright.mjs';

export const AVATAR_BACKGROUND_OPTIONS = [
  { id: 'blue', label: '蓝色', color: '#2f6df6' },
  { id: 'teal', label: '青绿', color: '#1dbf9c' },
  { id: 'sky', label: '天蓝', color: '#2397f3' },
  { id: 'amber', label: '金黄', color: '#ffab0f' },
  { id: 'orange', label: '橙色', color: '#ff7a00' },
  { id: 'pink', label: '玫红', color: '#e03a83' },
  { id: 'violet', label: '紫色', color: '#7c4dff' },
  { id: 'indigo', label: '靛蓝', color: '#4d50e6' },
];

export const AVATAR_ICON_OPTIONS = [
  {
    id: 'cube',
    label: '方块',
    markup: `
      <path d="M120 54 182 88 120 122 58 88 120 54Z" />
      <path d="M58 88v64l62 34 62-34V88" />
      <path d="M120 122v64" />
    `,
  },
  {
    id: 'bot',
    label: '机器人',
    markup: `
      <path d="M96 84V72a24 24 0 0 1 48 0v12" />
      <rect x="72" y="84" width="96" height="76" rx="18" />
      <circle cx="98" cy="116" r="5" fill="currentColor" stroke="none" />
      <circle cx="142" cy="116" r="5" fill="currentColor" stroke="none" />
      <path d="M98 144h44" />
      <path d="M120 58v10" />
    `,
  },
  {
    id: 'bolt',
    label: '闪电',
    markup: `
      <path d="M132 48 84 126h34l-10 66 48-78h-34z" />
    `,
  },
  {
    id: 'document',
    label: '文档',
    markup: `
      <path d="M84 54h52l32 32v100H84z" />
      <path d="M136 54v32h32" />
      <path d="M98 130h44" />
      <path d="M98 154h34" />
    `,
  },
  {
    id: 'bell',
    label: '提醒',
    markup: `
      <path d="M90 98a30 30 0 1 1 60 0c0 28 14 40 20 50H70c6-10 20-22 20-50" />
      <path d="M106 170a14 14 0 0 0 28 0" />
    `,
  },
  {
    id: 'check',
    label: '勾选',
    markup: `
      <circle cx="120" cy="120" r="64" />
      <path d="m92 122 18 18 38-38" />
    `,
  },
  {
    id: 'moon',
    label: '月亮',
    markup: `
      <path d="M156 54a70 70 0 1 0 26 130 58 58 0 1 1-26-130Z" />
    `,
  },
  {
    id: 'star',
    label: '星标',
    markup: `
      <path d="m120 54 18 36 40 6-29 28 7 40-36-19-36 19 7-40-29-28 40-6z" />
    `,
  },
  {
    id: 'tag',
    label: '标签',
    markup: `
      <path d="M72 110V72h58l38 38-58 58-38-38Z" />
      <circle cx="118" cy="96" r="6" fill="currentColor" stroke="none" />
    `,
  },
  {
    id: 'wrench',
    label: '扳手',
    markup: `
      <path d="M154 64a28 28 0 0 0-28 34l-48 48a16 16 0 1 0 22 22l48-48a28 28 0 0 0 34-28l-22 22-18-4-4-18z" />
    `,
  },
  {
    id: 'users',
    label: '团队',
    markup: `
      <circle cx="94" cy="96" r="18" />
      <circle cx="148" cy="104" r="16" />
      <path d="M60 170c0-22 18-38 40-38s40 16 40 38" />
      <path d="M128 170c0-18 14-30 32-30s32 12 32 30" />
    `,
  },
  {
    id: 'shield',
    label: '盾牌',
    markup: `
      <path d="M120 52 176 76v42c0 36-22 58-56 72-34-14-56-36-56-72V76l56-24Z" />
      <path d="m94 122 18 18 34-34" />
    `,
  },
  {
    id: 'layout',
    label: '布局',
    markup: `
      <rect x="68" y="68" width="104" height="104" rx="18" />
      <path d="M102 68v104" />
      <path d="M102 112h70" />
    `,
  },
  {
    id: 'code',
    label: '代码',
    markup: `
      <path d="m96 92-24 28 24 28" />
      <path d="m144 92 24 28-24 28" />
      <path d="m130 72-20 96" />
    `,
  },
];

export const DEFAULT_AVATAR_APPEARANCE = {
  backgroundColor: 'violet',
  icon: 'cube',
};

const backgroundMap = new Map(AVATAR_BACKGROUND_OPTIONS.map((item) => [item.id, item]));
const iconMap = new Map(AVATAR_ICON_OPTIONS.map((item) => [item.id, item]));

export function getAvatarPresetPayload() {
  return {
    backgrounds: AVATAR_BACKGROUND_OPTIONS,
    icons: AVATAR_ICON_OPTIONS,
    defaultAppearance: DEFAULT_AVATAR_APPEARANCE,
  };
}

export function normalizeAvatarAppearance(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const rawBackground = String(input.backgroundColor || '').trim();
  const rawIcon = String(input.icon || '').trim();

  if (!rawBackground && !rawIcon) {
    return null;
  }

  return {
    backgroundColor: backgroundMap.has(rawBackground)
      ? rawBackground
      : DEFAULT_AVATAR_APPEARANCE.backgroundColor,
    icon: iconMap.has(rawIcon)
      ? rawIcon
      : DEFAULT_AVATAR_APPEARANCE.icon,
  };
}

function getAvatarAppearanceDetails(appearance) {
  const normalized = normalizeAvatarAppearance(appearance);
  if (!normalized) {
    return null;
  }

  return {
    normalized,
    background: backgroundMap.get(normalized.backgroundColor),
    icon: iconMap.get(normalized.icon),
  };
}

export function renderAvatarSvg(appearance, { size = 240 } = {}) {
  const details = getAvatarAppearanceDetails(appearance);
  if (!details) {
    return '';
  }

  const { background, icon } = details;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 240 240" fill="none">
      <rect width="240" height="240" fill="${background.color}" />
      <circle cx="54" cy="48" r="42" fill="#ffffff" opacity="0.18" />
      <circle cx="192" cy="192" r="62" fill="#000000" opacity="0.12" />
      <g fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
        ${icon.markup}
      </g>
    </svg>
  `.trim();
}

export async function renderAvatarAsset(appearance) {
  const details = getAvatarAppearanceDetails(appearance);
  if (!details) {
    return null;
  }

  const browser = await launchBrowser();
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    viewport: { width: 240, height: 240 },
  });
  const page = await context.newPage();

  try {
    const svg = renderAvatarSvg(details.normalized);
    const base64 = Buffer.from(svg, 'utf8').toString('base64');

    await page.setContent(`
      <!doctype html>
      <html lang="zh-CN">
        <body style="margin:0;background:transparent;display:grid;place-items:center;">
          <img
            id="avatar"
            alt="avatar"
            width="240"
            height="240"
            src="data:image/svg+xml;base64,${base64}"
            style="display:block;width:240px;height:240px;"
          />
        </body>
      </html>
    `, { waitUntil: 'load' });

    await page.waitForFunction(() => {
      const node = document.getElementById('avatar');
      return node instanceof HTMLImageElement && node.complete;
    });

    const buffer = await page.locator('#avatar').screenshot({ type: 'png' });

    return {
      appearance: details.normalized,
      buffer,
      fileName: 'bot-avatar.png',
      mimeType: 'image/png',
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
