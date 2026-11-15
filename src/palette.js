// Palette model: base tokens + rule-driven derived tokens with per-token locks.
import { hexToHsl, mixHex, withLightness } from './color.js';

// Derivation rules. Every derived token is a pure function of its group base.
export const RULES = {
  hover: (hex) => withLightness(hex, hexToHsl(hex).l - 8),
  active: (hex) => withLightness(hex, hexToHsl(hex).l - 14),
  light: (hex) => mixHex(hex, '#FFFFFF', 0.8),
  dark: (hex) => withLightness(hex, hexToHsl(hex).l * 0.55),
  surface: (hex) => mixHex(hex, '#FFFFFF', 0.92),
  border: (hex) => mixHex(hex, '#FFFFFF', 0.72),
  muted: (hex) => mixHex(hex, '#FFFFFF', 0.55),
  text: (hex) => withLightness(hex, Math.min(hexToHsl(hex).l * 0.45, 26)),
};

let sequence = 0;
function token(groupId, label, hex, rule = null, locked = false) {
  return {
    id: rule ? `${groupId}-${rule}` : groupId,
    cssVar: `--color-${rule ? `${groupId}-${rule}` : groupId}`,
    groupId,
    label,
    kind: rule ? 'derived' : 'base',
    rule,
    hex,
    locked,
  };
}

export function createDefaultPalette() {
  sequence = 0;
  const groups = [
    {
      id: 'primary',
      label: '主色',
      seed: '#4F46E5',
      derived: [
        ['hover', '悬浮态'],
        ['active', '按下态'],
        ['light', '浅色（已锁定示例）', true],
        ['dark', '深色'],
      ],
    },
    {
      id: 'secondary',
      label: '辅助色',
      seed: '#0EA5E9',
      derived: [
        ['hover', '悬浮态'],
        ['light', '浅色'],
        ['dark', '深色'],
      ],
    },
    {
      id: 'neutral',
      label: '中性色',
      seed: '#475569',
      derived: [
        ['surface', '页面底色'],
        ['border', '描边'],
        ['muted', '弱化文本'],
        ['text', '正文文本'],
      ],
    },
  ];

  const tokens = {};
  const orderedIds = [];
  for (const group of groups) {
    const base = token(group.id, group.label, group.seed);
    tokens[base.id] = base;
    orderedIds.push(base.id);
    for (const [rule, label, locked = false] of group.derived) {
      const derived = token(group.id, label, RULES[rule](group.seed), rule, locked);
      tokens[derived.id] = derived;
      orderedIds.push(derived.id);
    }
  }
  return { groups: groups.map(({ id, label }) => ({ id, label })), tokens, orderedIds };
}

export function listTokens(palette) {
  return palette.orderedIds.map((id) => palette.tokens[id]);
}

export function baseTokenId(groupId) {
  return groupId;
}

// Recompute every unlocked derived token from its group base.
// Locked tokens (base or derived) are never touched.
export function recompute(palette) {
  for (const group of palette.groups) {
    const base = palette.tokens[group.id];
    for (const entry of listTokens(palette)) {
      if (entry.groupId !== group.id || entry.kind !== 'derived') continue;
      if (entry.locked) continue;
      entry.hex = RULES[entry.rule](base.hex);
    }
  }
  return palette;
}

export function setBaseColor(palette, groupId, hex) {
  const base = palette.tokens[groupId];
  if (!base || base.kind !== 'base') {
    throw new Error(`Unknown base token: ${groupId}`);
  }
  if (base.locked) {
    return false;
  }
  base.hex = hex.toUpperCase();
  recompute(palette);
  return true;
}

export function toggleLock(palette, tokenId) {
  const entry = palette.tokens[tokenId];
  if (!entry) return false;
  entry.locked = !entry.locked;
  return entry.locked;
}

// Ordered chart series derived from the live palette.
export function getChartSeries(palette) {
  const pick = (id) => palette.tokens[id].hex;
  return [
    { name: '主色', hex: pick('primary') },
    { name: '辅助色', hex: pick('secondary') },
    { name: '主色-浅', hex: pick('primary-light') },
    { name: '中性色', hex: pick('neutral') },
    { name: '主色-深', hex: pick('primary-dark') },
    { name: '辅助色-浅', hex: pick('secondary-light') },
  ];
}

export function toCssVariables(palette) {
  const lines = [':root {'];
  for (const group of palette.groups) {
    lines.push(`  /* ${group.label} */`);
    for (const entry of listTokens(palette)) {
      if (entry.groupId !== group.id) continue;
      lines.push(`  ${entry.cssVar}: ${entry.hex};${entry.locked ? ' /* locked */' : ''}`);
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

