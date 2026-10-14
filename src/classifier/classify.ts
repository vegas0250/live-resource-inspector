import { CATEGORY_ORDER, type Category, type Classification, type PageHints } from '../shared/types';

export interface ClassifyInput {
  url: string;
  extension?: string;
  mimeType?: string;
  requestType?: string;
  element?: string;
  rel?: string;
  as?: string;
  initiatorType?: string;
  pageHints?: PageHints;
}

const EXTENSION_CATEGORIES: Record<string, Category[]> = {
  mp4: ['video'],
  webm: ['video'],
  m4v: ['video'],
  mkv: ['video'],
  mov: ['video'],
  ogv: ['video'],
  m3u8: ['video'],
  mpd: ['video'],
  m4s: ['video'],
  cmfv: ['video'],
  cmfa: ['video'],
  mp3: ['audio'],
  wav: ['audio'],
  m4a: ['audio'],
  aac: ['audio'],
  flac: ['audio'],
  opus: ['audio'],
  wma: ['audio'],
  ogg: ['audio'],
  pls: ['audio'],
  m3u: ['audio'],
  asx: ['audio'],
  xspf: ['audio'],
  jpg: ['image'],
  jpeg: ['image'],
  png: ['image'],
  gif: ['image'],
  webp: ['image'],
  avif: ['image'],
  svg: ['image'],
  ico: ['image'],
  bmp: ['image'],
  apng: ['image'],
  js: ['script'],
  mjs: ['script'],
  cjs: ['script'],
  css: ['style'],
  woff: ['font'],
  woff2: ['font'],
  ttf: ['font'],
  otf: ['font'],
  eot: ['font'],
  pdf: ['document'],
  doc: ['document'],
  docx: ['document'],
  xls: ['document'],
  xlsx: ['document'],
  ppt: ['document'],
  pptx: ['document'],
  rtf: ['document'],
  odt: ['document'],
  ods: ['document'],
  odp: ['document'],
  zip: ['archive'],
  rar: ['archive'],
  '7z': ['archive'],
  tar: ['archive'],
  gz: ['archive'],
  tgz: ['archive'],
  bz2: ['archive'],
  xz: ['archive'],
};

const STRONG_ENGINES = new Set([
  'unity',
  'phaser',
  'godot',
  'construct',
  'ruffle',
  'playcanvas',
  'cocos',
  'melonjs',
]);

interface UrlParts {
  href: string;
  path: string;
  protocol: string;
}

function partsOf(url: string): UrlParts {
  try {
    const parsed = new URL(url);
    return {
      href: parsed.href.toLowerCase(),
      path: parsed.pathname.toLowerCase(),
      protocol: parsed.protocol,
    };
  } catch {
    return { href: url.toLowerCase(), path: '', protocol: '' };
  }
}

function mimeCategories(mimeType: string | undefined): Category[] {
  if (!mimeType) return [];
  const mime = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!mime || mime === 'application/octet-stream') return [];
  if (mime.startsWith('video/') || mime === 'application/vnd.apple.mpegurl' || mime === 'application/x-mpegurl' || mime === 'application/dash+xml') {
    return ['video'];
  }
  if (mime.startsWith('audio/')) return ['audio'];
  if (mime.startsWith('image/')) return ['image'];
  if (mime.startsWith('font/') || mime === 'application/font-woff' || mime === 'application/x-font-woff' || mime === 'application/font-sfnt') {
    return ['font'];
  }
  if (mime === 'text/css') return ['style'];
  if (mime.includes('javascript') || mime === 'application/ecmascript' || mime === 'text/ecmascript') return ['script'];
  if (mime === 'application/pdf' || mime === 'application/msword' || mime.includes('officedocument') || mime === 'application/rtf') {
    return ['document'];
  }
  if (
    mime === 'application/zip' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/gzip' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/vnd.rar' ||
    mime === 'application/x-tar' ||
    mime === 'application/x-bzip2' ||
    mime === 'application/x-xz'
  ) {
    return ['archive'];
  }
  if (mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json') || mime === 'application/graphql') {
    return ['api'];
  }
  return [];
}

