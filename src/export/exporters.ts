import { CLIPBOARD_CHAR_LIMIT } from '../shared/constants';
import type { DomainAggregate, RequestRecord, ResourceRecord } from '../shared/types';

const RESOURCE_FIELDS = [
  'id',
  'url',
  'normalizedUrl',
  'domain',
  'origin',
  'filename',
  'extension',
  'categories',
  'uncertain',
  'radioCandidate',
  'gameCandidate',
  'playlist',
  'sources',
  'firstSeen',
  'lastSeen',
  'hitCount',
  'networkHits',
  'requestType',
  'mimeType',
  'statusCode',
  'method',
  'initiator',
  'tabId',
  'state',
  'linkText',
  'elementHint',
  'frameUrl',
  'pageUrl',
  'error',
  'isBlob',
  'blobOrigin',
  'redirectFrom',
  'transferSize',
  'decodedBodySize',
] as const satisfies readonly (keyof ResourceRecord)[];

const REQUEST_FIELDS = [
  'id',
  'url',
  'finalUrl',
  'domain',
  'method',
  'type',
  'statusCode',
  'mimeType',
  'timestamp',
  'state',
  'initiator',
  'redirects',
  'error',
  'fromCache',
  'tabId',
] as const satisfies readonly (keyof RequestRecord)[];

export function csvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toPublicResource(record: ResourceRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of RESOURCE_FIELDS) output[key] = record[key];
  return output;
}

export function toPublicRequest(record: RequestRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of REQUEST_FIELDS) output[key] = record[key];
  return output;
}

export function toPublicDomain(record: DomainAggregate): Record<string, unknown> {
  return {
    domain: record.domain,
    requests: record.requests,
    uniqueUrls: record.uniqueUrls,
    categories: record.categories,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
  };
}

export function csvDocument(headers: string[], rows: Array<Array<string | number | boolean | undefined>>): string[] {
  const parts: string[] = ['\uFEFF', `${headers.map((header) => csvCell(header)).join(',')}\n`];
  let buffer: string[] = [];
  for (const row of rows) {
    buffer.push(`${row.map((cell) => csvCell(cell)).join(',')}\n`);
    if (buffer.length >= 1000) {
      parts.push(buffer.join(''));
      buffer = [];
    }
  }
  if (buffer.length > 0) parts.push(buffer.join(''));
  return parts;
}

export function textLines(lines: string[]): string[] {
  const parts: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    buffer.push(line.replace(/[\r\n]+/g, ' '));
    if (buffer.length >= 2000) {
      parts.push(`${buffer.join('\n')}\n`);
      buffer = [];
    }
  }
  if (buffer.length > 0) parts.push(`${buffer.join('\n')}\n`);
  return parts;
}

export function jsonParts(values: unknown[]): string[] {
  if (values.length === 0) return ['[]'];
  const parts: string[] = ['['];
  for (let index = 0; index < values.length; index += 1) {
    parts.push(JSON.stringify(values[index]));
    if (index < values.length - 1) parts.push(',');
  }
  parts.push(']');
  return parts;
}

export function deliveryPlan(charLength: number): 'clipboard' | 'file' {
  return charLength <= CLIPBOARD_CHAR_LIMIT ? 'clipboard' : 'file';
}

export function partsLength(parts: string[]): number {
  return parts.reduce((total, part) => total + part.length, 0);
}

export function resourceCsv(records: ResourceRecord[]): string[] {
  return csvDocument(
    ['url', 'domain', 'categories', 'sources', 'mimeType', 'status', 'state', 'method', 'initiator', 'firstSeen', 'hitCount', 'linkText'],
    records.map((record) => [
      record.url,
      record.domain,
      record.categories.join('|'),
      record.sources.join('|'),
      record.mimeType,
      record.statusCode,
      record.state,
      record.method,
      record.initiator,
      record.firstSeen,
      record.hitCount,
      record.linkText,
    ]),
  );
}

export function requestCsv(records: RequestRecord[]): string[] {
  return csvDocument(
    ['url', 'finalUrl', 'domain', 'method', 'type', 'status', 'state', 'mimeType', 'timestamp', 'initiator', 'redirects', 'error'],
    records.map((record) => [
      record.url,
      record.finalUrl,
      record.domain,
      record.method,
      record.type,
      record.statusCode,
      record.state,
      record.mimeType,
      record.timestamp,
      record.initiator,
      record.redirects.join(' '),
      record.error,
    ]),
  );
}

export function domainCsv(records: DomainAggregate[]): string[] {
  return csvDocument(
    ['domain', 'requests', 'uniqueUrls', 'categories', 'firstSeen', 'lastSeen'],
    records.map((record) => [
      record.domain,
      record.requests,
      record.uniqueUrls,
      record.categories.join('|'),
      record.firstSeen,
      record.lastSeen,
    ]),
  );
}
