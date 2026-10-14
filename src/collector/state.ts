import { classify } from '../classifier/classify';
import { DEFAULT_LIMITS } from '../shared/constants';
import { STATE_LABELS } from '../shared/labels';
import { requestRecordId, resourceId } from '../shared/id';
import { CATEGORY_ORDER } from '../shared/types';
import type {
  Category,
  DiscoveryObservation,
  DiscoverySource,
  DomainAggregate,
  Limits,
  NetworkObservation,
  PageHints,
  RequestRecord,
  RequestState,
  ResourceRecord,
  Stats,
} from '../shared/types';
import { emptyPageHints, emptyStats } from '../shared/types';
import { inspectUrl, publicInitiator } from '../shared/url';

export interface DirtyBatch {
  resources: ResourceRecord[];
  requests: RequestRecord[];
  removedRequestIds: string[];
}

interface UpsertInput {
  time: number;
  source: DiscoverySource;
  countHit: boolean;
  networkHit: boolean;
  state: RequestState;
  classificationUrl: string;
  mimeType?: string;
  requestType?: string;
  method?: string;
  initiator?: string;
  element?: string;
  rel?: string;
  as?: string;
  initiatorType?: string;
  linkText?: string;
  frameUrl?: string;
  pageUrl?: string;
  error?: string;
  statusCode?: number;
  redirectFrom?: string;
  transferSize?: number;
  decodedBodySize?: number;
}

export class SessionState {
  readonly resources = new Map<string, ResourceRecord>();
  readonly requests = new Map<string, RequestRecord>();
  readonly domains = new Map<string, DomainAggregate>();
  readonly requestOrder: string[] = [];
  pageHints: PageHints = emptyPageHints();
  pageUrl = '';
  stats: Stats = emptyStats();
  warning?: string;
  limited = false;
  rev = 0;
  private readonly dirtyResources = new Map<string, ResourceRecord>();
  private readonly dirtyRequests = new Map<string, RequestRecord>();
  private readonly removedRequestIds: string[] = [];
  private readonly prunedRequestIds = new Set<string>();
  private warnedNear = false;

  constructor(
    readonly sessionId: string,
    readonly tabId: number,
    readonly limits: Limits = { ...DEFAULT_LIMITS },
  ) {}

  observeNetwork(observation: NetworkObservation): void {
    if (observation.tabId !== this.tabId) return;
    if (observation.phase === 'start') this.onStart(observation);
    else if (observation.phase === 'redirect') this.onRedirect(observation);
    else if (observation.phase === 'complete') this.onComplete(observation);
    else this.onError(observation);
  }

  observeDiscovery(observation: DiscoveryObservation): void {
    if (observation.tabId !== this.tabId) return;
    const parsed = inspectUrl(observation.url);
    if (!parsed) return;
    this.upsert(parsed, {
      time: observation.time,
      source: observation.source,
      countHit: true,
      networkHit: false,
      state: 'complete',
      classificationUrl: parsed.url,
      element: observation.element,
      rel: observation.rel,
      as: observation.as,
      initiatorType: observation.initiatorType,
      linkText: observation.linkText,
      frameUrl: observation.frameUrl,
      pageUrl: observation.pageUrl ?? this.pageUrl,
      transferSize: observation.transferSize,
      decodedBodySize: observation.decodedBodySize,
    });
  }

  applyPageHints(hints: PageHints): void {
    const previous = new Set(this.pageHints.markers);
    this.pageHints = {
      markers: [...new Set(hints.markers)],
      hasCanvas: hints.hasCanvas,
    };
    const added = this.pageHints.markers.some((marker) => !previous.has(marker));
    if (!added) return;
    for (const record of this.resources.values()) {
      if (record.gameCandidate) continue;
      const again = classify({
        url: record.url,
        extension: record.extension,
        mimeType: record.mimeType,
        requestType: record.requestType,
        element: record.elementHint,
        pageHints: this.pageHints,
      });
      if (!again.gameCandidate) continue;
      const before = record.categories.slice();
      record.gameCandidate = true;
      record.categories = unionCategories(record.categories, again.categories);
      record.rev = this.nextRev();
      record.lastSeen = Math.max(record.lastSeen, Date.now());
      record.searchText = resourceSearch(record);
      this.dirtyResources.set(record.id, record);
      this.addCategoryStats(gained(before, record.categories), 1);
      if (!before.includes('game')) this.stats.gameCandidates += 1;
      const domain = this.domains.get(record.domain);
      if (domain) unionDomainCategories(domain, record.categories);
    }
  }