function elementCategories(element: string | undefined, rel: string | undefined, asAttr: string | undefined): Category[] {
  const relValue = (rel ?? '').toLowerCase();
  const asValue = (asAttr ?? '').toLowerCase();
  if (element === 'poster' || element === 'img' || element === 'image' || element === 'icon') return ['image'];
  if (element === 'video' || element === 'source:video') return ['video'];
  if (element === 'audio' || element === 'source:audio') return ['audio'];
  if (element === 'script') return ['script'];
  if (element === 'a' || element === 'area') return ['link'];
  if (element === 'link') {
    if (relValue.includes('stylesheet') || asValue === 'style') return ['style'];
    if (asValue === 'script') return ['script'];
    if (asValue === 'font') return ['font'];
    if (asValue === 'image') return ['image'];
    if (asValue === 'video') return ['video'];
    if (asValue === 'audio') return ['audio'];
    if (relValue.includes('icon')) return ['image'];
  }
  return [];
}

function initiatorCategories(initiatorType: string | undefined): Category[] {
  switch ((initiatorType ?? '').toLowerCase()) {
    case 'img':
    case 'image':
    case 'icon':
      return ['image'];
    case 'script':
      return ['script'];
    case 'css':
    case 'link':
      return [];
    case 'video':
      return ['video'];
    case 'audio':
      return ['audio'];
    case 'fetch':
    case 'xmlhttprequest':
      return ['api'];
    default:
      return [];
  }
}

function requestTypeCategories(requestType: string | undefined): { categories: Category[]; strength: 'strong' | 'weak' } {
  switch (requestType) {
    case 'stylesheet':
      return { categories: ['style'], strength: 'strong' };
    case 'script':
      return { categories: ['script'], strength: 'strong' };
    case 'image':
      return { categories: ['image'], strength: 'strong' };
    case 'font':
      return { categories: ['font'], strength: 'strong' };
    case 'xmlhttprequest':
    case 'fetch':
      return { categories: ['api'], strength: 'strong' };
    case 'websocket':
      return { categories: ['websocket'], strength: 'strong' };
    case 'media':
      return { categories: [], strength: 'weak' };
    default:
      return { categories: [], strength: 'strong' };
  }
}

function playlistOf(extension: string | undefined, mime: string, href: string): boolean {
  if (extension === 'm3u8' || extension === 'mpd' || extension === 'm3u' || extension === 'pls') return true;
  if (mime.includes('mpegurl') || mime.includes('dash+xml')) return true;
  return href.endsWith('.m3u8') || href.endsWith('.mpd');
}

function radioScore(href: string, path: string, extension: string | undefined, categories: Set<Category>, mime: string): number {
  if (extension === 'm3u8' || extension === 'mpd') return 0;
  let score = 0;
  if (extension === 'pls' || extension === 'm3u' || extension === 'asx' || extension === 'xspf') score += 3;
  if (/icecast|shoutcast|radiostream/.test(href)) score += 3;
  if (/\/radio(\/|$|\?)/.test(path) || /\/radio(\/|$|\?)/.test(href)) score += 2;
  const audio = categories.has('audio') || mime.startsWith('audio/');
  if (audio && !extension && /stream|live/.test(href)) score += 3;
  if (audio && /\/stream(\/|$|\?)/.test(href)) score += 2;
  return score;
}

