import { describe, expect, it } from 'vitest';
import { createSessionState } from '../src/collector/state';
import type { NetworkObservation } from '../src/shared/types';

function start(partial: Partial<Extract<NetworkObservation, { phase: 'start' }>>): NetworkObservation {
  return {
    phase: 'start',
    requestId: '1',
    url: 'https://cdn.example.com/a.mp4?id=1',
    method: 'GET',
    type: 'media',
    tabId: 7,
    time: 1_000,
    ...partial,
  };
}

describe('session dedupe', () => {
  it('объединяет повторы одного URL и накапливает источники', () => {
    const state = createSessionState('s1', 7);
    state.observeNetwork(start({}));
    state.observeNetwork(start({ requestId: '2', time: 1_500 }));
    state.observeDiscovery({
      url: 'https://cdn.example.com/a.mp4?id=1#frag',
      source: 'dom',
      element: 'video',
      time: 1_800,
      tabId: 7,
      linkText: 'Смотреть',
    });
    expect(state.resources.size).toBe(1);
    const record = [...state.resources.values()][0];
    expect(record?.hitCount).toBe(3);
    expect(record?.networkHits).toBe(2);
    expect(record?.sources).toEqual(['webRequest', 'dom']);
    expect(record?.categories).toContain('video');
    expect(record?.url).toContain('id=1');
    expect(state.stats.uniqueUrls).toBe(1);
    expect(state.stats.requests).toBe(2);
    expect(state.domains.get('cdn.example.com')?.requests).toBe(2);
  });

  it('не объединяет разные query, вкладки и сессии', () => {
    const first = createSessionState('s1', 7);
    const second = createSessionState('s2', 8);
    first.observeNetwork(start({ url: 'https://example.com/file.mp4?id=1' }));
    first.observeNetwork(start({ requestId: '2', url: 'https://example.com/file.mp4?id=2', tabId: 9 }));
    second.observeNetwork(start({ url: 'https://example.com/file.mp4?id=1', tabId: 8 }));
    expect(first.resources.size).toBe(1);
    expect(second.resources.size).toBe(1);
    expect([...first.resources.keys()][0]).not.toBe([...second.resources.keys()][0]);
  });

  it('обновляет один запрос по фазам и считает сетевую ошибку отдельно от HTTP-статуса', () => {
    const state = createSessionState('s1', 7);
    state.observeNetwork(start({ requestId: 'r', url: 'https://example.com/old' }));
    state.observeNetwork({
      phase: 'redirect',
      requestId: 'r',
      url: 'https://example.com/old',
      redirectUrl: 'https://cdn.example.com/new.mp4',
      statusCode: 302,
      type: 'other',
      tabId: 7,
      time: 1_100,
    });
    state.observeNetwork({
      phase: 'complete',
      requestId: 'r',
      url: 'https://cdn.example.com/new.mp4',
      statusCode: 200,
      mimeType: 'video/mp4; charset=binary',
      type: 'media',
      tabId: 7,
      time: 1_200,
    });
    expect(state.requests.size).toBe(1);
    const request = [...state.requests.values()][0];
    expect(request?.redirects).toEqual(['https://cdn.example.com/new.mp4']);
    expect(request?.state).toBe('complete');
    expect(request?.statusCode).toBe(200);
    expect(state.stats.requests).toBe(1);
    const media = [...state.resources.values()].find((item) => item.url.endsWith('new.mp4'));
    expect(media?.mimeType).toBe('video/mp4');
    expect(media?.categories).toContain('video');

    state.observeNetwork({
      phase: 'complete',
      requestId: 'missing',
      url: 'https://example.com/missing',
      statusCode: 404,
      type: 'other',
      tabId: 7,
      time: 1_300,
    });
    expect(state.stats.errors).toBe(0);
    state.observeNetwork({
      phase: 'error',
      requestId: 'bad',
      url: 'https://example.com/bad',
      error: 'net::ERR_FAILED',
      type: 'other',
      tabId: 7,
      time: 1_400,
    });
    expect(state.stats.errors).toBe(1);
  });

  it('после пересчёта агрегатов совпадает со счётчиками и прячет инициатор без query', () => {
    const state = createSessionState('s1', 7);
    state.pageUrl = 'https://site.example/watch';
    state.observeNetwork(start({ initiator: 'https://site.example/watch?token=secret', type: 'image', url: 'https://img.example/a.png' }));
    state.observeDiscovery({
      url: 'https://site.example/article',
      source: 'dom',
      element: 'a',
      linkText: 'Читать',
      time: 2_000,
      tabId: 7,
    });
    const before = { ...state.stats };
    state.rebuildAggregates();
    expect(state.stats).toEqual(before);
    const image = [...state.resources.values()].find((item) => item.extension === 'png');
    expect(image?.initiator).toBe('https://site.example/watch');
    expect(state.stats.domLinks).toBe(1);
  });

  it('останавливает новые URL на лимите и вытесняет старые строки запросов', () => {
    const state = createSessionState('s1', 7, { maxResources: 2, maxRequests: 2, warnRatio: 0.5 });
    state.observeNetwork(start({ requestId: 'a', url: 'https://example.com/1.js', type: 'script' }));
    state.observeNetwork(start({ requestId: 'b', url: 'https://example.com/2.js', type: 'script', time: 2 }));
    state.observeNetwork(start({ requestId: 'c', url: 'https://example.com/3.js', type: 'script', time: 3 }));
    expect(state.resources.size).toBe(2);
    expect(state.limited).toBe(true);
    expect(state.requests.size).toBe(2);
    expect(state.drainDirty().removedRequestIds.length).toBeGreaterThan(0);
    state.observeNetwork({
      phase: 'complete',
      requestId: 'a',
      url: 'https://example.com/1.js',
      statusCode: 200,
      mimeType: 'text/javascript',
      type: 'script',
      tabId: 7,
      time: 4,
    });
    expect(state.stats.requests).toBe(3);
  });
});
