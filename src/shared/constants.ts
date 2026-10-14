export const HOST_ORIGINS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] as const;

export const DEFAULT_LIMITS = {
  maxResources: 80_000,
  maxRequests: 20_000,
  warnRatio: 0.8,
} as const;

export const CLIPBOARD_CHAR_LIMIT = 500_000;

export const SIGNIFICANT_CLEAR_COUNT = 100;
