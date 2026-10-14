import { describe, expect, it } from 'vitest';
import { createSessionState } from '../src/collector/state';
import {
  csvCell,
  deliveryPlan,
  domainCsv,
  jsonParts,
  partsLength,
  requestCsv,
  resourceCsv,
  textLines,
  toPublicResource,
} from '../src/export/exporters';
import type { ResourceRecord } from '../src/shared/types';

describe('export', () => {
  it('экранирует кавычки, запятые и переводы строк', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nnext')).toBe('"line\nnext"');
  });

  it('не включает cookies и посторонние поля в JSON', () => {
    const state = createSessionState('s', 1);
    state.observeDiscovery({
      url: 'https://example.com/a.png',
      source: 'dom',
      element: 'img',
      time: 1,
      tabId: 1,
    });
    const record = [...state.resources.values()][0] as ResourceRecord;
    const polluted = { ...record, cookie: 'super-secret-cookie', authorization: 'Bearer token' };
    const json = jsonParts([toPublicResource(polluted)]).join('');
    expect(json).not.toContain('super-secret-cookie');
    expect(json).not.toContain('Bearer');
    expect(json).toContain('https://example.com/a.png');
  });

  it('собирает txt, csv и json порциями', () => {
    const state = createSessionState('s', 1);
    state.observeNetwork({
      phase: 'start',
      requestId: '1',
      url: 'https://example.com/a.js',
      method: 'GET',
      type: 'script',
      tabId: 1,
      time: 1,
    });
    const resources = [...state.resources.values()];
    const requests = [...state.requests.values()];
    const domains = [...state.domains.values()];
    expect(textLines(resources.map((item) => item.url)).join('')).toContain('https://example.com/a.js');
    expect(resourceCsv(resources).join('')).toContain('url,domain,categories');
    expect(requestCsv(requests).join('')).toContain('script');
    expect(domainCsv(domains).join('')).toContain('example.com');
    expect(deliveryPlan(10)).toBe('clipboard');
    expect(deliveryPlan(partsLength(['x'.repeat(500_001)]))).toBe('file');
  });
});
