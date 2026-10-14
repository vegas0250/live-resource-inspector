import { useEffect, useState } from 'react';
import { openDashboard, readActiveTab, startMonitoring, tabState, control, updateSettings } from '../dashboard/api';
import { DASHBOARD_LINKS } from '../dashboard/focus';
import type { DashboardLink } from '../dashboard/focus';
import { emptyStats } from '../shared/types';
import type { AppTheme, SessionMeta } from '../shared/types';
import { isRestrictedUrl } from '../shared/url';
import { defaultSettings, loadSettings, normalizeSettings } from '../storage/settings';
import { applyAppearance } from '../ui/appearance';
import { ThemeSelect } from '../ui/ThemeSelect';
import './popup.css';

export function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [session, setSession] = useState<SessionMeta | undefined>();
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState<AppTheme>(defaultSettings.theme);

  useEffect(() => {
    let closed = false;
    let timer = 0;
    const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !changes.settings) return;
      const next = normalizeSettings(changes.settings.newValue);
      setTheme(next.theme);
      applyAppearance(next.theme);
    };
    chrome.storage.onChanged.addListener(onStorage);
    void (async () => {
      const settings = await loadSettings();
      if (!closed) {
        setTheme(settings.theme);
        applyAppearance(settings.theme);
      }
      const current = await readActiveTab();
      if (closed) return;
      setTab(current);
      if (!current?.id) return;
      const restricted = isRestrictedUrl(current.url);
      let response = await tabState(current.id);
      if (!response.session && !restricted) {
        response = await startMonitoring(current.id);
        if (!response.ok) setMessage(response.error ?? 'Не удалось начать наблюдение за вкладкой');
      }
      if (!closed) setSession(response.session);
      const tabId = current.id;
      timer = window.setInterval(() => {
        void tabState(tabId).then((next) => {
          if (!closed && next.session) setSession(next.session);
        });
      }, 500);
    })();
    return () => {
      closed = true;
      window.clearInterval(timer);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  const restricted = isRestrictedUrl(tab?.url);
  const domain = session?.domain || (tab?.url && !restricted ? safeDomain(tab.url) : 'недоступно');
  const stats = session?.stats ?? emptyStats();

  async function onPause() {
    if (!tab?.id) return;
    const response = await control('PAUSE', tab.id);
    setSession(response.session);
  }

  async function onResume() {
    if (!tab?.id) return;
    const response = await startMonitoring(tab.id);
    if (!response.ok) {
      setMessage(response.error ?? 'Не удалось продолжить мониторинг');
      return;
    }
    setSession(response.session);
    setMessage('');
  }

  async function onTheme(next: AppTheme) {
    const current = await loadSettings();
    const saved = await updateSettings({ ...current, theme: next });
    setTheme(saved.theme);
    applyAppearance(saved.theme);
  }

  function open(link?: Pick<DashboardLink, 'view' | 'category' | 'state'>) {
    if (!tab?.id || restricted) return;
    void openDashboard(tab.id, link);
  }

  return (
    <main>
      <button type="button" className="heading" onClick={() => open()} disabled={!tab?.id || restricted}>
        <p className="eyebrow">Live Resource Inspector</p>
        <h1>{domain}</h1>
      </button>
      <p className="url">{restricted ? 'Служебная страница закрыта для расширений' : tab?.url}</p>
      <p className={session?.status === 'running' ? 'status running' : 'status'}>
        {session?.status === 'running' ? 'Мониторинг идёт' : session?.status === 'paused' ? 'Пауза' : 'Ожидание вкладки'}
      </p>
      <div className="summary">
        {DASHBOARD_LINKS.map((link) => (
          <vui-button
            key={link.label}
            variant="secondary"
            className="counter"
            disabled={!tab?.id || restricted}
            onClick={() => open(link)}
          >
            <strong>{stats[link.stat].toLocaleString('ru-RU')}</strong>
            <span>{link.label}</span>
          </vui-button>
        ))}
      </div>
      {message ? <p className="message">{message}</p> : null}
      <div className="actions">
        <ThemeSelect value={theme} onChange={(next) => void onTheme(next)} />
        {session?.status === 'paused' ? (
          <vui-button variant="primary" disabled={!tab?.id || restricted} onClick={() => void onResume()}>Продолжить</vui-button>
        ) : (
          <vui-button variant="secondary" onClick={() => void onPause()} disabled={session?.status !== 'running'}>Пауза</vui-button>
        )}
      </div>
    </main>
  );
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
