import { describe, expect, it } from 'vitest';
import { extractCssUrls, inspectUrl, isRestrictedUrl, isSafeToOpen, parseSrcset, publicInitiator } from '../src/shared/url';

describe('url normalization', () => {
  it('сохраняет query и отбрасывает только фрагмент в ключе сравнения', () => {
    const withHash = inspectUrl('https://CDN.Example.com:443/a/b.mp4?token=1&x=2#t=10');
    const withoutHash = inspectUrl('https://cdn.example.com/a/b.mp4?token=1&x=2');
    expect(withHash?.url).toContain('token=1');
    expect(withHash?.normalizedUrl).toBe(withoutHash?.normalizedUrl);
    expect(withHash?.normalizedUrl).toContain('token=1&x=2');
    expect(withHash?.domain).toBe('cdn.example.com');
  });

  it('не склеивает разные query и не принимает javascript или data', () => {
    const first = inspectUrl('https://example.com/file.mp4?id=1');
    const second = inspectUrl('https://example.com/file.mp4?id=2');
    expect(first?.normalizedUrl).not.toBe(second?.normalizedUrl);
    expect(inspectUrl('javascript:alert(1)')).toBeNull();
    expect(inspectUrl('data:text/plain,hello')).toBeNull();
  });

  it('помечает blob как локальный ресурс и не подменяет его доменом сервера', () => {
    const blob = inspectUrl('blob:https://player.example.com/550e8400-e29b-41d4-a716-446655440000');
    expect(blob?.isBlob).toBe(true);
    expect(blob?.domain).toBe('blob');
    expect(blob?.blobOrigin).toBe('https://player.example.com');
  });

  it('убирает секреты из инициатора, но не из URL ресурса', () => {
    expect(publicInitiator('https://evil.example/app/index.html?token=secret#x')).toBe('https://evil.example/app/index.html');
    expect(inspectUrl('https://cdn.example.com/a.mp4?token=keep')?.url).toContain('token=keep');
  });

  it('определяет служебные страницы и безопасные схемы для открытия', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/abc')).toBe(true);
    expect(isRestrictedUrl('https://example.com/path')).toBe(false);
    expect(isSafeToOpen('https://example.com/a')).toBe(true);
    expect(isSafeToOpen('javascript:alert(1)')).toBe(false);
    expect(isSafeToOpen('blob:https://example.com/id')).toBe(false);
  });

  it('разбирает srcset и css url()', () => {
    expect(parseSrcset('a.png 1x, b.png 2x')).toEqual(['a.png', 'b.png']);
    expect(extractCssUrls('background: url("bg.webp"); mask: url(icon.svg)')).toEqual(['bg.webp', 'icon.svg']);
    expect(extractCssUrls('background: url(data:image/png;base64,aaaa)')).toEqual([]);
  });
});
