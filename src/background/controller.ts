import { createSessionState, type SessionState } from '../collector/state';
import { createId } from '../shared/id';
import type { DashboardEvent, TabStateResponse } from '../shared/messages';
import type { DomFinding, NetworkObservation, PageHints, SessionMeta, SessionScope, Settings } from '../shared/types';
import { emptyPageHints, emptyStats } from '../shared/types';
import { domainFromUrl, isRestrictedUrl } from '../shared/url';
import { DEFAULT_LIMITS } from '../shared/constants';
import {
  deleteSessionRecords,
  getAllBySession,
  putRecords,
  putSession,
  listSessions,
  deleteIds,
} from '../storage/db';
import { loadSettings, saveSettings } from '../storage/settings';
import type { RequestRecord, ResourceRecord } from '../shared/types';

type Port = chrome.runtime.Port;

export class Monitor {
  private readonly states = new Map<string, SessionState>();
  private readonly metas = new Map<string, SessionMeta>();
  private readonly byTab = new Map<number, string>();
  private readonly ports = new Set<Port>();
  private readonly queue: NetworkObservation[] = [];
  private readonly domQueue: Array<{ tabId: number; items: DomFinding[]; hints?: PageHints }> = [];
  private settings: Settings | null = null;
  private booted = false;
  private bootPromise: Promise<void> | null = null;
  private flushTail: Promise<void> = Promise.resolve();
  private pendingFlush = new Set<string>();

  constructor() {
    this.bootPromise = this.boot();
  }

  addPort(port: Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
  }

  onNetwork(observation: NetworkObservation): void {
    if (!this.booted) {
      this.queue.push(observation);
      return;
    }
    this.applyNetwork(observation);
  }

  async start(tabId: number): Promise<TabStateResponse> {
    await this.ready();
    const tab = await this.readTab(tabId);
    if (!tab?.url || isRestrictedUrl(tab.url)) {
      return {
        ok: false,
        restricted: true,
        error: 'Эта страница недоступна для расширений: служебные адреса, Chrome Web Store и другие закрытые контексты не наблюдаются.',
      };
    }
    const settings = await this.ensureSettings();
    let meta = this.metaForTab(tabId);
    if (!meta || meta.archived) {
      meta = this.createMeta(tabId, tab.url, tab.title ?? '', settings);
      const state = createSessionState(meta.id, tabId, {
        maxResources: settings.maxResources,
        maxRequests: settings.maxRequests,
        warnRatio: DEFAULT_LIMITS.warnRatio,
      });
      state.pageUrl = tab.url;
      this.states.set(meta.id, state);
      this.metas.set(meta.id, meta);
    }
    meta.status = 'running';
    meta.archived = false;
    meta.url = tab.url;
    meta.title = tab.title ?? meta.title;
    meta.domain = domainFromUrl(tab.url);
    meta.updatedAt = Date.now();
    meta.scope = settings.scope;
    const state = this.states.get(meta.id);
    if (state) state.pageUrl = tab.url;
    this.byTab.set(tabId, meta.id);
    await putSession(meta);
    await this.persistActive();
    await this.injectAll(tabId);
    this.broadcast({ type: 'SESSION', session: meta });
    return { ok: true, session: meta };
  }

  async pause(tabId: number): Promise<TabStateResponse> {
    await this.ready();
    const meta = this.metaForTab(tabId);
    if (!meta) return { ok: false, error: 'Мониторинг этой вкладки не запущен.' };
    meta.status = 'paused';
    meta.updatedAt = Date.now();
    await this.persistMeta(meta);
    await this.signalFrames(tabId, { type: 'STOP_SCAN' });
    this.broadcast({ type: 'SESSION', session: meta });
    return { ok: true, session: meta };
  }

  async resume(tabId: number): Promise<TabStateResponse> {
    await this.ready();
    const meta = this.metaForTab(tabId);
    if (!meta) return this.start(tabId);
    const tab = await this.readTab(tabId);
    if (!tab?.url || isRestrictedUrl(tab.url)) {
      return { ok: false, restricted: true, error: 'Текущая страница недоступна для мониторинга.' };
    }
    meta.status = 'running';
    meta.archived = false;
    meta.updatedAt = Date.now();
    await this.persistMeta(meta);
    await this.injectAll(tabId);
    this.broadcast({ type: 'SESSION', session: meta });
    return { ok: true, session: meta };
  }

