import { describe, expect, it } from 'vitest';
import { classify } from '../src/classifier/classify';
import { typeLabel } from '../src/shared/labels';

describe('classify', () => {
  it('распознаёт видео, аудио, изображения и документы по расширению', () => {
    expect(classify({ url: 'https://cdn.example.com/a/movie.mp4?token=abc' }).categories).toContain('video');
    expect(classify({ url: 'https://cdn.example.com/playlist.m3u8' })).toMatchObject({
      playlist: true,
      categories: expect.arrayContaining(['video']),
    });
    expect(classify({ url: 'https://cdn.example.com/manifest.mpd' }).playlist).toBe(true);
    expect(classify({ url: 'https://cdn.example.com/song.mp3' }).categories).toContain('audio');
    expect(classify({ url: 'https://cdn.example.com/photo.webp' }).categories).toContain('image');
    expect(classify({ url: 'https://cdn.example.com/file.pdf' }).categories).toContain('document');
    expect(classify({ url: 'https://cdn.example.com/file.zip' }).categories).toContain('archive');
    expect(classify({ url: 'https://cdn.example.com/app.js' }).categories).toContain('script');
    expect(classify({ url: 'https://cdn.example.com/app.css' }).categories).toContain('style');
    expect(classify({ url: 'https://cdn.example.com/font.woff2' }).categories).toContain('font');
  });

  it('не считает typescript-файл видео и распознаёт MPEG-TS только по MIME', () => {
    expect(classify({ url: 'https://cdn.example.com/app.ts' }).categories).not.toContain('video');
    expect(classify({ url: 'https://cdn.example.com/seg.ts', mimeType: 'video/mp2t' }).categories).toContain('video');
  });

  it('помечает радио как кандидата и не относит к нему обычный mp3 и HLS', () => {
    const file = classify({ url: 'https://cdn.example.com/song.mp3' });
    expect(file.radioCandidate).toBe(false);
    const hls = classify({ url: 'https://cdn.example.com/live.m3u8' });
    expect(hls.radioCandidate).toBe(false);
    const radio = classify({ url: 'https://radio.example.com/stream', mimeType: 'audio/mpeg' });
    expect(radio.radioCandidate).toBe(true);
    expect(radio.categories).toEqual(expect.arrayContaining(['audio', 'radio']));
    expect(classify({ url: 'https://radio.example.com/station.pls' }).radioCandidate).toBe(true);
  });

  it('не считает произвольный wasm игрой и отмечает игровой ресурс по контексту', () => {
    const wasm = classify({ url: 'https://cdn.example.com/module.wasm' });
    expect(wasm.gameCandidate).toBe(false);
    expect(wasm.categories).not.toContain('game');
    const game = classify({ url: 'https://cdn.example.com/game/build.wasm' });
    expect(game.gameCandidate).toBe(true);
    const hinted = classify({
      url: 'https://cdn.example.com/Build/player.wasm',
      pageHints: { markers: ['unity'], hasCanvas: true },
    });
    expect(hinted.gameCandidate).toBe(true);
    const image = classify({
      url: 'https://cdn.example.com/ui/logo.png',
      pageHints: { markers: ['unity'], hasCanvas: true },
    });
    expect(image.gameCandidate).toBe(false);
    const engine = classify({ url: 'https://cdn.example.com/lib/phaser.min.js' });
    expect(engine.gameCandidate).toBe(true);
    const community = classify({ url: 'https://cdn.example.com/community.js' });
    expect(community.gameCandidate).toBe(false);
  });

  it('объединяет ссылку и тип файла, а слабый /api/ не перебивает точное расширение', () => {
    const linked = classify({ url: 'https://example.com/report.pdf', element: 'a' });
    expect(linked.categories).toEqual(expect.arrayContaining(['link', 'document']));
    expect(linked.uncertain).toBe(false);
    const photo = classify({ url: 'https://cdn.example.com/api/photo.png', element: 'img' });
    expect(photo.categories).toContain('image');
    expect(photo.categories).not.toContain('api');
    expect(photo.uncertain).toBe(false);
    const weak = classify({ url: 'https://example.com/api/items' });
    expect(weak.categories).toContain('api');
    expect(weak.uncertain).toBe(true);
    expect(typeLabel(weak)).toContain('возможное совпадение');
  });

  it('отмечает xhr, websocket и неизвестный ресурс', () => {
    expect(classify({ url: 'https://api.example.com/v1/items', requestType: 'xmlhttprequest', mimeType: 'application/json' }).categories).toContain('api');
    expect(classify({ url: 'wss://example.com/socket', requestType: 'websocket' }).categories).toContain('websocket');
    const unknown = classify({ url: 'https://example.com/asset/without-type', requestType: 'other' });
    expect(unknown.categories).toEqual(['other']);
    expect(typeLabel(unknown)).toBe('Неизвестный тип');
    const media = classify({ url: 'https://cdn.example.com/blob-name', requestType: 'media' });
    expect(typeLabel(media)).toBe('Возможное совпадение');
  });
});