function gameScore(input: ClassifyInput, parts: UrlParts, extension: string | undefined): number {
  const markers = new Set(input.pageHints?.markers ?? []);
  const engineInUrl = /(^|[^a-z])(unity|phaser|godot|construct|ruffle|playcanvas|cocos|melonjs|pixi)([^a-z]|$)/.test(parts.href);
  const engineOnPage = [...markers].some((marker) => STRONG_ENGINES.has(marker) || marker === 'pixi');
  const interesting =
    extension === 'wasm' ||
    extension === 'unityweb' ||
    extension === 'pck' ||
    extension === 'rpa' ||
    extension === 'data' ||
    engineInUrl;
  if (!interesting) return 0;

  let score = 0;
  if (extension === 'wasm') score += 1;
  if (extension === 'unityweb' || extension === 'pck' || extension === 'rpa') score += 2;
  if (extension === 'data' && (engineInUrl || engineOnPage)) score += 2;
  if (engineInUrl) score += 2;
  if (engineInUrl && (extension === 'js' || extension === 'mjs')) score += 2;
  if (engineOnPage && (extension === 'wasm' || extension === 'data' || extension === 'unityweb' || extension === 'pck' || extension === 'rpa')) {
    score += 2;
  }
  if (/\/games?(\/|$)/.test(parts.path) && (extension === 'wasm' || extension === 'data' || extension === 'unityweb' || engineInUrl)) {
    score += 2;
  }
  return score;
}

function sortCategories(categories: Set<Category>): Category[] {
  if (categories.size === 0) return ['other'];
  categories.delete('other');
  if (categories.size === 0) return ['other'];
  return CATEGORY_ORDER.filter((category) => categories.has(category));
}

export function classify(input: ClassifyInput): Classification {
  const parts = partsOf(input.url);
  const extension = input.extension ?? extensionFromPath(parts.path);
  const mime = (input.mimeType ?? '').toLowerCase();
  const strong = new Set<Category>();
  const weak = new Set<Category>();

  const add = (categories: Category[], strength: 'strong' | 'weak') => {
    const target = strength === 'strong' ? strong : weak;
    for (const category of categories) target.add(category);
  };

  add(mimeCategories(input.mimeType), 'strong');

  if (extension === 'ts') {
    if (mime === 'video/mp2t') add(['video'], 'strong');
  } else if (extension === 'ogg') {
    if (mime.startsWith('video/') || input.element === 'video' || input.element === 'source:video') add(['video'], 'strong');
    else add(['audio'], 'strong');
  } else if (extension && EXTENSION_CATEGORIES[extension]) {
    add(EXTENSION_CATEGORIES[extension], 'strong');
  }

  if (parts.protocol === 'ws:' || parts.protocol === 'wss:') add(['websocket'], 'strong');

  const requestType = requestTypeCategories(input.requestType);
  if (requestType.categories.length > 0) add(requestType.categories, requestType.strength);
  const mediaOnly = input.requestType === 'media' && strong.size === 0;

  add(elementCategories(input.element, input.rel, input.as), 'strong');
  const initiator = initiatorCategories(input.initiatorType);
  if (initiator.length) add(initiator, 'strong');
  if ((input.initiatorType ?? '').toLowerCase() === 'css') add(['style'], 'strong');

  if (/\/api(\/|$)/.test(parts.path) || /\/graphql(\/|$)/.test(parts.path)) add(['api'], 'weak');

  const categories = new Set<Category>(strong.size > 0 ? strong : weak);
  const uncertain = (strong.size === 0 && weak.size > 0) || (mediaOnly && !categories.has('video') && !categories.has('audio'));
  const playlist = playlistOf(extension, mime, parts.href);
  const radioCandidate = radioScore(parts.href, parts.path, extension, categories, mime) >= 3;
  const gameCandidate = gameScore(input, parts, extension) >= 3;
  if (radioCandidate) {
    categories.add('radio');
    if (!categories.has('audio') && !categories.has('video')) categories.add('audio');
  }
  if (gameCandidate) categories.add('game');

  return {
    categories: sortCategories(categories),
    uncertain,
    radioCandidate,
    gameCandidate,
    playlist,
  };
}

function extensionFromPath(path: string): string | undefined {
  const segment = path.split('/').pop() ?? '';
  const dot = segment.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = segment.slice(dot + 1);
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return undefined;
  return ext;
}
