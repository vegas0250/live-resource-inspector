import { describe, expect, it } from 'vitest';
import { createSessionState } from '../src/collector/state';
import { resourceCsv, textLines } from '../src/export/exporters';
import { filterResources } from '../src/filters/query';

describe('large session', () => {
  it('сохраняет корректность на 50 000 записей', () => {
    const total = 50_000;
    const state = createSessionState('perf', 1, { maxResources: 80_000, maxRequests: 60_000, warnRatio: 0.95 });
    const started = performance.now();
    for (let index = 0; index < total; index += 1) {
      const domain = `cdn${index % 250}.example`;
      const kind = index % 5;
      const path = kind === 0 ? `v/${index}.mp4` : kind === 1 ? `a/${index}.mp3` : kind === 2 ? `i/${index}.png` : kind === 3 ? `s/${index}.js` : `x/${index}.bin`;
      state.observeNetwork({
        phase: 'start',
        requestId: `req-${index}`,
        url: `https://${domain}/${path}?n=${index}`,
        method: 'GET',
        type: kind === 2 ? 'image' : kind === 3 ? 'script' : 'other',
        tabId: 1,
        time: 10_000 + index,
      });
    }
    for (let index = 0; index < 1_000; index += 1) {
      state.observeNetwork({
        phase: 'complete',
        requestId: `req-${index}`,
        url: `https://cdn${index % 250}.example/${index % 5 === 0 ? `v/${index}.mp4` : index % 5 === 1 ? `a/${index}.mp3` : index % 5 === 2 ? `i/${index}.png` : index % 5 === 3 ? `s/${index}.js` : `x/${index}.bin`}?n=${index}`,
        statusCode: 200,
        mimeType: index % 5 === 0 ? 'video/mp4' : undefined,
        type: 'other',
        tabId: 1,
        time: 100_000 + index,
      });
    }
    const ingestMs = performance.now() - started;
    expect(state.resources.size).toBe(total);
    expect(state.stats.uniqueUrls).toBe(total);
    expect(state.stats.requests).toBe(total);
    expect(state.domains.size).toBe(250);

    const records = [...state.resources.values()];
    const filterStarted = performance.now();
    const videos = filterResources(records, {
      text: 'cdn10.example .mp4',
      categories: ['video'],
      excludedDomains: [],
      sort: 'domain',
      direction: 'asc',
    });
    const filterMs = performance.now() - filterStarted;
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((item) => item.categories.includes('video') && item.domain === 'cdn10.example')).toBe(true);

    const sortStarted = performance.now();
    const sorted = filterResources(records, {
      text: '',
      categories: [],
      excludedDomains: [],
      sort: 'domain',
      direction: 'asc',
    });
    const sortMs = performance.now() - sortStarted;
    expect(sorted).toHaveLength(total);
    expect(sorted[0]?.domain <= sorted[sorted.length - 1]!.domain).toBe(true);

    const exportStarted = performance.now();
    const lines = textLines(sorted.map((item) => item.url));
    const csv = resourceCsv(videos);
    const exportMs = performance.now() - exportStarted;
    const lineCount = lines.join('').trim().split('\n').length;
    expect(lineCount).toBe(total);
    expect(csv.join('')).toContain('cdn10.example');

    const timings = { ingestMs, filterMs, sortMs, exportMs, records: total };
    console.info(`PERF ${JSON.stringify(timings)}`);
    expect(ingestMs).toBeLessThan(20_000);
    expect(filterMs).toBeLessThan(3_000);
    expect(sortMs).toBeLessThan(5_000);
    expect(exportMs).toBeLessThan(8_000);
  });
});
