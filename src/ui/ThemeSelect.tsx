import { THEME_OPTIONS, themeFromControl } from './appearance';
import type { AppTheme } from '../shared/types';

export function ThemeSelect({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => void }) {
  return (
    <vui-select label="Тема" size="small" value={value} onChange={(event) => onChange(themeFromControl(event))}>
      {THEME_OPTIONS.map((item) => (
        <vui-option key={item.id} value={item.id}>{item.label}</vui-option>
      ))}
    </vui-select>
  );
}
