import { HOST_ORIGINS } from '../shared/constants';
import type { NetworkObservation } from '../shared/types';
import { isRestrictedUrl } from '../shared/url';

export const WATCH_URLS = [...HOST_ORIGINS];

export interface RequestDetails {
  requestId: string;
  url: string;
  method?: string;
  type?: string;
  tabId: number;
  timeStamp: number;
  initiator?: string;
  documentUrl?: string;
  statusCode?: number;
  error?: string;
  redirectUrl?: string;
  fromCache?: boolean;
  responseHeaders?: chrome.webRequest.HttpHeader[];
}

export function contentTypeOf(headers: chrome.webRequest.HttpHeader[] | undefined): string | undefined {
  if (!headers) return undefined;
  for (const header of headers) {
    if (header.name.toLowerCase() === 'content-type' && header.value) return header.value;
  }
  return undefined;
}

export function initiatorOf(details: RequestDetails): string | undefined {
  return details.initiator || details.documentUrl;
}

export function isOwnRequest(url: string, initiator: string | undefined, extensionId: string): boolean {
  const own = `chrome-extension://${extensionId}`;
  return url.startsWith(own) || Boolean(initiator?.startsWith(own));
}

export function toObservation(phase: NetworkObservation['phase'], details: RequestDetails): NetworkObservation | null {
  if (details.tabId < 0 || !details.url) return null;
  const initiator = initiatorOf(details);
  const type = details.type ?? 'other';
  if (phase === 'start') {
    return {
      phase,
      requestId: details.requestId,
      url: details.url,
      method: details.method ?? 'GET',
      type,
      tabId: details.tabId,
      time: details.timeStamp,
      initiator,
      documentUrl: details.documentUrl,
    };
  }
  if (phase === 'redirect') {
    if (!details.redirectUrl) return null;
    return {
      phase,
      requestId: details.requestId,
      url: details.url,
      redirectUrl: details.redirectUrl,
      statusCode: details.statusCode,
      type,
      tabId: details.tabId,
      time: details.timeStamp,
      initiator,
      documentUrl: details.documentUrl,
    };
  }
  if (phase === 'complete') {
    return {
      phase,
      requestId: details.requestId,
      url: details.url,
      statusCode: details.statusCode ?? 0,
      mimeType: contentTypeOf(details.responseHeaders),
      type,
      tabId: details.tabId,
      time: details.timeStamp,
      fromCache: details.fromCache,
      initiator,
      documentUrl: details.documentUrl,
    };
  }
  return {
    phase: 'error',
    requestId: details.requestId,
    url: details.url,
    error: details.error ?? 'unknown',
    type,
    tabId: details.tabId,
    time: details.timeStamp,
    initiator,
    documentUrl: details.documentUrl,
  };
}

export function pageUrlForObservation(observation: NetworkObservation): string | undefined {
  const candidate = observation.type === 'main_frame' ? observation.url : observation.documentUrl || observation.initiator;
  if (!candidate || isRestrictedUrl(candidate)) return undefined;
  if (!/^https?:/i.test(candidate)) return undefined;
  return candidate;
}
