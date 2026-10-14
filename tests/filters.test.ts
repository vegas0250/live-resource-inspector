import { describe, expect, it } from 'vitest';
import { createSessionState } from '../src/collector/state';
import { filterDomains, filterRequests, filterResources } from '../src/filters/query';
import type { FilterState } from '../src/filters/query';

const filter: FilterState = {
  text: '',
  categories: [],
  excludedDomains: [],
  sort: 'time',
  direction: 'asc',
};

describe('filters', () => {
  it('ищет по всему набору и сочетает категорию с текстом', () => {
    const state = createSessionState('s', 1);
    state.observeDiscovery({ url: 'https://cdn.example/movie.mp4', source: 'dom', element: 'video', time: 1, tabId: 1, linkText: 'Трейлер' });
    state.observeDiscovery({ url: 'https://cdn.example/song.mp3', source: 'dom', element: 'audio', time: 2, tabId: 1 });
    state.observeDiscovery({ url: 'https://other.test/readme.pdf', source: 'dom', element: 'a', time: 3, tabId: 1, linkText: 'Документ' });
    const resources = [...state.resources.values()];
    const found = filterResources(resources, { ...filter, text: 'трейлер mp4', categories: ['video'] });
    expect(found).toHaveLength(1);
    expect(found[0]?.filename).toBe('movie.mp4');
    const excluded = filterResources(resources, { ...filter, excludedDomains: ['cdn.example'] });
    expect(excluded.map((item) => item.domain)).toEqual(['other.test']);
  });

  it('сортирует домены по числу запросов и оставляет стабильный порядок', () => {
    const state = createSessionState('s', 1);
    state.observeNetwork({ phase: 'start', requestId: '1', url: 'https://b.example/a.js', method: 'GET', type: 'script', tabId: 1, time: 2 });
    state.observeNetwork({ phase: 'start', requestId: '2', url: 'https://a.example/a.js', method: 'GET', type: 'script', tabId: 1, time: 1 });
    state.observeNetwork({ phase: 'start', requestId: '3', url: 'https://a.example/b.js', method: 'GET', type: 'script', tabId: 1, time: 3 });
    const domains = filterDomains([...state.domains.values()], { ...filter, sort: 'count', direction: 'desc' });
    expect(domains.map((item) => item.domain)).toEqual(['a.example', 'b.example']);
    const requests = filterRequests([...state.requests.values()], { ...filter, categories: ['script'], sort: 'domain', direction: 'asc' });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.domain).toBe('a.example');
  });
});
