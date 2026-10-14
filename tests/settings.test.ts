import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/storage/settings';

describe('settings theme', () => {
  it('без ручного выбора следует системе', () => {
    expect(normalizeSettings({}).theme).toBe('system');
    expect(normalizeSettings({ theme: 'nope' }).theme).toBe('system');
  });

  it('сохраняет выбранную тему', () => {
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(normalizeSettings({ theme: 'neon-cyan' }).theme).toBe('neon-cyan');
  });
});
