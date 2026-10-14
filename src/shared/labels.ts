import type { Category, DiscoverySource, RequestState } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  video: 'Видео',
  audio: 'Аудио',
  radio: 'Радио',
  image: 'Изображения',
  game: 'Игры',
  script: 'Скрипты',
  style: 'Стили',
  font: 'Шрифты',
  document: 'Документы',
  archive: 'Архивы',
  api: 'API и Fetch/XHR',
  websocket: 'WebSocket',
  link: 'Ссылки',
  other: 'Прочее',
};

export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  webRequest: 'Сеть',
  dom: 'DOM',
  resourceTiming: 'Resource Timing',
};

export const STATE_LABELS: Record<RequestState, string> = {
  pending: 'Выполняется',
  complete: 'Завершён',
  error: 'Ошибка',
  redirect: 'Перенаправление',
};

export const VIEW_LABELS = {
  domains: 'Домены',
  resources: 'Ресурсы',
  links: 'Ссылки',
  media: 'Медиа',
  requests: 'Запросы',
} as const;

export function typeLabel(input: {
  categories: Category[];
  uncertain: boolean;
  radioCandidate: boolean;
  gameCandidate: boolean;
}): string {
  const onlyOther = input.categories.length === 1 && input.categories[0] === 'other';
  if (onlyOther && !input.uncertain) return 'Неизвестный тип';
  if (input.uncertain && onlyOther) return 'Возможное совпадение';
  const names = input.categories.map((category) => CATEGORY_LABELS[category]);
  if (input.uncertain) names.push('возможное совпадение');
  return names.join(', ');
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export function formatClock(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
