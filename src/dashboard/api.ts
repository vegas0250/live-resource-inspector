import { HOST_ORIGINS } from '../shared/constants';
import type { TabStateResponse } from '../shared/messages';
import type { Settings } from '../shared/types';
import { saveSettings } from '../storage/settings';

export function requestHostAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: [...HOST_ORIGINS] });
}

export function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export async function openDashboard(tabId: number): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/dashboard.html?tabId=${tabId}`) });
}

export async function readActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

export async function startMonitoring(tabId: number): Promise<TabStateResponse> {
  return send<TabStateResponse>({ type: 'START', tabId });
}

export async function control(type: 'PAUSE' | 'RESUME' | 'CLEAR', tabId: number): Promise<TabStateResponse> {
  return send<TabStateResponse>({ type, tabId });
}

export async function tabState(tabId: number): Promise<TabStateResponse> {
  return send<TabStateResponse>({ type: 'GET_TAB_STATE', tabId });
}

export async function listSessions(): Promise<TabStateResponse> {
  return send<TabStateResponse>({ type: 'LIST_SESSIONS' });
}

export async function updateScope(tabId: number, scope: Settings['scope']): Promise<void> {
  await send({ type: 'SET_SCOPE', tabId, scope });
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return saveSettings(settings);
}
