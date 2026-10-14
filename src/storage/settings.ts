import { DEFAULT_LIMITS } from '../shared/constants';
import type { AppTheme, Settings } from '../shared/types';

const THEMES = new Set<AppTheme>(['system', 'light', 'dark', 'high-contrast', 'neon-green', 'neon-magenta', 'neon-cyan']);

export const defaultSettings: Settings = {
  scope: 'document',
  excludedDomains: [],
  maxResources: DEFAULT_LIMITS.maxResources,
  maxRequests: DEFAULT_LIMITS.maxRequests,
  theme: 'system',
};

export function isAppTheme(value: string): value is AppTheme {
  return THEMES.has(value as AppTheme);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings>;
  const excluded = Array.isArray(raw.excludedDomains)
    ? raw.excludedDomains.map((item) => String(item).trim().toLowerCase()).filter(Boolean).slice(0, 500)
    : [];
  return {
    scope: raw.scope === 'tab' ? 'tab' : 'document',
    excludedDomains: [...new Set(excluded)],
    maxResources: clamp(raw.maxResources, 1000, 200_000, defaultSettings.maxResources),
    maxRequests: clamp(raw.maxRequests, 100, 100_000, defaultSettings.maxRequests),
    theme: typeof raw.theme === 'string' && isAppTheme(raw.theme) ? raw.theme : 'system',
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  return normalizeSettings(stored.settings);
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ settings: normalized });
  return normalized;
}
