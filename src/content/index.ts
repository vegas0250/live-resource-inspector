import type { DomFinding, PageHints } from '../shared/types';

const MAX_SEEN = 100_000;
const URL_ATTRS = [
  'href',
  'src',
  'poster',
  'data',
  'data-src',
  'data-url',
  'data-href',
  'data-poster',
  'data-video',
  'data-audio',
  'data-original',
  'data-lazy-src',
  'data-srcset',
  'data-bg',
  'data-background',
  'data-image',
  'data-full',
  'data-file',
];

const ENGINE_RULES: Array<[string, RegExp]> = [
  ['unity', /(^|[^a-z])unity([^a-z]|$)/],
  ['phaser', /(^|[^a-z])phaser([^a-z]|$)/],
  ['godot', /(^|[^a-z])godot([^a-z]|$)/],
  ['construct', /(^|[^a-z])construct([^a-z]|$)/],
  ['ruffle', /(^|[^a-z])ruffle([^a-z]|$)/],
  ['playcanvas', /(^|[^a-z])playcanvas([^a-z]|$)/],
  ['cocos', /(^|[^a-z])cocos([^a-z]|$)/],
  ['melonjs', /(^|[^a-z])melonjs([^a-z]|$)/],
  ['pixi', /(^|[^a-z])pixi([^a-z]|$)/],
];

interface ContentApi {
  rescan: () => void;
  stop: () => void;
}

const root = globalThis as typeof globalThis & { __LRI__?: ContentApi };

if (root.__LRI__) {
  root.__LRI__.rescan();
} else {
  root.__LRI__ = boot();
}

