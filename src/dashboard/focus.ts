import { CATEGORY_ORDER } from '../shared/types';
import type { Category, RequestState, Stats, ViewId } from '../shared/types';

const VIEWS: ViewId[] = ['domains', 'resources', 'links', 'media', 'requests'];

export interface DashboardFocus {
  view: ViewId;
  categories: Category[];
  states: RequestState[];
}

export interface DashboardLink {
  label: string;
  view: ViewId;
  category?: Category;
  state?: 'error';
  stat: keyof Stats;
}

export const DASHBOARD_LINKS: DashboardLink[] = [
  { label: 'Запросы', view: 'requests', stat: 'requests' },
  { label: 'Уникальные URL', view: 'resources', stat: 'uniqueUrls' },
  { label: 'Домены', view: 'domains', stat: 'domains' },
  { label: 'Ссылки DOM', view: 'links', stat: 'domLinks' },
  { label: 'Видео', view: 'media', category: 'video', stat: 'video' },
  { label: 'Аудио', view: 'media', category: 'audio', stat: 'audio' },
  { label: 'Игровые кандидаты', view: 'media', category: 'game', stat: 'gameCandidates' },
  { label: 'Ошибки', view: 'requests', state: 'error', stat: 'errors' },
];

export function readDashboardFocus(search: string): DashboardFocus {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const viewParam = params.get('view');
  const view = VIEWS.includes(viewParam as ViewId) ? (viewParam as ViewId) : 'resources';
  const categoryParam = params.get('category');
  const category = CATEGORY_ORDER.includes(categoryParam as Category) ? (categoryParam as Category) : undefined;
  const states: RequestState[] = params.get('state') === 'error' ? ['error'] : [];
  return { view, categories: category ? [category] : [], states };
}

export function dashboardQuery(tabId: number, link?: Pick<DashboardLink, 'view' | 'category' | 'state'>): string {
  const params = new URLSearchParams({ tabId: String(tabId) });
  if (link?.view) params.set('view', link.view);
  if (link?.category) params.set('category', link.category);
  if (link?.state) params.set('state', link.state);
  return params.toString();
}
