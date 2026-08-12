import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

interface NavigationItem {
  path: string;
  source: string;
  title: string;
  url: string;
}

function normalizePath(path: string): string {
  try {
    return decodeURIComponent(path).replace(/\/+$/, '');
  } catch {
    return path.replace(/\/+$/, '');
  }
}

function makeLink(item: NavigationItem | undefined) {
  if (!item) return undefined;
  return {
    type: 'link' as const,
    label: item.title,
    href: item.url,
    isCurrent: false,
    badge: undefined,
    attrs: {},
  };
}

export const onRequest = defineRouteMiddleware((context) => {
  if (!context.url.pathname.startsWith('/rendered/')) return;

  try {
    const navigationPath = resolve('src/content/docs/rendered/_navigation.json');
    const payload = JSON.parse(readFileSync(navigationPath, 'utf-8')) as {
      items?: NavigationItem[];
    };
    const items = payload.items ?? [];
    const currentPath = normalizePath(context.url.pathname);
    const currentIndex = items.findIndex(
      (item) => normalizePath(item.url) === currentPath
    );
    if (currentIndex < 0) return;

    context.locals.starlightRoute.pagination = {
      prev: makeLink(items[currentIndex - 1]),
      next: makeLink(items[currentIndex + 1]),
    };
  } catch {
    // Keep Starlight's generated pagination until the first sync publishes an order.
  }
});
