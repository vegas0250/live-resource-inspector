import type { RuntimeMessage } from '../shared/messages';
import { Monitor } from './controller';
import { isOwnRequest, toObservation, WATCH_URLS, type RequestDetails } from './network';

// Слушатели регистрируются синхронно: service worker Manifest V3 может быть
// остановлен, и события webRequest доставляются только уже зарегистрированным обработчикам.
const monitor = new Monitor();
const extensionId = chrome.runtime.id;

function observe(phase: 'start' | 'redirect' | 'complete' | 'error', details: RequestDetails): void {
  const observation = toObservation(phase, details);
  if (!observation || isOwnRequest(details.url, observation.initiator, extensionId)) return;
  monitor.onNetwork(observation);
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  observe('start', details);
  return undefined;
}, { urls: WATCH_URLS });

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  observe('redirect', details);
  return undefined;
}, { urls: WATCH_URLS });

chrome.webRequest.onCompleted.addListener((details) => {
  observe('complete', details);
  return undefined;
}, { urls: WATCH_URLS }, ['responseHeaders']);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  observe('error', details);
  return undefined;
}, { urls: WATCH_URLS });

chrome.webNavigation.onCommitted.addListener((details) => {
  void monitor.onCommitted(details.tabId, details.frameId, details.url, details.transitionType);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  monitor.onHistory(details.tabId, details.url);
});

chrome.tabs.onActivated.addListener((info) => {
  void monitor.ensureTab(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') void monitor.ensureTab(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'dashboard') monitor.addPort(port);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void route(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : 'Не удалось обработать сообщение';
      sendResponse({ ok: false, error: text });
    });
  return true;
});

async function route(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'START':
      return monitor.start(message.tabId);
    case 'PAUSE':
      return monitor.pause(message.tabId);
    case 'RESUME':
      return monitor.resume(message.tabId);
    case 'CLEAR':
      return monitor.clear(message.tabId);
    case 'GET_TAB_STATE':
      return monitor.getTabState(message.tabId);
    case 'LIST_SESSIONS':
      return monitor.list();
    case 'SET_SCOPE':
      return monitor.setScope(message.tabId, message.scope);
    case 'CONTENT_HELLO':
      return monitor.contentHello(sender.tab?.id);
    case 'DOM_BATCH':
      monitor.onDom(sender.tab?.id, message.items ?? [], message.pageHints);
      return { ok: true };
    default:
      return { ok: false, error: 'Неизвестное сообщение' };
  }
}
