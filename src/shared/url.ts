import type { ParsedUrl } from './types';

const REJECTED_PROTOCOLS = new Set(['javascript:', 'vbscript:', 'data:']);

export function inspectUrl(raw: string, base?: string): ParsedUrl | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (REJECTED_PROTOCOLS.has(url.protocol)) return null;
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
  }

  const isBlob = url.protocol === 'blob:';
  let blobOrigin: string | undefined;
  let domain = '';
  let origin = '';
  if (isBlob) {
    domain = 'blob';
    const embedded = /^blob:(https?:\/\/[^/]+)/i.exec(url.href);
    if (embedded) blobOrigin = embedded[1].toLowerCase();
    origin = blobOrigin ?? 'blob:';
  } else if (url.hostname) {
    domain = url.hostname.toLowerCase().replace(/\.$/, '');
    origin = url.origin;
  } else {
    domain = url.protocol.replace(':', '');
    origin = url.protocol;
  }

  return {
    url: url.href,
    normalizedUrl: normalizedHref(url),
    domain,
    origin,
    filename: filenameOf(url),
    extension: extensionOf(url),
    isBlob,
    blobOrigin,
  };
}

export function normalizedHref(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  if (copy.hostname) copy.hostname = copy.hostname.toLowerCase().replace(/\.$/, '');
  if ((copy.protocol === 'https:' && copy.port === '443') || (copy.protocol === 'http:' && copy.port === '80')) {
    copy.port = '';
  }
  if ((copy.protocol === 'wss:' && copy.port === '443') || (copy.protocol === 'ws:' && copy.port === '80')) {
    copy.port = '';
  }
  return copy.href;
}

export function filenameOf(url: URL): string {
  if (url.protocol === 'blob:' || url.protocol === 'data:') return '';
  const segment = url.pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function extensionOf(url: URL): string | undefined {
  const filename = filenameOf(url);
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return undefined;
  const ext = filename.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return undefined;
  return ext;
}

export function publicInitiator(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('data:') || value.startsWith('blob:')) return value.slice(0, value.indexOf(':') + 1);
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return value.slice(0, 200);
  }
}

export function isRestrictedUrl(value: string | undefined): boolean {
  if (!value) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (
    url.protocol === 'chrome:' ||
    url.protocol === 'chrome-extension:' ||
    url.protocol === 'chrome-untrusted:' ||
    url.protocol === 'edge:' ||
    url.protocol === 'about:' ||
    url.protocol === 'devtools:' ||
    url.protocol === 'view-source:' ||
    url.protocol === 'chrome-search:'
  ) {
    return true;
  }
  if (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) return true;
  if (url.hostname === 'chromewebstore.google.com') return true;
  return false;
}

export function isSafeToOpen(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function domainFromUrl(value: string): string {
  return inspectUrl(value)?.domain ?? '';
}

export function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((part) => part.length > 0);
}

export function extractCssUrls(value: string): string[] {
  const found: string[] = [];
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const candidate = match[2]?.trim();
    if (!candidate || candidate.startsWith('data:') || candidate.length > 2000) continue;
    found.push(candidate);
  }
  return found;
}
