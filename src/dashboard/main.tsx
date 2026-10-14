import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSettings } from '../storage/settings';
import { applyAppearance } from '../ui/appearance';
import { App } from './App';

void loadSettings().then((settings) => {
  applyAppearance(settings.theme);
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
});
