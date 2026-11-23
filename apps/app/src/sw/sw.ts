import { pushMessageSchema } from '@la-pince/core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { notificationOf } from '../model/notification.ts';
import { openNotificationDb } from '../storage/notificationDb.ts';

declare const self: ServiceWorkerGlobalScope & { readonly __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0] };

// The shell only: API answers are never cached.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));

// A new service worker takes over at once, without reloading the open pages, which keep their code until the next start (decision 37 h).
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function show(data: PushMessageData | null): Promise<void> {
  let raw: unknown;
  try {
    raw = data?.json();
  } catch {
    raw = undefined;
  }
  const parsed = pushMessageSchema.safeParse(raw);
  const message = parsed.success ? parsed.data : undefined;
  const group = message === undefined ? undefined : await (await openNotificationDb()).get(message.groupId);
  const notification = notificationOf(message, group);
  await self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: '/icon-192.png',
    data: { path: notification.path },
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(show(event.data));
});

async function open(path: string): Promise<void> {
  const url = new URL(path, self.location.origin).href;
  const [client] = await self.clients.matchAll({ type: 'window' });
  if (client !== undefined) {
    // The open app goes to the page of the notification; `null` when the browser refuses (another origin), and a new window opens instead.
    const moved = await client.navigate(url).catch(() => null);
    if (moved !== null) {
      await moved.focus();
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const path = typeof data === 'object' && data !== null && 'path' in data && typeof data.path === 'string' ? data.path : '/';
  event.waitUntil(open(path));
});
