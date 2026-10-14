import type { DomFinding, PageHints, SessionMeta, SessionScope } from './types';

export interface TabStateResponse {
  ok: boolean;
  error?: string;
  restricted?: boolean;
  hostAccess?: boolean;
  session?: SessionMeta;
  sessions?: SessionMeta[];
}

export type DashboardEvent =
  | { type: 'DIRTY'; sessionId: string; pruneGeneration: number }
  | { type: 'SESSION'; session: SessionMeta }
  | { type: 'CLEARED'; sessionId: string; session?: SessionMeta };

export type RuntimeMessage =
  | { type: 'START'; tabId: number }
  | { type: 'PAUSE'; tabId: number }
  | { type: 'RESUME'; tabId: number }
  | { type: 'CLEAR'; tabId: number }
  | { type: 'GET_TAB_STATE'; tabId: number }
  | { type: 'LIST_SESSIONS' }
  | { type: 'SET_SCOPE'; tabId: number; scope: SessionScope }
  | { type: 'CONTENT_HELLO' }
  | { type: 'DOM_BATCH'; items: DomFinding[]; pageHints?: PageHints }
  | { type: 'START_SCAN' }
  | { type: 'STOP_SCAN' };