  async clear(tabId: number): Promise<TabStateResponse> {
    await this.ready();
    const meta = this.metaForTab(tabId);
    if (!meta) return { ok: false, error: 'Нет данных для очистки.' };
    const state = this.states.get(meta.id);
    state?.clear();
    meta.stats = emptyStats();
    meta.warning = undefined;
    meta.limited = false;
    meta.pageHints = emptyPageHints();
    meta.pruneGeneration += 1;
    meta.updatedAt = Date.now();
    await deleteSessionRecords(meta.id);
    await putSession(meta);
    await this.persistActive();
    this.broadcast({ type: 'CLEARED', sessionId: meta.id, session: meta });
    return { ok: true, session: meta };
  }

  async setScope(tabId: number, scope: SessionScope): Promise<TabStateResponse> {
    await this.ready();
    const settings = await loadSettings();
    settings.scope = scope;
    this.settings = settings;
    await saveSettings(settings);
    for (const state of this.states.values()) {
      state.limits.maxResources = settings.maxResources;
      state.limits.maxRequests = settings.maxRequests;
    }
    const meta = this.metaForTab(tabId);
    if (meta) {
      meta.scope = scope;
      meta.updatedAt = Date.now();
      await this.persistMeta(meta);
      this.broadcast({ type: 'SESSION', session: meta });
    }
    return { ok: true, session: meta };
  }

  async getTabState(tabId: number): Promise<TabStateResponse> {
    await this.ready();
    return { ok: true, session: this.metaForTab(tabId) };
  }

  async list(): Promise<TabStateResponse> {
    await this.ready();
    const sessions = await listSessions<SessionMeta>();
    return { ok: true, sessions };
  }

  contentHello(tabId: number | undefined): { active: boolean; sessionId?: string } {
    if (!tabId) return { active: false };
    const meta = this.metaForTab(tabId);
    if (!meta || meta.status !== 'running' || meta.archived) return { active: false };
    return { active: true, sessionId: meta.id };
  }

  onDom(tabId: number | undefined, items: DomFinding[], hints?: PageHints): void {
    if (!tabId) return;
    if (!this.booted) {
      this.domQueue.push({ tabId, items, hints });
      return;
    }
    this.applyDom(tabId, items, hints);
  }

  async onCommitted(tabId: number, frameId: number, url: string, transitionType: string): Promise<void> {
    await this.ready();
    if (frameId === 0) {
      const meta = this.metaForTab(tabId);
      if (meta && meta.status === 'running' && !isRestrictedUrl(url)) {
        const reload = transitionType === 'reload';
        if (meta.scope === 'document' && (reload || url !== meta.url)) await this.rotate(tabId, url, meta);
        else if (url !== meta.url) this.retarget(meta, url);
      }
    }
    const meta = this.metaForTab(tabId);
    if (meta?.status === 'running') await this.injectFrame(tabId, frameId);
  }

  onHistory(tabId: number, url: string): void {
    const meta = this.metaForTab(tabId);
    if (!meta || meta.status !== 'running' || isRestrictedUrl(url)) return;
    this.retarget(meta, url);
    this.scheduleFlush(meta.id);
  }

  private async boot(): Promise<void> {
    try {
      this.settings = await loadSettings();
      const active = await readActiveSessions();
      for (const stored of active) {
        const meta = { ...stored, stats: { ...emptyStats(), ...stored.stats }, pageHints: stored.pageHints ?? emptyPageHints() };
        let tabExists = false;
        try {
          await chrome.tabs.get(meta.tabId);
          tabExists = true;
        } catch {
          tabExists = false;
        }
        if (!tabExists) {
          meta.status = 'paused';
          meta.archived = true;
          this.metas.set(meta.id, meta);
          await putSession(meta);
          continue;
        }
        const state = await this.hydrate(meta);
        this.states.set(meta.id, state);
        this.metas.set(meta.id, meta);
        if (meta.status === 'running' && !meta.archived) {
          this.byTab.set(meta.tabId, meta.id);
          void this.injectAll(meta.tabId);
        }
      }
    } catch (error) {
      console.error('Не удалось восстановить сессии', error);
    } finally {
      this.booted = true;
      const queued = this.queue.splice(0);
      for (const observation of queued) this.applyNetwork(observation);
      const domQueued = this.domQueue.splice(0);
      for (const batch of domQueued) this.applyDom(batch.tabId, batch.items, batch.hints);
    }
  }

