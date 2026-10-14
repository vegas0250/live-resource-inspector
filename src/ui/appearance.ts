import { setDensity, setTheme } from 'vui/theme';
import 'vui/alert';
import 'vui/button';
import 'vui/dialog';
import 'vui/input';
import 'vui/radio';
import 'vui/select';
import 'vui/textarea';
import 'vui/toolbar';
import type { AppTheme } from '../shared/types';
import { isAppTheme } from '../storage/settings';

export const THEME_OPTIONS: Array<{ id: AppTheme; label: string }> = [
  { id: 'system', label: 'Как в системе' },
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'high-contrast', label: 'Контрастная' },
  { id: 'neon-green', label: 'Неон, зелёный' },
  { id: 'neon-magenta', label: 'Неон, пурпурный' },
  { id: 'neon-cyan', label: 'Неон, голубой' },
];

export function applyAppearance(theme: AppTheme): void {
  setTheme(theme);
  setDensity('compact');
}

export function controlValue(event: { currentTarget: EventTarget | null }): string {
  const host = event.currentTarget;
  if (!(host instanceof HTMLElement)) return '';
  return host.getAttribute('value') ?? '';
}

export function themeFromControl(event: { currentTarget: EventTarget | null }): AppTheme {
  const value = controlValue(event);
  return isAppTheme(value) ? value : 'system';
}

applyAppearance('system');
