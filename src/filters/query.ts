import type {
  Category,
  DomainAggregate,
  RequestRecord,
  RequestState,
  ResourceRecord,
  SortDirection,
  SortKey,
} from '../shared/types';

export interface FilterState {
  text: string;
  categories: Category[];
  excludedDomains: string[];
  sort: SortKey;
  direction: SortDirection;
  states?: RequestState[];
}

export function queryTokens(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesText(searchText: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) => searchText.includes(token));
}

export function domainExcluded(domain: string, excluded: string[]): boolean {
  const host = domain.toLowerCase();
  return excluded.some((raw) => {
    const item = raw.trim().toLowerCase();
    if (!item) return false;
    return host === item || host.endsWith(`.${item}`);
  });
}

export function isMediaRecord(record: ResourceRecord): boolean {
  return (
    record.playlist ||
    record.radioCandidate ||
    record.gameCandidate ||
    record.categories.some((category) => category === 'video' || category === 'audio' || category === 'radio' || category === 'game')
  );
}

export function isLinkRecord(record: ResourceRecord): boolean {
  return record.categories.includes('link');
}

export function filterResources(records: ResourceRecord[], filter: FilterState): ResourceRecord[] {
  const tokens = queryTokens(filter.text);
  const matched = records.filter((record) => resourceVisible(record, filter, tokens));
  matched.sort((left, right) => compareResources(left, right, filter.sort, filter.direction));
  return matched;
}

export function filterDomains(records: DomainAggregate[], filter: FilterState): DomainAggregate[] {
  const tokens = queryTokens(filter.text);
  const matched = records.filter((record) => {
    if (domainExcluded(record.domain, filter.excludedDomains)) return false;
    if (filter.categories.length > 0 && !filter.categories.some((category) => record.categories.includes(category))) {
      return false;
    }
    if (!matchesText(record.domain.toLowerCase(), tokens) && !matchesText(record.categories.join(' '), tokens)) {
      return false;
    }
    return true;
  });
  matched.sort((left, right) => compareDomains(left, right, filter.sort, filter.direction));
  return matched;
}

export function filterRequests(records: RequestRecord[], filter: FilterState): RequestRecord[] {
  const tokens = queryTokens(filter.text);
  const matched = records.filter((record) => {
    if (domainExcluded(record.domain, filter.excludedDomains)) return false;
    if (filter.states && filter.states.length > 0 && !filter.states.includes(record.state)) return false;
    if (!requestMatchesCategory(record, filter.categories)) return false;
    return matchesText(record.searchText, tokens);
  });
  matched.sort((left, right) => compareRequests(left, right, filter.sort, filter.direction));
  return matched;
}

function resourceVisible(record: ResourceRecord, filter: FilterState, tokens: string[]): boolean {
  if (domainExcluded(record.domain, filter.excludedDomains)) return false;
  if (filter.categories.length > 0 && !filter.categories.some((category) => record.categories.includes(category))) {
    return false;
  }
  return matchesText(record.searchText, tokens);
}

function requestMatchesCategory(record: RequestRecord, categories: Category[]): boolean {
  if (categories.length === 0) return true;
  return categories.some((category) => {
    if (category === 'script') return record.type === 'script';
    if (category === 'style') return record.type === 'stylesheet';
    if (category === 'image') return record.type === 'image';
    if (category === 'font') return record.type === 'font';
    if (category === 'api') return record.type === 'xmlhttprequest' || record.type === 'fetch';
    if (category === 'websocket') return record.type === 'websocket';
    if (category === 'video' || category === 'audio' || category === 'radio') {
      return record.type === 'media' || record.searchText.includes(category);
    }
    return record.searchText.includes(category);
  });
}

function directionOf(value: number, direction: SortDirection): number {
  return direction === 'asc' ? value : -value;
}

function compareResources(left: ResourceRecord, right: ResourceRecord, sort: SortKey, direction: SortDirection): number {
  let value = 0;
  if (sort === 'domain') value = left.domain.localeCompare(right.domain);
  else if (sort === 'category') value = left.categories.join(',').localeCompare(right.categories.join(','));
  else if (sort === 'count') value = left.hitCount - right.hitCount;
  else value = left.firstSeen - right.firstSeen;
  if (value === 0) value = left.id.localeCompare(right.id);
  return directionOf(value, direction);
}

function compareDomains(left: DomainAggregate, right: DomainAggregate, sort: SortKey, direction: SortDirection): number {
  let value = 0;
  if (sort === 'domain') value = left.domain.localeCompare(right.domain);
  else if (sort === 'category') value = left.categories.join(',').localeCompare(right.categories.join(','));
  else if (sort === 'count') value = left.requests - right.requests;
  else value = left.lastSeen - right.lastSeen;
  if (value === 0) value = left.domain.localeCompare(right.domain);
  return directionOf(value, direction);
}

function compareRequests(left: RequestRecord, right: RequestRecord, sort: SortKey, direction: SortDirection): number {
  let value = 0;
  if (sort === 'domain') value = left.domain.localeCompare(right.domain);
  else if (sort === 'category') value = left.type.localeCompare(right.type);
  else if (sort === 'count') value = (left.statusCode ?? 0) - (right.statusCode ?? 0);
  else value = left.timestamp - right.timestamp;
  if (value === 0) value = left.id.localeCompare(right.id);
  return directionOf(value, direction);
}