  clear(): void {
    this.resources.clear();
    this.requests.clear();
    this.requestOrder.length = 0;
    this.domains.clear();
    this.stats = emptyStats();
    this.warning = undefined;
    this.limited = false;
    this.warnedNear = false;
    this.dirtyResources.clear();
    this.dirtyRequests.clear();
    this.removedRequestIds.length = 0;
    this.prunedRequestIds.clear();
  }

  requeue(batch: DirtyBatch): void {
    for (const record of batch.resources) {
      const current = this.resources.get(record.id);
      if (current) this.dirtyResources.set(current.id, current);
    }
    for (const record of batch.requests) {
      const current = this.requests.get(record.id);
      if (current) this.dirtyRequests.set(current.id, current);
    }
    for (const id of batch.removedRequestIds) {
      if (!this.removedRequestIds.includes(id)) this.removedRequestIds.push(id);
    }
  }

  drainDirty(): DirtyBatch {
    const batch = {
      resources: [...this.dirtyResources.values()],
      requests: [...this.dirtyRequests.values()],
      removedRequestIds: this.removedRequestIds.splice(0),
    };
    this.dirtyResources.clear();
    this.dirtyRequests.clear();
    return batch;
  }

  rebuildAggregates(): void {
    const requests = this.stats.requests;
    const errors = this.stats.errors;
    this.domains.clear();
    this.stats = emptyStats();
    this.stats.requests = requests;
    this.stats.errors = errors;
    for (const record of this.resources.values()) {
      const domain = this.ensureDomain(record.domain, record.firstSeen);
      domain.uniqueUrls += 1;
      domain.requests += record.networkHits;
      domain.lastSeen = Math.max(domain.lastSeen, record.lastSeen);
      unionDomainCategories(domain, record.categories);
      this.addCategoryStats(record.categories, 1);
      if (record.gameCandidate) this.stats.gameCandidates += 1;
    }
    this.stats.uniqueUrls = this.resources.size;
    this.stats.domains = this.domains.size;
  }

  private onStart(observation: Extract<NetworkObservation, { phase: 'start' }>): void {
    const parsed = inspectUrl(observation.url);
    if (!parsed) return;
    const id = requestRecordId(this.sessionId, observation.requestId);
    if (this.requests.has(id)) return;
    const request = this.makeRequest(observation, parsed.url, parsed.domain, id);
    this.addRequest(request);
    this.stats.requests += 1;
    this.upsert(parsed, {
      time: observation.time,
      source: 'webRequest',
      countHit: true,
      networkHit: true,
      state: 'pending',
      classificationUrl: parsed.url,
      requestType: observation.type,
      method: observation.method,
      initiator: observation.initiator,
      pageUrl: this.pageUrl,
    });
  }

  private onRedirect(observation: Extract<NetworkObservation, { phase: 'redirect' }>): void {
    const current = inspectUrl(observation.url);
    const target = inspectUrl(observation.redirectUrl);
    const id = requestRecordId(this.sessionId, observation.requestId);
    if (!this.requests.has(id) && current) {
      this.onStart({
        phase: 'start',
        requestId: observation.requestId,
        url: observation.url,
        method: 'GET',
        type: observation.type,
        tabId: observation.tabId,
        time: observation.time,
        initiator: observation.initiator,
      });
    }
    const request = this.requests.get(id);
    if (!request) {
      if (this.prunedRequestIds.has(id) && target) {
        this.upsert(target, {
          time: observation.time,
          source: 'webRequest',
          countHit: false,
          networkHit: false,
          state: 'redirect',
          classificationUrl: target.url,
          requestType: observation.type,
          initiator: observation.initiator,
          statusCode: observation.statusCode,
          pageUrl: this.pageUrl,
        });
      }
      return;
    }
    if (target && !request.redirects.includes(target.url)) request.redirects.push(target.url);
    request.state = 'redirect';
    if (observation.statusCode) request.statusCode = observation.statusCode;
    request.updatedAt = observation.time;
    request.rev = this.nextRev();
    request.searchText = requestSearch(request);
    this.dirtyRequests.set(request.id, request);
    if (!target) return;
    this.upsert(target, {
      time: observation.time,
      source: 'webRequest',
      countHit: true,
      networkHit: false,
      state: 'redirect',
      classificationUrl: target.url,
      requestType: observation.type,
      initiator: observation.initiator,
      statusCode: observation.statusCode,
      redirectFrom: request.url,
      pageUrl: this.pageUrl,
    });
  }

