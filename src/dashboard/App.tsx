import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  domainCsv,
  jsonParts,
  requestCsv,
  resourceCsv,
  textLines,
  toPublicDomain,
  toPublicRequest,
  toPublicResource,
} from '../export/exporters';
import type { FilterState } from '../filters/query';
import { SIGNIFICANT_CLEAR_COUNT } from '../shared/constants';
import { CATEGORY_LABELS, SOURCE_LABELS, STATE_LABELS, VIEW_LABELS, formatTime, typeLabel } from '../shared/labels';
import type { DashboardEvent } from '../shared/messages';
import { CATEGORY_ORDER } from '../shared/types';
import type { Category, DomainAggregate, RequestRecord, ResourceRecord, SessionMeta, Settings, SortDirection, SortKey, ViewId } from '../shared/types';
import { isSafeToOpen } from '../shared/url';
import { defaultSettings, loadSettings } from '../storage/settings';
import { control, listSessions, requestHostAccess, startMonitoring, tabState, updateScope, updateSettings } from './api';
import { DataTable } from './Table';
import type { TableColumn } from './Table';
import { copyText, deliver } from './deliver';
import { LiveModel } from './model';
import type { DisplayRow } from './model';
import './styles.css';

const model = new LiveModel();

export function App() {
  const revision = useSyncExternalStore(model.subscribe, model.getRevision, model.getRevision);
  const tabId = useMemo(() => Number(new URLSearchParams(location.search).get('tabId')) || 0, []);
  const [view, setView] = useState<ViewId>('resources');
  const [text, setText] = useState('');
  const [appliedText, setAppliedText] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [sort, setSort] = useState<SortKey>('time');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const anchor = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const filter = useMemo<FilterState>(
    () => ({
      text: appliedText,
      categories,
      excludedDomains: settings.excludedDomains,
      sort,
      direction,
    }),
    [appliedText, categories, settings.excludedDomains, sort, direction],
  );
  const rows = model.query(view, filter);
  void revision;

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedText(text), 120);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void refreshSessions();
    if (!tabId) return;
    void tabState(tabId).then((response) => {
      if (response.session) void model.open(response.session.id);
    });
  }, [tabId]);

  useEffect(() => {
    let closed = false;
    let port: chrome.runtime.Port | null = null;
    const connect = () => {
      port = chrome.runtime.connect({ name: 'dashboard' });
      port.onMessage.addListener((message: DashboardEvent) => {
        if (message.type === 'DIRTY' && message.sessionId === model.session?.id) void model.poll(message.pruneGeneration);
        if (message.type === 'SESSION' && message.session.tabId === tabId) void model.follow(message.session);
        if (message.type === 'CLEARED' && message.sessionId === model.session?.id) model.reset(message.session);
        if (message.type === 'SESSION' || message.type === 'CLEARED') void refreshSessions();
      });
      port.onDisconnect.addListener(() => {
        if (!closed) window.setTimeout(connect, 500);
      });
    };
    connect();
    const timer = window.setInterval(() => void model.poll(), 1500);
    return () => {
      closed = true;
      clearInterval(timer);
      port?.disconnect();
    };
  }, [tabId]);

  useEffect(() => {
    setSelected((current) => {
      const visible = new Set(rows.map((row) => row.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [rows]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setActiveId(null);
        setSettingsOpen(false);
        setExportOpen(false);
      }
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelected(new Set(rows.map((row) => row.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows]);

  const columns = useMemo(() => columnsFor(view), [view]);
  const active = rows.find((row) => row.id === activeId) ?? null;
  const session = model.session;
  const stats = session?.stats;

  async function refreshSessions() {
    const response = await listSessions();
    setSessions(response.sessions ?? []);
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }

  async function onStart() {
    if (!tabId) return;
    const granted = await requestHostAccess();
    if (!granted) {
      notify('Без доступа к сайтам видны только данные уже открытой страницы расширения.');
      return;
    }
    const response = session?.status === 'paused' ? await control('RESUME', tabId) : await startMonitoring(tabId);
    if (!response.ok || !response.session) {
      notify(response.error ?? 'Не удалось запустить мониторинг');
      return;
    }
    await model.follow(response.session);
    notify(session?.status === 'paused' ? 'Мониторинг продолжен' : 'Мониторинг запущен');
  }

  async function onPause() {
    const response = await control('PAUSE', tabId);
    if (response.session) await model.follow(response.session);
  }

  async function onClear() {
    const amount = (stats?.uniqueUrls ?? 0) + (stats?.requests ?? 0);
    if (amount >= SIGNIFICANT_CLEAR_COUNT) {
      setConfirmClear(true);
      return;
    }
    await doClear();
  }

  async function doClear() {
    setConfirmClear(false);
    const response = await control('CLEAR', tabId);
    if (response.session) model.reset(response.session);
    setSelected(new Set());
    setActiveId(null);
    notify('Данные текущей сессии удалены');
  }

  function onRow(row: DisplayRow, index: number, event: { shift: boolean; toggle: boolean }) {
    setActiveId(row.id);
    setSelected((current) => {
      if (event.shift) {
        const start = Math.min(anchor.current, index);
        const end = Math.max(anchor.current, index);
        const next = event.toggle ? new Set(current) : new Set<string>();
        for (let cursor = start; cursor <= end; cursor += 1) {
          const id = rows[cursor]?.id;
          if (id) next.add(id);
        }
        return next;
      }
      anchor.current = index;
      if (event.toggle) {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      }
      return new Set([row.id]);
    });
  }

  async function copyUrls(source: DisplayRow[]) {
    const lines = source.map(rowUrl).filter(Boolean);
    const result = await deliver('urls.txt', textLines(lines), 'text/plain;charset=utf-8');
    notify(result === 'clipboard' ? `Скопировано URL: ${lines.length}` : `Список большой, сохранён файл (${lines.length})`);
  }

  async function copyDomains(source: string[]) {
    const unique = [...new Set(source.filter(Boolean))];
    const result = await deliver('domains.txt', textLines(unique), 'text/plain;charset=utf-8');
    notify(result === 'clipboard' ? `Скопировано доменов: ${unique.length}` : `Список большой, сохранён файл (${unique.length})`);
  }

  const selectedRows = rows.filter((row) => selected.has(row.id));

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Live Resource Inspector</p>
          <h1>{session?.domain || 'Вкладка не выбрана'}</h1>
        </div>
        <p className={`status ${session?.status ?? 'idle'}`}>
          {session?.status === 'running' ? 'Мониторинг идёт' : session?.status === 'paused' ? 'Пауза' : 'Мониторинг не запущен'}
        </p>
        <div className="actions">
          {session?.status === 'running' ? (
            <button type="button" onClick={() => void onPause()}>Пауза</button>
          ) : (
            <button type="button" className="primary" onClick={() => void onStart()} disabled={!tabId}>Начать</button>
          )}
          <button type="button" onClick={() => void onClear()} disabled={!session}>Очистить</button>
          <button type="button" onClick={() => setExportOpen(true)}>Экспорт</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>Настройки</button>
        </div>
      </header>

      <section className="summary">
        <Counter label="Запросы" value={stats?.requests ?? 0} onClick={() => setView('requests')} />
        <Counter label="Уникальные URL" value={stats?.uniqueUrls ?? 0} onClick={() => setView('resources')} />
        <Counter label="Домены" value={stats?.domains ?? 0} onClick={() => setView('domains')} />
        <Counter label="Ссылки DOM" value={stats?.domLinks ?? 0} onClick={() => setView('links')} />
        <Counter label="Видео" value={stats?.video ?? 0} onClick={() => focusCategory('video', 'media')} />
        <Counter label="Аудио" value={stats?.audio ?? 0} onClick={() => focusCategory('audio', 'media')} />
        <Counter label="Игровые кандидаты" value={stats?.gameCandidates ?? 0} onClick={() => focusCategory('game', 'media')} />
        <Counter label="Ошибки" value={stats?.errors ?? 0} onClick={() => { setView('requests'); setText('ошибка'); }} />
      </section>

      {session?.warning ? <p className="banner">{session.warning}</p> : null}
      {model.error ? <p className="banner danger">{model.error}</p> : null}

      <div className="toolbar">
        <div className="views">
          {(Object.keys(VIEW_LABELS) as ViewId[]).map((item) => (
            <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Домен, URL, файл, MIME, категория, статус, источник"
          aria-label="Поиск"
        />
        <label>
          Сортировка
          <select value={`${sort}:${direction}`} onChange={(event) => {
            const [nextSort, nextDirection] = event.target.value.split(':') as [SortKey, SortDirection];
            setSort(nextSort);
            setDirection(nextDirection);
          }}>
            <option value="time:desc">Время, новые</option>
            <option value="time:asc">Время, старые</option>
            <option value="domain:asc">Домен А–Я</option>
            <option value="domain:desc">Домен Я–А</option>
            <option value="category:asc">Категория</option>
            <option value="count:desc">Количество</option>
          </select>
        </label>
        <label>
          Сессия
          <select
            value={session?.id ?? ''}
            onChange={(event) => {
              const next = sessions.find((item) => item.id === event.target.value);
              if (next) void model.open(next.id);
            }}
          >
            <option value="">Текущая</option>
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.domain} · {item.status === 'running' && !item.archived ? 'активна' : 'архив'} · {formatTime(item.startedAt)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chips">
        {CATEGORY_ORDER.map((category) => (
          <button
            key={category}
            type="button"
            className={categories.includes(category) ? 'chip on' : 'chip'}
            onClick={() => setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])}
          >
            {CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      <div className={active ? 'workspace with-detail' : 'workspace'}>
        <DataTable
          rows={rows}
          columns={columns}
          selected={selected}
          activeId={activeId}
          onRow={onRow}
          onToggle={(id) => setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
        />
        {active ? <Detail row={active} onClose={() => setActiveId(null)} onFindDomain={(domain) => { setView('resources'); setText(domain); }} onExclude={(domain) => void excludeDomain(domain)} /> : null}
      </div>

      <footer className="selection-bar">
        <span>{selectedRows.length > 0 ? `Выбрано: ${selectedRows.length}` : `В фильтре: ${rows.length}`}</span>
        <button type="button" onClick={() => setSelected(new Set(rows.map((row) => row.id)))}>Выделить фильтр</button>
        <button type="button" onClick={() => void copyUrls(selectedRows)} disabled={selectedRows.length === 0}>Копировать URL</button>
        <button type="button" onClick={() => void copyDomains(selectedRows.map(rowDomain))} disabled={selectedRows.length === 0}>Копировать домены</button>
        <button type="button" onClick={() => void copyRows(selectedRows)}>Копировать строки</button>
        <button type="button" onClick={() => void copyUrls(rows)}>URL фильтра</button>
        <button type="button" onClick={() => void copyUrls(model.allResources().map((resource) => ({ kind: 'resource', id: resource.id, resource })))}>Все уникальные URL</button>
        <button type="button" onClick={() => void copyDomains(model.allDomains().map((item) => item.domain))}>Все домены</button>
      </footer>

      {toast ? <div className="toast">{toast}</div> : null}
      {confirmClear ? (
        <dialog open className="modal">
          <form method="dialog">
            <h2>Очистить сессию?</h2>
            <p>Будут удалены {stats?.uniqueUrls ?? 0} уникальных URL и журнал из {stats?.requests ?? 0} запросов. Это действие только для текущей сессии.</p>
            <div className="actions">
              <button type="button" onClick={() => setConfirmClear(false)}>Отмена</button>
              <button type="button" className="danger" onClick={() => void doClear()}>Очистить</button>
            </div>
          </form>
        </dialog>
      ) : null}
      {exportOpen ? (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          onExport={(format, scope) => void runExport(format, scope)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => void save(next)}
        />
      ) : null}
    </div>
  );

  function focusCategory(category: Category, nextView: ViewId) {
    setView(nextView);
    setCategories([category]);
  }

  async function excludeDomain(domain: string) {
    const next = { ...settings, excludedDomains: [...new Set([...settings.excludedDomains, domain.toLowerCase()])] };
    const saved = await updateSettings(next);
    setSettings(saved);
    notify(`Домен ${domain} скрыт из списка. Сбор продолжается.`);
  }

  async function save(next: Settings) {
    const saved = await updateSettings(next);
    setSettings(saved);
    if (tabId) await updateScope(tabId, saved.scope);
    setSettingsOpen(false);
    notify('Настройки сохранены');
  }

  async function copyRows(source: DisplayRow[]) {
    const lines = source.map((row) => {
      if (row.kind === 'domain') return [row.domain.domain, row.domain.requests, row.domain.uniqueUrls, row.domain.categories.join('|')].join('\t');
      if (row.kind === 'request') return [row.request.url, row.request.method, row.request.type, row.request.statusCode ?? '', row.request.state].join('\t');
      return [row.resource.url, row.resource.categories.join('|'), row.resource.sources.join('|'), row.resource.mimeType ?? '', row.resource.state].join('\t');
    });
    const result = await copyText(lines.join('\n'), 'rows.txt');
    notify(result === 'clipboard' ? 'Строки скопированы' : 'Строки сохранены в файл');
  }

  async function runExport(format: 'txt' | 'csv' | 'json', scope: 'filtered' | 'selected' | 'all') {
    const picked = scope === 'selected' ? selectedRows : scope === 'filtered' ? rows : allRows(view);
    if (format === 'txt') {
      const lines = view === 'domains' ? picked.map(rowDomain) : picked.map(rowUrl);
      await deliver(`${view}.txt`, textLines(lines.filter(Boolean)), 'text/plain;charset=utf-8');
    } else if (format === 'csv') {
      const parts = view === 'domains'
        ? domainCsv(picked.flatMap((row) => row.kind === 'domain' ? [row.domain] : []))
        : view === 'requests'
          ? requestCsv(picked.flatMap((row) => row.kind === 'request' ? [row.request] : []))
          : resourceCsv(picked.flatMap((row) => row.kind === 'resource' ? [row.resource] : []));
      await deliver(`${view}.csv`, parts, 'text/csv;charset=utf-8');
    } else {
      const payload = picked.map((row) => {
        if (row.kind === 'domain') return toPublicDomain(row.domain);
        if (row.kind === 'request') return toPublicRequest(row.request);
        return toPublicResource(row.resource);
      });
      await deliver(`${view}.json`, jsonParts(payload), 'application/json');
    }
    setExportOpen(false);
    notify(`Экспорт ${format.toUpperCase()} готов`);
  }

  function allRows(current: ViewId): DisplayRow[] {
    if (current === 'domains') return model.allDomains().map((domain) => ({ kind: 'domain', id: `domain:${domain.domain}`, domain }));
    if (current === 'requests') return model.allRequests().map((request) => ({ kind: 'request', id: request.id, request }));
    let records = model.allResources();
    if (current === 'links') records = records.filter((record) => record.categories.includes('link'));
    if (current === 'media') {
      records = records.filter((record) => record.playlist || record.radioCandidate || record.gameCandidate || record.categories.some((category) => ['video', 'audio', 'radio', 'game'].includes(category)));
    }
    return records.map((resource) => ({ kind: 'resource', id: resource.id, resource }));
  }
}

function Counter({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" className="counter" onClick={onClick}>
      <strong>{value.toLocaleString('ru-RU')}</strong>
      <span>{label}</span>
    </button>
  );
}

function columnsFor(view: ViewId): TableColumn[] {
  if (view === 'domains') {
    return [
      { id: 'domain', title: 'Домен', width: '1.4fr', cell: (row) => row.kind === 'domain' ? row.domain.domain : '' },
      { id: 'requests', title: 'Запросы', width: '0.5fr', cell: (row) => row.kind === 'domain' ? String(row.domain.requests) : '' },
      { id: 'urls', title: 'URL', width: '0.5fr', cell: (row) => row.kind === 'domain' ? String(row.domain.uniqueUrls) : '' },
      { id: 'categories', title: 'Категории', width: '1.4fr', cell: (row) => row.kind === 'domain' ? row.domain.categories.map((item) => CATEGORY_LABELS[item]).join(', ') : '' },
      { id: 'first', title: 'Первый', width: '0.8fr', cell: (row) => row.kind === 'domain' ? formatTime(row.domain.firstSeen) : '' },
      { id: 'last', title: 'Последний', width: '0.8fr', cell: (row) => row.kind === 'domain' ? formatTime(row.domain.lastSeen) : '' },
    ];
  }
  if (view === 'requests') {
    return [
      { id: 'time', title: 'Время', width: '0.7fr', cell: (row) => row.kind === 'request' ? formatTime(row.request.timestamp) : '' },
      { id: 'method', title: 'Метод', width: '0.4fr', cell: (row) => row.kind === 'request' ? row.request.method : '' },
      { id: 'url', title: 'URL', width: '2fr', cell: (row) => row.kind === 'request' ? row.request.url : '' },
      { id: 'type', title: 'Тип', width: '0.6fr', cell: (row) => row.kind === 'request' ? row.request.type : '' },
      { id: 'status', title: 'Статус', width: '0.7fr', cell: (row) => row.kind === 'request' ? requestStatus(row.request) : '' },
      { id: 'redirects', title: 'Редиректы', width: '0.5fr', cell: (row) => row.kind === 'request' ? String(row.request.redirects.length) : '' },
    ];
  }
  return [
    { id: 'url', title: 'URL', width: '2fr', cell: (row) => row.kind === 'resource' ? row.resource.url : '' },
    { id: 'category', title: 'Категория', width: '0.9fr', cell: (row) => row.kind === 'resource' ? typeLabel(row.resource) : '' },
    { id: 'source', title: 'Источник', width: '0.8fr', cell: (row) => row.kind === 'resource' ? row.resource.sources.map((item) => SOURCE_LABELS[item]).join(', ') : '' },
    { id: 'mime', title: 'MIME', width: '0.7fr', cell: (row) => row.kind === 'resource' ? row.resource.mimeType ?? '' : '' },
    { id: 'status', title: 'Статус', width: '0.6fr', cell: (row) => row.kind === 'resource' ? resourceStatus(row.resource) : '' },
    { id: 'time', title: 'Обнаружен', width: '0.7fr', cell: (row) => row.kind === 'resource' ? formatTime(row.resource.firstSeen) : '' },
    { id: 'domain', title: 'Домен', width: '0.8fr', cell: (row) => row.kind === 'resource' ? row.resource.domain : '' },
  ];
}

function requestStatus(record: RequestRecord): string {
  return [record.statusCode, STATE_LABELS[record.state], record.error].filter(Boolean).join(' ');
}

function resourceStatus(record: ResourceRecord): string {
  return [record.statusCode, STATE_LABELS[record.state]].filter(Boolean).join(' ');
}

function rowUrl(row: DisplayRow): string {
  if (row.kind === 'domain') return row.domain.domain;
  if (row.kind === 'request') return row.request.finalUrl || row.request.url;
  return row.resource.url;
}

function rowDomain(row: DisplayRow): string {
  if (row.kind === 'domain') return row.domain.domain;
  if (row.kind === 'request') return row.request.domain;
  return row.resource.domain;
}

function Detail({ row, onClose, onFindDomain, onExclude }: {
  row: DisplayRow;
  onClose: () => void;
  onFindDomain: (domain: string) => void;
  onExclude: (domain: string) => void;
}) {
  const domain = rowDomain(row);
  const url = row.kind === 'domain' ? '' : rowUrl(row);
  const pageUrl = row.kind === 'resource' ? row.resource.pageUrl : undefined;
  return (
    <aside className="detail">
      <div className="detail-head">
        <h2>Подробности</h2>
        <button type="button" onClick={onClose}>Закрыть</button>
      </div>
      {row.kind === 'resource' ? <ResourceFacts record={row.resource} /> : null}
      {row.kind === 'request' ? <RequestFacts record={row.request} /> : null}
      {row.kind === 'domain' ? <DomainFacts record={row.domain} /> : null}
      <div className="detail-actions">
        {url && isSafeToOpen(url) ? <button type="button" onClick={() => void chrome.tabs.create({ url })}>Открыть URL</button> : null}
        {url ? <button type="button" onClick={() => void copyText(url, 'url.txt')}>Копировать URL</button> : null}
        <button type="button" onClick={() => void copyText(domain, 'domain.txt')}>Копировать домен</button>
        <button type="button" onClick={() => onFindDomain(domain)}>Другие записи домена</button>
        <button type="button" onClick={() => onExclude(domain)}>Исключить домен из вида</button>
        {pageUrl && isSafeToOpen(pageUrl) ? <button type="button" onClick={() => void chrome.tabs.create({ url: pageUrl })}>Открыть страницу-источник</button> : null}
      </div>
    </aside>
  );
}

function ResourceFacts({ record }: { record: ResourceRecord }) {
  return (
    <dl>
      <Fact label="URL" value={record.url} />
      <Fact label="Домен" value={record.domain} />
      <Fact label="Категория" value={typeLabel(record)} />
      <Fact label="Кандидат радио" value={record.radioCandidate ? 'да' : 'нет'} />
      <Fact label="Кандидат игры" value={record.gameCandidate ? 'да' : 'нет'} />
      <Fact label="Плейлист" value={record.playlist ? 'да' : 'нет'} />
      <Fact label="Источники" value={record.sources.map((item) => SOURCE_LABELS[item]).join(', ')} />
      <Fact label="MIME" value={record.mimeType} />
      <Fact label="Статус" value={resourceStatus(record)} />
      <Fact label="Метод" value={record.method} />
      <Fact label="Тип запроса" value={record.requestType} />
      <Fact label="Инициатор" value={record.initiator} />
      <Fact label="Элемент" value={record.elementHint} />
      <Fact label="Текст ссылки" value={record.linkText} />
      <Fact label="Повторы" value={String(record.hitCount)} />
      <Fact label="Сетевые попадания" value={String(record.networkHits)} />
      <Fact label="Первый раз" value={formatTime(record.firstSeen)} />
      <Fact label="Последний раз" value={formatTime(record.lastSeen)} />
      <Fact label="Blob" value={record.isBlob ? record.blobOrigin ?? 'локальный blob' : ''} />
      <Fact label="Страница" value={record.pageUrl} />
      <Fact label="Фрейм" value={record.frameUrl} />
      <Fact label="Ошибка" value={record.error} />
    </dl>
  );
}

function RequestFacts({ record }: { record: RequestRecord }) {
  return (
    <dl>
      <Fact label="URL" value={record.url} />
      <Fact label="Итоговый URL" value={record.finalUrl} />
      <Fact label="Домен" value={record.domain} />
      <Fact label="Метод" value={record.method} />
      <Fact label="Тип" value={record.type} />
      <Fact label="Статус" value={requestStatus(record)} />
      <Fact label="MIME" value={record.mimeType} />
      <Fact label="Инициатор" value={record.initiator} />
      <Fact label="Редиректы" value={record.redirects.join('\n')} />
      <Fact label="Кэш" value={record.fromCache ? 'да' : ''} />
      <Fact label="Время" value={formatTime(record.timestamp)} />
    </dl>
  );
}

function DomainFacts({ record }: { record: DomainAggregate }) {
  return (
    <dl>
      <Fact label="Домен" value={record.domain} />
      <Fact label="Запросы" value={String(record.requests)} />
      <Fact label="Уникальные URL" value={String(record.uniqueUrls)} />
      <Fact label="Категории" value={record.categories.map((item) => CATEGORY_LABELS[item]).join(', ')} />
      <Fact label="Первый" value={formatTime(record.firstSeen)} />
      <Fact label="Последний" value={formatTime(record.lastSeen)} />
    </dl>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ExportDialog({ onClose, onExport }: { onClose: () => void; onExport: (format: 'txt' | 'csv' | 'json', scope: 'filtered' | 'selected' | 'all') => void }) {
  const [format, setFormat] = useState<'txt' | 'csv' | 'json'>('txt');
  const [scope, setScope] = useState<'filtered' | 'selected' | 'all'>('filtered');
  return (
    <dialog open className="modal">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onExport(format, scope);
        }}
      >
        <h2>Экспорт</h2>
        <p>Полные URL сохраняются вместе с параметрами запроса. Cookies, заголовки авторизации и тела запросов в экспорт не входят. Подписанные ссылки сами по себе могут давать доступ к ресурсу.</p>
        <label>Формат
          <select value={format} onChange={(event) => setFormat(event.target.value as 'txt' | 'csv' | 'json')}>
            <option value="txt">TXT</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label>Набор
          <select value={scope} onChange={(event) => setScope(event.target.value as 'filtered' | 'selected' | 'all')}>
            <option value="filtered">Текущий фильтр</option>
            <option value="selected">Выбранные</option>
            <option value="all">Вся сессия в этом разделе</option>
          </select>
        </label>
        <div className="actions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary">Сохранить</button>
        </div>
      </form>
    </dialog>
  );
}

function SettingsDialog({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (settings: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [excluded, setExcluded] = useState(settings.excludedDomains.join('\n'));
  return (
    <dialog open className="modal wide">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...draft,
            excludedDomains: excluded.split(/\n+/).map((item) => item.trim()).filter(Boolean),
          });
        }}
      >
        <h2>Настройки</h2>
        <fieldset>
          <legend>Область сбора</legend>
          <label><input type="radio" name="scope" checked={draft.scope === 'document'} onChange={() => setDraft({ ...draft, scope: 'document' })} /> Только текущий документ, новая навигация открывает сессию</label>
          <label><input type="radio" name="scope" checked={draft.scope === 'tab'} onChange={() => setDraft({ ...draft, scope: 'tab' })} /> Вся вкладка, включая переходы SPA и полные загрузки</label>
        </fieldset>
        <label>Домены, скрытые из таблиц
          <textarea value={excluded} onChange={(event) => setExcluded(event.target.value)} rows={5} />
        </label>
        <label>Лимит уникальных URL
          <input type="number" min={1000} max={200000} value={draft.maxResources} onChange={(event) => setDraft({ ...draft, maxResources: Number(event.target.value) })} />
        </label>
        <label>Лимит строк запросов
          <input type="number" min={100} max={100000} value={draft.maxRequests} onChange={(event) => setDraft({ ...draft, maxRequests: Number(event.target.value) })} />
        </label>
        <ul className="limits">
          <li>Запросы не блокируются и не изменяются.</li>
          <li>blob: сохраняется как локальный адрес, это не URL сервера.</li>
          <li>webRequest видит рукопожатие WebSocket, но не кадры сообщений.</li>
          <li>chrome://, Chrome Web Store и чужие расширения недоступны.</li>
        </ul>
        <div className="actions">
          <button type="button" onClick={onClose}>Закрыть</button>
          <button type="submit" className="primary">Сохранить</button>
        </div>
      </form>
    </dialog>
  );
}
