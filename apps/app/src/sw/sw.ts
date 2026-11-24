import { pushMessageSchema } from '@la-pince/core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { notificationOf, pathOf } from '../model/notification.ts';
import { type NotifiedGroup, openNotificationDb } from '../storage/notificationDb.ts';

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
  let group: NotifiedGroup | undefined;
  try {
    group = message === undefined ? undefined : await (await openNotificationDb()).get(message.groupId);
  } catch {
    // Storage unavailable: the notification still shows, untitled. Safari drops a subscription whose pushes show nothing.
    group = undefined;
  }
  const notification = notificationOf(message, group);
  await self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: '/icon-192.png',
    // Android draws it in the status bar from its alpha alone: a white silhouette on transparency.
    badge: '/badge-96.png',
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
    // Focused first, while the touch still allows it; then the open app goes to the page of the notification, or a new window opens where the
    // browser refuses to navigate it.
    const focused = await client.focus().catch(() => client);
    const moved = await Promise.resolve()
      .then(() => focused.navigate(url))
      .catch(() => null);
    if (moved !== null) {
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(open(pathOf(event.notification.data)));
});
