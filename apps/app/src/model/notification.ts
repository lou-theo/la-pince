import type { Notice, PushMessage } from '@la-pince/core';

import { m } from '../i18n/paraglide/messages.js';

/** What this phone knows of a group whose notifications it receives: the link's token, to open it, and the title, to name it. */
export interface NotifiedGroupLink {
  readonly token: string;
  readonly title: string;
}

/** A notification as the service worker shows it, and the path a touch on it opens. */
export interface ShownNotification {
  readonly title: string;
  readonly body: string;
  readonly path: string;
}

function line(notice: Notice & { readonly authorName: string }): string {
  const values = { author: notice.authorName, title: notice.title };
  switch (notice.kind) {
    case 'added':
      return m.notification_added(values);
    case 'changed':
      return m.notification_changed(values);
    case 'deleted':
      return m.notification_deleted(values);
  }
}

/**
 * The notification of a push message: titled with the group, one line per notice and how many more there were. A touch opens the operation when
 * the message tells about one that still exists, the group otherwise. A message it cannot read, or from a group this phone no longer knows, still
 * shows a notification, which browsers require of every push, and opens the app.
 */
export function notificationOf(message: PushMessage | undefined, group: NotifiedGroupLink | undefined): ShownNotification {
  if (message === undefined || group === undefined) {
    return { title: m.app_name(), body: m.notification_fallback_body(), path: '/' };
  }
  const home = `/g/${group.token}`;
  if (message.type === 'test') {
    return { title: group.title, body: m.notification_test(), path: home };
  }
  const lines = message.notices.map(line);
  const more = message.count - message.notices.length;
  const [only] = message.notices;
  const path = message.count === 1 && only !== undefined && only.kind !== 'deleted' ? `${home}/operations/${only.operationId}` : home;
  return { title: group.title, body: [...lines, ...(more > 0 ? [m.notification_more({ count: more })] : [])].join('\n'), path };
}