  private onComplete(observation: Extract<NetworkObservation, { phase: 'complete' }>): void {
    const parsed = inspectUrl(observation.url);
    if (!parsed) return;
    const id = requestRecordId(this.sessionId, observation.requestId);
    let request = this.requests.get(id);
    if (!request && !this.prunedRequestIds.has(id)) {
      this.onStart({
        phase: 'start',
        requestId: observation.requestId,
        url: observation.url,
        method: 'GET',
        type: observation.type,
        tabId: observation.tabId,
        time: observation.time,
        initiator: observation.initiator,
      });
      request = this.requests.get(id);
    }
    if (request) {
    request.finalUrl = parsed.url;
    request.state = 'complete';
    request.statusCode = observation.statusCode;
    request.mimeType = cleanMime(observation.mimeType);
    request.fromCache = observation.fromCache;
    request.updatedAt = observation.time;
    request.rev = this.nextRev();
    request.searchText = requestSearch(request);
    this.dirtyRequests.set(request.id, request);
    }
    this.upsert(parsed, {
      time: observation.time,
      source: 'webRequest',
      countHit: false,
      networkHit: false,
      state: 'complete',
      classificationUrl: parsed.url,
      mimeType: cleanMime(observation.mimeType),
      requestType: observation.type,
      initiator: observation.initiator,
      statusCode: observation.statusCode,
      pageUrl: this.pageUrl,
    });
  }

  private onError(observation: Extract<NetworkObservation, { phase: 'error' }>): void {
    const parsed = inspectUrl(observation.url);
    if (!parsed) return;
    const id = requestRecordId(this.sessionId, observation.requestId);
    let request = this.requests.get(id);
    if (!request && !this.prunedRequestIds.has(id)) {
      this.onStart({
        phase: 'start',
        requestId: observation.requestId,
        url: observation.url,
        method: 'GET',
        type: observation.type,
        tabId: observation.tabId,
        time: observation.time,
        initiator: observation.initiator,
      });
      request = this.requests.get(id);
    }
    if (request && request.state !== 'error') this.stats.errors += 1;
    else if (!request) this.stats.errors += 1;
    if (request) {
    request.state = 'error';
    request.error = observation.error.slice(0, 300);
    request.updatedAt = observation.time;
    request.rev = this.nextRev();
    request.searchText = requestSearch(request);
    this.dirtyRequests.set(request.id, request);
    }
    this.upsert(parsed, {
      time: observation.time,
      source: 'webRequest',
      countHit: false,
      networkHit: false,
      state: 'error',
      classificationUrl: parsed.url,
      requestType: observation.type,
      initiator: observation.initiator,
      error: observation.error.slice(0, 300),
      pageUrl: this.pageUrl,
    });
  }

  private makeRequest(
    observation: Extract<NetworkObservation, { phase: 'start' }>,
    url: string,
    domain: string,
    id: string,
  ): RequestRecord {
    const request: RequestRecord = {
      id,
      sessionId: this.sessionId,
      tabId: this.tabId,
      requestId: observation.requestId,
      url,
      finalUrl: url,
      domain,
      method: observation.method || 'GET',
      type: observation.type || 'other',
      timestamp: observation.time,
      updatedAt: observation.time,
      rev: this.nextRev(),
      state: 'pending',
      initiator: publicInitiator(observation.initiator),
      redirects: [],
      searchText: '',
    };
    request.searchText = requestSearch(request);
    return request;
  }

  private addRequest(request: RequestRecord): void {
    this.requests.set(request.id, request);
    this.requestOrder.push(request.id);
    this.dirtyRequests.set(request.id, request);
    while (this.requestOrder.length > this.limits.maxRequests) {
      const removed = this.requestOrder.shift();
      if (!removed) break;
      this.requests.delete(removed);
      this.dirtyRequests.delete(removed);
      this.removedRequestIds.push(removed);
      this.prunedRequestIds.add(removed);
    }
  }

