import { filterDomains, filterRequests, filterResources, isLinkRecord, isMediaRecord } from '../filters/query';
import type { FilterState } from '../filters/query';
import { CATEGORY_ORDER } from '../shared/types';
import type { Category, DomainAggregate, RequestRecord, ResourceRecord, SessionMeta, ViewId } from '../shared/types';
import { getAllBySession, getSession, getSince } from '../storage/db';

export type DisplayRow =
  | { kind: 'domain'; id: string; domain: DomainAggregate }
  | { kind: 'resource'; id: string; resource: ResourceRecord }
  | { kind: 'request'; id: string; request: RequestRecord };

export class LiveModel {
  revision = 0;
  session: SessionMeta | null = null;
  error = '';
  private sessionId = '';
  private readonly resources = new Map<string, ResourceRecord>();
  private readonly requests = new Map<string, RequestRecord>();
  private requestList: RequestRecord[] = [];
  private readonly domains = new Map<string, DomainAggregate>();
  private lastResourceRev = 0;
  private lastRequestRev = 0;
  private pruneGeneration = 0;
  private cacheKey = '';
  private cache: DisplayRow[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = (): number => this.revision;

  async open(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.resources.clear();
    this.requests.clear();
    this.requestList = [];
    this.domains.clear();
    this.lastResourceRev = 0;
    this.lastRequestRev = 0;
    this.cacheKey = '';
    try {
      const [session, resources, requests] = await Promise.all([
        getSession<SessionMeta>(sessionId),
        getAllBySession<ResourceRecord>('resources', sessionId),
        getAllBySession<RequestRecord>('requests', sessionId),
      ]);
      this.session = session ?? null;
      this.pruneGeneration = session?.pruneGeneration ?? 0;
      for (const record of resources) this.mergeResource(record);
      for (const record of requests) this.mergeRequest(record);
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось прочитать локальную базу';
    }
    this.emit();
  }

  async follow(session: SessionMeta): Promise<void> {
    if (session.id === this.sessionId) {
      this.session = session;
      this.emit();
      return;
    }
    await this.open(session.id);
  }

  async poll(pruneGeneration?: number): Promise<void> {
    if (!this.sessionId) return;
    try {
      const session = await getSession<SessionMeta>(this.sessionId);
      const previousUpdated = this.session?.updatedAt;
      if (session) this.session = session;
      const generation = pruneGeneration ?? session?.pruneGeneration ?? this.pruneGeneration;
      let changed = Boolean(session && session.updatedAt !== previousUpdated);
      if (generation !== this.pruneGeneration) {
        this.pruneGeneration = generation;
        const requests = await getAllBySession<RequestRecord>('requests', this.sessionId);
        this.requests.clear();
        this.requestList = [];
        this.lastRequestRev = 0;
        for (const record of requests) this.mergeRequest(record);
        changed = true;
      }
      const resources = await getSince<ResourceRecord>('resources', this.sessionId, this.lastResourceRev);
      const freshRequests = await getSince<RequestRecord>('requests', this.sessionId, this.lastRequestRev);
      if (resources.length > 0 || freshRequests.length > 0) changed = true;
      for (const record of resources) this.mergeResource(record);
      for (const record of freshRequests) this.mergeRequest(record);
      if (changed) this.emit();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка обновления';
      this.emit();
    }
  }

  reset(session: SessionMeta | undefined): void {
    this.resources.clear();
    this.requests.clear();
    this.requestList = [];
    this.domains.clear();
    this.lastResourceRev = 0;
    this.lastRequestRev = 0;
    this.cacheKey = '';
    if (session) {
      this.session = session;
      this.sessionId = session.id;
      this.pruneGeneration = session.pruneGeneration;
    }
    this.emit();
  }

  query(view: ViewId, filter: FilterState): DisplayRow[] {
    const key = `${this.revision}|${view}|${JSON.stringify(filter)}`;
    if (key === this.cacheKey) return this.cache;
    let rows: DisplayRow[] = [];
    if (view === 'domains') {
      rows = filterDomains([...this.domains.values()], filter).map((domain) => ({
        kind: 'domain',
        id: `domain:${domain.domain}`,
        domain,
      }));
    } else if (view === 'requests') {
      rows = filterRequests(this.requestList, filter).map((request) => ({ kind: 'request', id: request.id, request }));
    } else {
      let records = [...this.resources.values()];
      if (view === 'links') records = records.filter(isLinkRecord);
      if (view === 'media') records = records.filter(isMediaRecord);
      rows = filterResources(records, filter).map((resource) => ({ kind: 'resource', id: resource.id, resource }));
    }
    this.cacheKey = key;
    this.cache = rows;
    return rows;
  }

  allResources(): ResourceRecord[] {
    return [...this.resources.values()];
  }

  allRequests(): RequestRecord[] {
    return this.requestList;
  }

  allDomains(): DomainAggregate[] {
    return [...this.domains.values()];
  }

  private mergeResource(record: ResourceRecord): void {
    const previous = this.resources.get(record.id);
    if (previous && record.rev <= previous.rev) return;
    this.resources.set(record.id, record);
    this.lastResourceRev = Math.max(this.lastResourceRev, record.rev);
    const domain = this.ensureDomain(record.domain, record.firstSeen);
    if (!previous) {
      domain.uniqueUrls += 1;
      domain.requests += record.networkHits;
    } else {
      domain.requests += Math.max(0, record.networkHits - previous.networkHits);
    }
    domain.lastSeen = Math.max(domain.lastSeen, record.lastSeen);
    domain.categories = unionCategories(domain.categories, record.categories);
  }

  private mergeRequest(record: RequestRecord): void {
    const previous = this.requests.get(record.id);
    if (previous && record.rev <= previous.rev) return;
    this.requests.set(record.id, record);
    this.lastRequestRev = Math.max(this.lastRequestRev, record.rev);
    if (!previous) this.requestList.push(record);
    else {
      const index = this.requestList.findIndex((item) => item.id === record.id);
      if (index >= 0) this.requestList[index] = record;
      else this.requestList.push(record);
    }
  }

  private ensureDomain(name: string, time: number): DomainAggregate {
    const existing = this.domains.get(name);
    if (existing) {
      existing.firstSeen = Math.min(existing.firstSeen, time);
      return existing;
    }
    const created: DomainAggregate = {
      domain: name,
      requests: 0,
      uniqueUrls: 0,
      categories: [],
      firstSeen: time,
      lastSeen: time,
    };
    this.domains.set(name, created);
    return created;
  }

  private emit(): void {
    this.revision += 1;
    this.cacheKey = '';
    for (const listener of this.listeners) listener();
  }
}

function unionCategories(current: Category[], incoming: Category[]): Category[] {
  const set = new Set<Category>(current);
  for (const category of incoming) {
    if (category !== 'other') set.add(category);
  }
  return CATEGORY_ORDER.filter((category) => set.has(category));
}