function boot(): ContentApi {
  const seen = new Set<string>();
  let active = false;
  let stopped = false;
  let timer = 0;
  let observer: MutationObserver | null = null;
  let performanceObserver: PerformanceObserver | null = null;
  const pendingNodes: Element[] = [];
  const batch: DomFinding[] = [];
  let hintSignature = '';

  const scanSelector = [
    'a[href]',
    'area[href]',
    'link[href]',
    'img',
    'video',
    'audio',
    'source',
    'iframe',
    'embed',
    'object',
    'script[src]',
    'track[src]',
    '[poster]',
    '[data-src]',
    '[data-url]',
    '[data-href]',
    '[src]',
  ].join(',');

  function absolute(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || /^javascript:/i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed, document.baseURI);
      if (url.protocol === 'javascript:' || url.protocol === 'data:' || url.protocol === 'vbscript:') return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function push(url: string | null, finding: Omit<DomFinding, 'url'>): void {
    if (!url || seen.has(url) || seen.size >= MAX_SEEN) return;
    seen.add(url);
    batch.push({ url, ...finding });
    if (batch.length >= 150) flush();
  }

  function hints(): PageHints {
    const markers = new Set<string>();
    const consider = (value: string | null | undefined) => {
      const text = (value ?? '').toLowerCase();
      if (!text) return;
      for (const [name, pattern] of ENGINE_RULES) {
        if (pattern.test(text)) markers.add(name);
      }
    };
    document.querySelectorAll('script[src], link[href]').forEach((node) => {
      consider(node.getAttribute('src'));
      consider(node.getAttribute('href'));
    });
    consider(document.querySelector('meta[name="generator"]')?.getAttribute('content'));
    if (document.querySelector('canvas#unity-canvas, #unity-canvas, canvas[id*="godot" i]')) markers.add('unity');
    return { markers: [...markers].slice(0, 20), hasCanvas: Boolean(document.querySelector('canvas')) };
  }

  function elementHint(element: Element, attr: string): string {
    const tag = element.tagName.toLowerCase();
    if (attr === 'poster') return 'poster';
    if (tag === 'source') {
      const parent = element.parentElement?.tagName.toLowerCase();
      if (parent === 'video' || parent === 'audio') return `source:${parent}`;
    }
    return tag;
  }

  function remember(element: Element, raw: string, attr: string): void {
    if (attr === 'srcset' || attr === 'data-srcset') {
      for (const part of raw.split(',')) {
        push(absolute(part.trim().split(/\s+/)[0] ?? ''), baseFinding(element, attr));
      }
      return;
    }
    push(absolute(raw), baseFinding(element, attr));
  }

  function baseFinding(element: Element, attr: string): Omit<DomFinding, 'url'> {
    const tag = element.tagName.toLowerCase();
    const text = tag === 'a' || tag === 'area' ? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) : undefined;
    return {
      source: 'dom',
      element: elementHint(element, attr),
      linkText: text || undefined,
      rel: element.getAttribute('rel') ?? undefined,
      as: element.getAttribute('as') ?? undefined,
      frameUrl: location.href,
    };
  }

  function scanElement(element: Element): void {
    for (const attr of URL_ATTRS) {
      const value = element.getAttribute(attr);
      if (value) remember(element, value, attr);
    }
    if (element instanceof HTMLImageElement && element.srcset) remember(element, element.srcset, 'srcset');
    const style = element.getAttribute('style');
    if (style && style.includes('url(')) {
      const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(style))) {
        const candidate = match[2]?.trim() ?? '';
        if (candidate.startsWith('data:') || candidate.length > 2000) continue;
        push(absolute(candidate), { source: 'dom', element: 'style', frameUrl: location.href });
      }
    }
    if (element instanceof HTMLMediaElement && element.currentSrc) {
      push(absolute(element.currentSrc), baseFinding(element, 'src'));
    }
  }

  function scanRoot(rootNode: ParentNode): void {
    if (rootNode instanceof Element) scanElement(rootNode);
    if (!('querySelectorAll' in rootNode)) return;
    rootNode.querySelectorAll(scanSelector).forEach((node) => {
      if (node instanceof Element) scanElement(node);
    });
  }

  function flush(): void {
    if (batch.length === 0 || !active) return;
    const items = batch.splice(0, 200);
    const pageHints = hints();
    const signature = `${pageHints.hasCanvas}|${pageHints.markers.join(',')}`;
    const payload = signature === hintSignature ? { type: 'DOM_BATCH' as const, items } : { type: 'DOM_BATCH' as const, items, pageHints };
    hintSignature = signature;
    void chrome.runtime.sendMessage(payload).catch(() => {
      active = false;
    });
  }

  function schedule(): void {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      const nodes = pendingNodes.splice(0);
      if (nodes.length > 400) scanRoot(document);
      else for (const node of nodes) scanRoot(node);
      flush();
    }, 150);
  }

  function observeTiming(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    performanceObserver = new PerformanceObserver((list) => {
      if (!active) return;
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'resource') continue;
        const resource = entry as PerformanceResourceTiming;
        push(absolute(resource.name), {
          source: 'resourceTiming',
          initiatorType: resource.initiatorType,
          frameUrl: location.href,
          transferSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize,
        });
      }
      flush();
    });
    try {
      performanceObserver.observe({ type: 'resource', buffered: true });
    } catch {
      performanceObserver = null;
    }
  }

  function start(): void {
    if (stopped) return;
    active = true;
    const run = () => {
      scanRoot(document);
      flush();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    if (!observer) {
      const attach = () => {
        if (!document.documentElement || observer) return;
        observer = new MutationObserver((mutations) => {
          if (!active) return;
          for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.target instanceof Element) pendingNodes.push(mutation.target);
            mutation.addedNodes.forEach((node) => {
              if (node instanceof Element) pendingNodes.push(node);
            });
          }
          if (pendingNodes.length > 0) schedule();
        });
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: [...URL_ATTRS, 'srcset', 'style'],
        });
      };
      if (document.documentElement) attach();
      else document.addEventListener('DOMContentLoaded', attach, { once: true });
    }
    if (!performanceObserver) observeTiming();
  }

  function stop(): void {
    active = false;
    if (timer) window.clearTimeout(timer);
    timer = 0;
    pendingNodes.length = 0;
    batch.length = 0;
  }

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'STOP_SCAN') stop();
    if (message?.type === 'START_SCAN') start();
  });

  void chrome.runtime.sendMessage({ type: 'CONTENT_HELLO' }).then((response: { active?: boolean } | undefined) => {
    if (response?.active) start();
  }).catch(() => {
    stopped = true;
  });

  return {
    rescan: () => {
      if (active) {
        scanRoot(document);
        flush();
      } else {
        void chrome.runtime.sendMessage({ type: 'CONTENT_HELLO' }).then((response: { active?: boolean } | undefined) => {
          if (response?.active) start();
        });
      }
    },
    stop,
  };
}
