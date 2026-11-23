import { type MemberId, pushSubscriptionSchema } from '@la-pince/core';
import { type ReactNode, useEffect, useState } from 'react';

import { notificationErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { type NotificationDb, type NotifiedGroup, openNotificationDb } from '../storage/notificationDb.ts';
import type { ApiClient, ApiResult, NotificationError } from '../sync/client.ts';
import { useApiClient } from '../sync/context.ts';
import { browserPushPlatform, type PushPlatform } from '../sync/push.ts';
import layout from './Layout.module.css';
import styles from './ShareLink.module.css';

type Status = 'checking' | 'hidden' | 'home_screen' | 'denied' | 'off' | 'on';

interface NotificationsProps {
  readonly token: string;
  readonly title: string;
  /** Who I am: the member whose notices this phone receives, followed when it changes. */
  readonly member: MemberId;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: PushPlatform;
}

let browser: PushPlatform | undefined;

const entryOf = async (db: NotificationDb, token: string): Promise<NotifiedGroup | undefined> =>
  (await db.all()).find((group) => group.token === token);

/** Saves the subscription of this browser on the server as the member, then on the phone under the group's id, which push messages carry. */
async function save(
  client: ApiClient,
  db: NotificationDb,
  group: { readonly token: string; readonly title: string; readonly member: MemberId },
  subscription: PushSubscription,
): Promise<ApiResult<undefined, NotificationError>> {
  const json = pushSubscriptionSchema.safeParse(subscription.toJSON());
  if (!json.success) {
    return { ok: false, error: 'invalid_request' };
  }
  const result = await client.subscribe(group.token, { member: group.member, subscription: json.data });
  if (!result.ok) {
    return result;
  }
  await db.put({ groupId: result.value, ...group, endpoint: json.data.endpoint });
  return { ok: true, value: undefined };
}

/**
 * Where the phone stands for this group, brought in line with the browser: an entry whose subscription the browser dropped is forgotten, and a
 * subscription that changed address or member is saved again. A failed save keeps the entry as it was, so that the next opening tries again.
 */
async function reconcile(client: ApiClient, platform: PushPlatform, group: Parameters<typeof save>[2]): Promise<Status> {
  const db = await openNotificationDb();
  const entry = await entryOf(db, group.token);
  if (entry === undefined) {
    return platform.permission() === 'denied' ? 'denied' : 'off';
  }
  const subscription = await platform.getSubscription();
  if (subscription === null) {
    await db.remove(entry.groupId);
    return 'off';
  }
  if (subscription.endpoint !== entry.endpoint || entry.member !== group.member) {
    await save(client, db, group, subscription);
  } else if (entry.title !== group.title) {
    await db.put({ ...entry, title: group.title });
  }
  return 'on';
}

/**
 * The notifications of the group on this phone: activation, a test notification, deactivation. Hidden on an instance without notifications and in
 * browsers without the Push API, save on an iPhone, told to add the app to its home screen first.
 */
export function Notifications({ token, title, member, platform: given }: NotificationsProps): ReactNode {
  const client = useApiClient();
  const platform = given ?? (browser ??= browserPushPlatform());
  const [status, setStatus] = useState<Status>('checking');
  const [publicKey, setPublicKey] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (platform.support === 'unsupported') {
      return;
    }
    // Left by a later run (member changed) or by unmounting: its results are dropped.
    let live = true;
    const isLive = () => live;
    void (async () => {
      const key = await client.fetchPushKey();
      if (!isLive()) {
        return;
      }
      if (!key.ok) {
        // An instance without notifications, or out of reach: nothing to offer until the next opening.
        setStatus('hidden');
        return;
      }
      setPublicKey(key.value);
      const next = platform.support === 'home_screen' ? 'home_screen' : await reconcile(client, platform, { token, title, member });
      if (isLive()) {
        setStatus(next);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, platform, token, title, member]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const enable = () =>
    act(async () => {
      const permission = await platform.requestPermission();
      if (permission !== 'granted') {
        // Dismissed, the prompt can be asked again; refused, only the browser's settings lift it.
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      let subscription: PushSubscription;
      try {
        subscription = (await platform.getSubscription()) ?? (await platform.subscribe(publicKey ?? ''));
      } catch {
        setMessage(m.notifications_subscribe_failed());
        return;
      }
      const result = await save(client, await openNotificationDb(), { token, title, member }, subscription);
      if (result.ok) {
        setStatus('on');
      } else {
        setMessage(notificationErrorMessage(result.error));
      }
    });

  const disable = () =>
    act(async () => {
      const db = await openNotificationDb();
      const entry = await entryOf(db, token);
      if (entry !== undefined) {
        const result = await client.unsubscribe(token, entry.endpoint);
        // A group gone from the server has no subscription left to stop.
        if (!result.ok && result.error !== 'group_not_found') {
          setMessage(notificationErrorMessage(result.error));
          return;
        }
        await db.remove(entry.groupId);
      }
      // One subscription per browser, shared by its groups: dropped only once no other group uses it.
      const subscription = await platform.getSubscription();
      if (subscription !== null && !(await db.all()).some((group) => group.endpoint === subscription.endpoint)) {
        await subscription.unsubscribe().catch(() => false);
      }
      setStatus('off');
    });

  const test = () =>
    act(async () => {
      const db = await openNotificationDb();
      const entry = await entryOf(db, token);
      const result = entry === undefined ? ({ ok: false, error: 'subscription_not_found' } as const) : await client.sendTest(token, entry.endpoint);
      if (result.ok) {
        setMessage(m.notifications_test_sent());
        return;
      }
      if (result.error === 'subscription_not_found') {
        if (entry !== undefined) {
          await db.remove(entry.groupId);
        }
        setStatus('off');
      }
      setMessage(notificationErrorMessage(result.error));
    });

  if (status === 'checking' || status === 'hidden') {
    return null;
  }
  return (
    <div className={styles.share}>
      {status === 'home_screen' ? <p className={layout.muted}>{m.notifications_home_screen()}</p> : null}
      {status === 'denied' ? <p className={layout.muted}>{m.notifications_denied()}</p> : null}
      {status === 'off' ? (
        <>
          <button className={layout.link} type="button" disabled={busy} onClick={() => void enable()}>
            {m.notifications_enable()}
          </button>
          <span className={layout.muted}>{m.notifications_explanation()}</span>
        </>
      ) : null}
      {status === 'on' ? (
        <>
          <span className={layout.muted}>{m.notifications_on()}</span>
          <button className={layout.link} type="button" disabled={busy} onClick={() => void test()}>
            {m.notifications_test()}
          </button>
          <button className={layout.link} type="button" disabled={busy} onClick={() => void disable()}>
            {m.notifications_disable()}
          </button>
        </>
      ) : null}
      <p className={layout.muted} aria-live="polite">
        {message}
      </p>
    </div>
  );
}