  private upsert(parsed: NonNullable<ReturnType<typeof inspectUrl>>, input: UpsertInput): void {
    const id = resourceId(this.sessionId, parsed.normalizedUrl);
    const existing = this.resources.get(id);
    if (!existing && this.resources.size >= this.limits.maxResources) {
      this.limited = true;
      this.warning = 'Достигнут лимит уникальных URL. Новые адреса не сохраняются, уже найденные продолжают обновляться.';
      return;
    }
    const classification = classify({
      url: input.classificationUrl,
      extension: parsed.extension,
      mimeType: input.mimeType,
      requestType: input.requestType,
      element: input.element,
      rel: input.rel,
      as: input.as,
      initiatorType: input.initiatorType,
      pageHints: this.pageHints,
    });
    if (!existing) {
      const record = this.createRecord(id, parsed, input, classification);
      this.resources.set(id, record);
      this.noteNew(record);
      this.dirtyResources.set(id, record);
      this.noteCapacity();
      return;
    }
    const beforeCategories = existing.categories.slice();
    const beforeGame = existing.gameCandidate;
    existing.lastSeen = input.time;
    existing.rev = this.nextRev();
    if (input.countHit) existing.hitCount += 1;
    if (input.networkHit) existing.networkHits += 1;
    existing.sources = unionSources(existing.sources, input.source);
    existing.categories = unionCategories(existing.categories, classification.categories);
    if (!classification.uncertain) existing.uncertain = false;
    if (classification.radioCandidate) existing.radioCandidate = true;
    if (classification.gameCandidate) existing.gameCandidate = true;
    if (classification.playlist) existing.playlist = true;
    if (input.mimeType) existing.mimeType = cleanMime(input.mimeType);
    if (input.statusCode) existing.statusCode = input.statusCode;
    if (input.method && !existing.method) existing.method = input.method;
    if (input.requestType && !existing.requestType) existing.requestType = input.requestType;
    if (input.initiator) existing.initiator = publicInitiator(input.initiator);
    if (input.linkText && !existing.linkText) existing.linkText = input.linkText.slice(0, 300);
    if (input.element && !existing.elementHint) existing.elementHint = input.element;
    if (input.frameUrl && !existing.frameUrl) existing.frameUrl = input.frameUrl;
    if (input.pageUrl && !existing.pageUrl) existing.pageUrl = input.pageUrl;
    if (input.error) existing.error = input.error;
    if (input.transferSize !== undefined) existing.transferSize = input.transferSize;
    if (input.decodedBodySize !== undefined) existing.decodedBodySize = input.decodedBodySize;
    if (input.redirectFrom) existing.redirectFrom = unionText(existing.redirectFrom, input.redirectFrom);
    existing.state = mergeState(existing.state, input.state);
    existing.searchText = resourceSearch(existing);
    if (input.networkHit) {
      const domain = this.ensureDomain(existing.domain, input.time);
      domain.requests += 1;
      domain.lastSeen = Math.max(domain.lastSeen, input.time);
    }
    this.addCategoryStats(gained(beforeCategories, existing.categories), 1);
    if (!beforeGame && existing.gameCandidate) this.stats.gameCandidates += 1;
    const domain = this.domains.get(existing.domain);
    if (domain) {
      unionDomainCategories(domain, existing.categories);
      domain.lastSeen = Math.max(domain.lastSeen, existing.lastSeen);
    }
    this.dirtyResources.set(existing.id, existing);
  }

  private createRecord(
    id: string,
    parsed: NonNullable<ReturnType<typeof inspectUrl>>,
    input: UpsertInput,
    classification: ReturnType<typeof classify>,
  ): ResourceRecord {
    const record: ResourceRecord = {
      id,
      sessionId: this.sessionId,
      tabId: this.tabId,
      url: parsed.url,
      normalizedUrl: parsed.normalizedUrl,
      domain: parsed.domain,
      origin: parsed.origin,
      filename: parsed.filename,
      extension: parsed.extension,
      categories: classification.categories,
      uncertain: classification.uncertain,
      radioCandidate: classification.radioCandidate,
      gameCandidate: classification.gameCandidate,
      playlist: classification.playlist,
      sources: [input.source],
      firstSeen: input.time,
      lastSeen: input.time,
      rev: this.nextRev(),
      hitCount: 1,
      networkHits: input.networkHit ? 1 : 0,
      requestType: input.requestType,
      mimeType: cleanMime(input.mimeType),
      statusCode: input.statusCode,
      method: input.method,
      initiator: publicInitiator(input.initiator),
      state: input.state,
      linkText: input.linkText?.slice(0, 300),
      elementHint: input.element,
      frameUrl: input.frameUrl,
      pageUrl: input.pageUrl ?? this.pageUrl,
      error: input.error,
      isBlob: parsed.isBlob,
      blobOrigin: parsed.blobOrigin,
      redirectFrom: input.redirectFrom ? [input.redirectFrom] : undefined,
      transferSize: input.transferSize,
      decodedBodySize: input.decodedBodySize,
      searchText: '',
    };
    record.searchText = resourceSearch(record);
    return record;
  }

