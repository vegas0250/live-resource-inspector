import { useEffect, useState } from 'react';
import { openDashboard, readActiveTab, requestHostAccess, startMonitoring, tabState, control } from '../dashboard/api';
import { isRestrictedUrl } from '../shared/url';
import type { SessionMeta } from '../shared/types';
import './popup.css';

export function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [session, setSession] = useState<SessionMeta | undefined>();
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      const current = await readActiveTab();
      setTab(current);
      if (!current?.id) return;
      const response = await tabState(current.id);
      setSession(response.session);
    })();
  }, []);

  const restricted = isRestrictedUrl(tab?.url);
  const domain = session?.domain || (tab?.url && !restricted ? safeDomain(tab.url) : 'недоступно');

  async function onStart() {
    if (!tab?.id) return;
    const granted = await requestHostAccess();
    if (!granted) {
      setMessage('Доступ к сайтам не выдан. Мониторинг чужих доменов не начнётся.');
      return;
    }
    const response = session?.status === 'paused' ? await control('RESUME', tab.id) : await startMonitoring(tab.id);
    if (!response.ok) {
      setMessage(response.error ?? 'Не удалось запустить мониторинг');
      return;
    }
    setSession(response.session);
    setMessage('');
  }

  async function onPause() {
    if (!tab?.id) return;
    const response = await control('PAUSE', tab.id);
    setSession(response.session);
  }

  return (
    <main>
      <p className="eyebrow">Live Resource Inspector</p>
      <h1>{domain}</h1>
      <p className="url">{restricted ? 'Служебная страница закрыта для расширений' : tab?.url}</p>
      <p className={session?.status === 'running' ? 'status running' : 'status'}>
        {session?.status === 'running' ? 'Мониторинг идёт' : session?.status === 'paused' ? 'Пауза' : 'Мониторинг не запущен'}
      </p>
      {session ? (
        <ul>
          <li>Запросы: {session.stats.requests}</li>
          <li>Уникальные URL: {session.stats.uniqueUrls}</li>
          <li>Домены: {session.stats.domains}</li>
          <li>Ошибки: {session.stats.errors}</li>
        </ul>
      ) : null}
      {message ? <p className="message">{message}</p> : null}
      <div className="actions">
        {session?.status === 'running' ? (
          <button type="button" onClick={() => void onPause()}>Пауза</button>
        ) : (
          <button type="button" className="primary" disabled={!tab?.id || restricted} onClick={() => void onStart()}>
            Начать
          </button>
        )}
        <button type="button" disabled={!tab?.id} onClick={() => tab?.id && void openDashboard(tab.id)}>
          Открыть анализатор
        </button>
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