  private async ready(): Promise<void> {
    await this.bootPromise;
  }

  private async hydrate(meta: SessionMeta): Promise<SessionState> {
    const state = createSessionState(meta.id, meta.tabId, {
      maxResources: this.settings?.maxResources ?? DEFAULT_LIMITS.maxResources,
      maxRequests: this.settings?.maxRequests ?? DEFAULT_LIMITS.maxRequests,
      warnRatio: DEFAULT_LIMITS.warnRatio,
    });
    state.pageUrl = meta.url;
    state.pageHints = meta.pageHints ?? emptyPageHints();
    state.stats.requests = meta.stats?.requests ?? 0;
    state.stats.errors = meta.stats?.errors ?? 0;
    const resources = await getAllBySession<ResourceRecord>('resources', meta.id);
    const requests = await getAllBySession<RequestRecord>('requests', meta.id);
    for (const record of resources) {
      state.resources.set(record.id, record);
      state.rev = Math.max(state.rev, record.rev);
    }
    const ordered = requests.sort((left, right) => left.timestamp - right.timestamp);
    for (const record of ordered) {
      state.requests.set(record.id, record);
      state.requestOrder.push(record.id);
      state.rev = Math.max(state.rev, record.rev);
    }
    state.rebuildAggregates();
    meta.stats = { ...state.stats };
    return state;
  }

  private applyDom(tabId: number, items: DomFinding[], hints?: PageHints): void {
    const meta = this.metaForTab(tabId);
    if (!meta || meta.status !== 'running') return;
    const state = this.states.get(meta.id);
    if (!state) return;
    if (hints) {
      state.applyPageHints(hints);
      meta.pageHints = state.pageHints;
    }
    const time = Date.now();
    for (const item of items.slice(0, 500)) {
      if (!item || typeof item.url !== 'string') continue;
      state.observeDiscovery({
        ...item,
        url: item.url.slice(0, 8000),
        time,
        tabId,
        pageUrl: meta.url,
      });
    }
    this.touch(meta, state);
    this.scheduleFlush(meta.id);
  }

  private applyNetwork(observation: NetworkObservation): void {
    const sessionId = this.byTab.get(observation.tabId);
    if (!sessionId) return;
    const meta = this.metas.get(sessionId);
    const state = this.states.get(sessionId);
    if (!meta || !state || meta.status !== 'running' || meta.archived) return;
    state.observeNetwork(observation);
    this.touch(meta, state);
    this.scheduleFlush(sessionId);
  }

  private async rotate(tabId: number, url: string, previous: SessionMeta): Promise<void> {
    previous.status = 'paused';
    previous.archived = true;
    previous.updatedAt = Date.now();
    await putSession(previous);
    const settings = await this.ensureSettings();
    const tab = await this.readTab(tabId);
    const meta = this.createMeta(tabId, url, tab?.title ?? previous.title, settings);
    const state = createSessionState(meta.id, tabId, {
      maxResources: settings.maxResources,
      maxRequests: settings.maxRequests,
      warnRatio: DEFAULT_LIMITS.warnRatio,
    });
    state.pageUrl = url;
    this.states.set(meta.id, state);
    this.metas.set(meta.id, meta);
    this.byTab.set(tabId, meta.id);
    await putSession(meta);
    await this.persistActive();
    this.broadcast({ type: 'SESSION', session: meta });
  }

  private retarget(meta: SessionMeta, url: string): void {
    meta.url = url;
    meta.domain = domainFromUrl(url);
    meta.updatedAt = Date.now();
    const state = this.states.get(meta.id);
    if (state) state.pageUrl = url;
    this.broadcast({ type: 'SESSION', session: meta });
  }

  private createMeta(tabId: number, url: string, title: string, settings: Settings): SessionMeta {
    const now = Date.now();
    return {
      id: createId('ses'),
      tabId,
      url,
      title,
      domain: domainFromUrl(url),
      status: 'running',
      scope: settings.scope,
      startedAt: now,
      updatedAt: now,
      navigationId: createId('nav'),
      pageHints: emptyPageHints(),
      stats: emptyStats(),
      limited: false,
      archived: false,
      pruneGeneration: 0,
    };
  }