  private noteNew(record: ResourceRecord): void {
    this.stats.uniqueUrls += 1;
    const domain = this.ensureDomain(record.domain, record.firstSeen);
    domain.uniqueUrls += 1;
    domain.requests += record.networkHits;
    domain.lastSeen = Math.max(domain.lastSeen, record.lastSeen);
    unionDomainCategories(domain, record.categories);
    this.addCategoryStats(record.categories, 1);
    if (record.gameCandidate) this.stats.gameCandidates += 1;
  }

  private ensureDomain(domain: string, time: number): DomainAggregate {
    const existing = this.domains.get(domain);
    if (existing) {
      if (time < existing.firstSeen) existing.firstSeen = time;
      if (time > existing.lastSeen) existing.lastSeen = time;
      return existing;
    }
    const created: DomainAggregate = {
      domain,
      requests: 0,
      uniqueUrls: 0,
      categories: [],
      firstSeen: time,
      lastSeen: time,
    };
    this.domains.set(domain, created);
    this.stats.domains += 1;
    return created;
  }

  private addCategoryStats(categories: Category[], delta: number): void {
    if (delta === 0 || categories.length === 0) return;
    if (categories.includes('video')) this.stats.video += delta;
    if (categories.includes('audio')) this.stats.audio += delta;
    if (categories.includes('link')) this.stats.domLinks += delta;
  }

  private noteCapacity(): void {
    if (this.limited) return;
    if (!this.warnedNear && this.resources.size >= this.limits.maxResources * this.limits.warnRatio) {
      this.warnedNear = true;
      this.warning = 'Хранилище сессии заполнено больше чем на 80%.';
    }
  }

  private nextRev(): number {
    this.rev += 1;
    return this.rev;
  }
}

export function createSessionState(sessionId: string, tabId: number, limits?: Partial<Limits>): SessionState {
  return new SessionState(sessionId, tabId, { ...DEFAULT_LIMITS, ...limits });
}

function unionCategories(current: Category[], incoming: Category[]): Category[] {
  const set = new Set<Category>(current);
  for (const category of incoming) set.add(category);
  if (set.size > 1) set.delete('other');
  return CATEGORY_ORDER.filter((category) => set.has(category));
}

function unionSources(current: DiscoverySource[], source: DiscoverySource): DiscoverySource[] {
  if (current.includes(source)) return current;
  return [...current, source];
}

function unionText(current: string[] | undefined, value: string): string[] {
  const next = current ? [...current] : [];
  if (!next.includes(value) && next.length < 20) next.push(value);
  return next;
}

function unionDomainCategories(domain: DomainAggregate, categories: Category[]): void {
  const set = new Set<Category>(domain.categories);
  for (const category of categories) {
    if (category !== 'other') set.add(category);
  }
  domain.categories = CATEGORY_ORDER.filter((category) => set.has(category));
}

function gained(before: Category[], after: Category[]): Category[] {
  return after.filter((category) => !before.includes(category));
}

function mergeState(current: RequestState, incoming: RequestState): RequestState {
  if (incoming === 'error' || current === 'error') return 'error';
  if (incoming === 'complete') return 'complete';
  if (incoming === 'redirect' && current === 'pending') return 'redirect';
  return current;
}

function cleanMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined;
  const value = mime.split(';')[0]?.trim().toLowerCase();
  if (!value || value.length > 120) return undefined;
  return value;
}

export function resourceSearch(record: ResourceRecord): string {
  return [
    record.url,
    record.domain,
    record.filename,
    record.extension,
    record.mimeType,
    record.categories.join(' '),
    record.linkText,
    record.state,
    STATE_LABELS[record.state],
    record.statusCode,
    record.sources.join(' '),
    record.method,
    record.requestType,
    record.initiator,
    record.elementHint,
    record.error,
    record.radioCandidate ? 'radio радио' : '',
    record.gameCandidate ? 'game игра' : '',
    record.playlist ? 'playlist hls dash m3u8 mpd' : '',
    record.uncertain ? 'возможное совпадение' : '',
    record.isBlob ? 'blob' : '',
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' ')
    .toLowerCase();
}

export function requestSearch(record: RequestRecord): string {
  return [
    record.url,
    record.finalUrl,
    record.domain,
    record.method,
    record.type,
    record.statusCode,
    record.mimeType,
    record.state,
    STATE_LABELS[record.state],
    record.initiator,
    record.error,
    record.redirects.join(' '),
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' ')
    .toLowerCase();
}
