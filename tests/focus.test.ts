import { describe, expect, it } from 'vitest';
import { pageUrlForObservation } from '../src/background/network';
import { dashboardQuery, readDashboardFocus } from '../src/dashboard/focus';

describe('dashboard focus', () => {
  it('открывает раздел и фильтр из адреса анализатора', () => {
    expect(readDashboardFocus('?tabId=4&view=media&category=video')).toEqual({
      view: 'media',
      categories: ['video'],
      states: [],
    });
    expect(readDashboardFocus('view=requests&state=error').states).toEqual(['error']);
    expect(readDashboardFocus('view=nope').view).toBe('resources');
    expect(dashboardQuery(4, { view: 'requests', state: 'error' })).toBe('tabId=4&view=requests&state=error');
  });
});

describe('page url for a network event', () => {
  it('берёт документ, а не адрес подресурса', () => {
    expect(pageUrlForObservation({
      phase: 'start',
      requestId: '1',
      url: 'https://cdn.example/app.js',
      method: 'GET',
      type: 'script',
      tabId: 1,
      time: 1,
      documentUrl: 'https://shop.example/item',
    })).toBe('https://shop.example/item');
    expect(pageUrlForObservation({
      phase: 'start',
      requestId: '2',
      url: 'https://shop.example/next',
      method: 'GET',
      type: 'main_frame',
      tabId: 1,
      time: 2,
    })).toBe('https://shop.example/next');
    expect(pageUrlForObservation({
      phase: 'start',
      requestId: '3',
      url: 'https://cdn.example/app.js',
      method: 'GET',
      type: 'script',
      tabId: 1,
      time: 3,
      documentUrl: 'chrome://newtab/',
    })).toBeUndefined();
  });
});
