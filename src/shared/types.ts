export type Category =
  | 'video'
  | 'audio'
  | 'radio'
  | 'image'
  | 'game'
  | 'script'
  | 'style'
  | 'font'
  | 'document'
  | 'archive'
  | 'api'
  | 'websocket'
  | 'link'
  | 'other';

export type DiscoverySource = 'webRequest' | 'dom' | 'resourceTiming';

export type RequestState = 'pending' | 'complete' | 'error' | 'redirect';

export type MonitorStatus = 'running' | 'paused';

export type SessionScope = 'document' | 'tab';

export type SortKey = 'time' | 'domain' | 'category' | 'count';

export type SortDirection = 'asc' | 'desc';

export type ViewId = 'domains' | 'resources' | 'links' | 'media' | 'requests';

export interface PageHints {
  markers: string[];
  hasCanvas: boolean;
}

export interface ParsedUrl {
  url: string;
  normalizedUrl: string;
  domain: string;
  origin: string;
  filename: string;
  extension?: string;
  isBlob: boolean;
  blobOrigin?: string;
}

export interface Classification {
  categories: Category[];
  uncertain: boolean;
  radioCandidate: boolean;
  gameCandidate: boolean;
  playlist: boolean;
}

export interface ResourceRecord {
  id: string;
  sessionId: string;
  tabId: number;
  url: string;
  normalizedUrl: string;
  domain: string;
  origin: string;
  filename: string;
  extension?: string;
  categories: Category[];
  uncertain: boolean;
  radioCandidate: boolean;
  gameCandidate: boolean;
  playlist: boolean;
  sources: DiscoverySource[];
  firstSeen: number;
  lastSeen: number;
  rev: number;
  hitCount: number;
  networkHits: number;
  requestType?: string;
  mimeType?: string;
  statusCode?: number;
  method?: string;
  initiator?: string;
  state: RequestState;
  linkText?: string;
  elementHint?: string;
  frameUrl?: string;
  pageUrl?: string;
  error?: string;
  isBlob: boolean;
  blobOrigin?: string;
  redirectFrom?: string[];
  transferSize?: number;
  decodedBodySize?: number;
  searchText: string;
}

export interface RequestRecord {
  id: string;
  sessionId: string;
  tabId: number;
  requestId: string;
  url: string;
  finalUrl: string;
  domain: string;
  method: string;
  type: string;
  statusCode?: number;
  mimeType?: string;
  timestamp: number;
  updatedAt: number;
  rev: number;
  state: RequestState;
  initiator?: string;
  redirects: string[];
  error?: string;
  fromCache?: boolean;
  searchText: string;
}

export interface DomainAggregate {
  domain: string;
  requests: number;
  uniqueUrls: number;
  categories: Category[];
  firstSeen: number;
  lastSeen: number;
}

export interface Stats {
  requests: number;
  uniqueUrls: number;
  domains: number;
  domLinks: number;
  video: number;
  audio: number;
  gameCandidates: number;
  errors: number;
}

export interface SessionMeta {
  id: string;
  tabId: number;
  url: string;
  title: string;
  domain: string;
  status: MonitorStatus;
  scope: SessionScope;
  startedAt: number;
  updatedAt: number;
  navigationId: string;
  pageHints: PageHints;
  stats: Stats;
  warning?: string;
  limited: boolean;
  archived: boolean;
  pruneGeneration: number;
}

export interface Settings {
  scope: SessionScope;
  excludedDomains: string[];
  maxResources: number;
  maxRequests: number;
}

export interface Limits {
  maxResources: number;
  maxRequests: number;
  warnRatio: number;
}

export type NetworkObservation =
  | {
      phase: 'start';
      requestId: string;
      url: string;
      method: string;
      type: string;
      tabId: number;
      time: number;
      initiator?: string;
    }
  | {
      phase: 'redirect';
      requestId: string;
      url: string;
      redirectUrl: string;
      statusCode?: number;
      type: string;
      tabId: number;
      time: number;
      initiator?: string;
    }
  | {
      phase: 'complete';
      requestId: string;
      url: string;
      statusCode: number;
      mimeType?: string;
      type: string;
      tabId: number;
      time: number;
      fromCache?: boolean;
      initiator?: string;
    }
  | {
      phase: 'error';
      requestId: string;
      url: string;
      error: string;
      type: string;
      tabId: number;
      time: number;
      initiator?: string;
    };

export interface DomFinding {
  url: string;
  source: 'dom' | 'resourceTiming';
  element?: string;
  linkText?: string;
  rel?: string;
  as?: string;
  initiatorType?: string;
  frameUrl?: string;
  transferSize?: number;
  decodedBodySize?: number;
}

export interface DiscoveryObservation extends DomFinding {
  time: number;
  tabId: number;
  pageUrl?: string;
}

export const CATEGORY_ORDER: Category[] = [
  'link',
  'video',
  'audio',
  'radio',
  'image',
  'game',
  'script',
  'style',
  'font',
  'document',
  'archive',
  'api',
  'websocket',
  'other',
];

export function emptyStats(): Stats {
  return {
    requests: 0,
    uniqueUrls: 0,
    domains: 0,
    domLinks: 0,
    video: 0,
    audio: 0,
    gameCandidates: 0,
    errors: 0,
  };
}

export function emptyPageHints(): PageHints {
  return { markers: [], hasCanvas: false };
}