  private touch(meta: SessionMeta, state: SessionState): void {
    meta.stats = { ...state.stats };
    meta.warning = state.warning;
    meta.limited = state.limited;
    meta.updatedAt = Date.now();
  }

  private scheduleFlush(sessionId: string): void {
    this.pendingFlush.add(sessionId);
    this.flushTail = this.flushTail
      .then(() => this.flushPending())
      .catch((error: unknown) => {
        console.error('Ошибка сохранения сессии', error);
      });
  }

  private async flushPending(): Promise<void> {
    const ids = [...this.pendingFlush];
    this.pendingFlush.clear();
    for (const id of ids) await this.flushOne(id);
    if (this.pendingFlush.size > 0) await this.flushPending();
  }

  private async flushOne(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    const meta = this.metas.get(sessionId);
    if (!state || !meta) return;
    const batch = state.drainDirty();
    meta.stats = { ...state.stats };
    meta.warning = state.warning;
    meta.limited = state.limited;
    meta.updatedAt = Date.now();
    if (batch.removedRequestIds.length > 0) meta.pruneGeneration += 1;
    try {
      await putRecords('resources', batch.resources);
      await putRecords('requests', batch.requests);
      await deleteIds('requests', batch.removedRequestIds);
      await putSession(meta);
      await this.persistActive();
      this.broadcast({ type: 'DIRTY', sessionId, pruneGeneration: meta.pruneGeneration });
    } catch (error) {
      state.requeue(batch);
      const message = 'Хранилище недоступно или переполнено. Новые данные могут не сохраниться.';
      state.warning = message;
      meta.warning = message;
      console.error(message, error);
      this.broadcast({ type: 'SESSION', session: meta });
    }
  }

  private async injectAll(tabId: number): Promise<void> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      for (const frame of frames ?? []) await this.injectFrame(tabId, frame.frameId);
    } catch (error) {
      const meta = this.metaForTab(tabId);
      if (meta) meta.warning = 'Скрипт страницы не внедрён. Сетевые запросы, если они доступны, продолжают собираться.';
      console.error(error);
    }
  }

  private async injectFrame(tabId: number, frameId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content.js'],
      });
    } catch {
      // Закрытый или недоступный фрейм не прерывает мониторинг остальных.
    }
  }

  private async signalFrames(tabId: number, message: { type: 'START_SCAN' | 'STOP_SCAN' }): Promise<void> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      for (const frame of frames ?? []) {
        try {
          await chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId });
        } catch {
          // Кадр без скрипта будет внедрён при следующем старте.
        }
      }
    } catch {
      // Вкладка могла закрыться.
    }
  }

  private metaForTab(tabId: number): SessionMeta | undefined {
    const id = this.byTab.get(tabId);
    return id ? this.metas.get(id) : undefined;
  }

  private async persistMeta(meta: SessionMeta): Promise<void> {
    await putSession(meta);
    await this.persistActive();
  }

  private async persistActive(): Promise<void> {
    const active = [...this.byTab.values()]
      .map((id) => this.metas.get(id))
      .filter((meta): meta is SessionMeta => Boolean(meta && !meta.archived));
    const payload = { activeSessions: active };
    try {
      await chrome.storage.session.set(payload);
    } catch {
      await chrome.storage.local.set(payload);
    }
  }

  private async ensureSettings(): Promise<Settings> {
    if (!this.settings) this.settings = await loadSettings();
    return this.settings;
  }

  private async readTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  private broadcast(event: DashboardEvent): void {
    for (const port of this.ports) {
      try {
        port.postMessage(event);
      } catch {
        this.ports.delete(port);
      }
    }
  }
}

async function readActiveSessions(): Promise<SessionMeta[]> {
  try {
    const stored = await chrome.storage.session.get('activeSessions');
    if (Array.isArray(stored.activeSessions)) return stored.activeSessions as SessionMeta[];
  } catch {
    // chrome.storage.session может отсутствовать.
  }
  const stored = await chrome.storage.local.get('activeSessions');
  return Array.isArray(stored.activeSessions) ? (stored.activeSessions as SessionMeta[]) : [];
}
