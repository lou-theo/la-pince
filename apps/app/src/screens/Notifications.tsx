import { type MemberId, pushSubscriptionSchema } from '@la-pince/core';
import { type ReactNode, useEffect, useState } from 'react';

import { notificationErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { type NotificationDb, type NotifiedGroup, openNotificationDb } from '../storage/notificationDb.ts';
import type { ApiClient, ApiResult, NotificationError } from '../sync/client.ts';
import { useApiClient } from '../sync/context.ts';
import { browserPushPlatform, type PushPlatform, subscriptionKey } from '../sync/push.ts';
import layout from './Layout.module.css';
import styles from './Notifications.module.css';

type Status = 'checking' | 'hidden' | 'home_screen' | 'denied' | 'off' | 'on';

interface NotificationsProps {
  readonly token: string;
  readonly title: string;
  /** Who I am: the member whose notices this phone receives, followed when it changes. */
  readonly member: MemberId;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: PushPlatform;
}

// One instance: `platform` is an effect dependency, and a new object at each render would start the effect again.
let browser: PushPlatform | undefined;

// Subscription writes, one at a time for the whole page: a member chosen then chosen back reaches the server last, whatever the network does.
let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(write: () => Promise<T>): Promise<T> {
  const next = writes.then(write);
  writes = next.catch(() => undefined);
  return next;
}

const entryOf = async (db: NotificationDb, token: string): Promise<NotifiedGroup | undefined> =>
  (await db.all()).find((group) => group.token === token);

interface GroupAs {
  readonly token: string;
  readonly title: string;
  readonly member: MemberId;
}

/**
 * Saves the subscription of this browser on the server as the member, then on the phone under the group's id, which push messages carry; skipped
 * when, its turn come, it is no longer `wanted` (a member chosen since).
 */
function save(
  client: ApiClient,
  group: GroupAs,
  subscription: PushSubscription,
  wanted: () => boolean = () => true,
): Promise<ApiResult<undefined, NotificationError>> {
  return serialized(async () => {
    if (!wanted()) {
      return { ok: true, value: undefined } as const;
    }
    const json = pushSubscriptionSchema.safeParse(subscription.toJSON());
    if (!json.success) {
      return { ok: false, error: 'invalid_request' } as const;
    }
    const result = await client.subscribe(group.token, { member: group.member, subscription: json.data });
    if (!result.ok) {
      return result;
    }
    await (await openNotificationDb()).put({ groupId: result.value, ...group, endpoint: json.data.endpoint });
    return { ok: true, value: undefined } as const;
  });
}

// A subscription the browser made with other keys than the instance's (keys changed since): its push service refuses what the server sends.
const otherKeys = (subscription: PushSubscription, publicKey: string) => {
  const key = subscriptionKey(subscription);
  return key !== undefined && key !== publicKey;
};

/**
 * Where the phone stands for this group, brought in line with the browser and the server: an entry whose subscription the browser dropped, or made
 * with other keys, is forgotten; otherwise the subscription is saved again at each opening, as the current member and address, which also restores
 * it on a server restored from a backup. A failed save keeps the entry and is told, the next opening trying again.
 */
async function reconcile(
  client: ApiClient,
  platform: PushPlatform,
  group: GroupAs,
  publicKey: string,
  wanted: () => boolean,
): Promise<{ status: Status; error?: NotificationError }> {
  const db = await openNotificationDb();
  const entry = await entryOf(db, group.token);
  if (entry === undefined) {
    return { status: platform.permission() === 'denied' ? 'denied' : 'off' };
  }
  const subscription = await platform.getSubscription();
  if (subscription === null || otherKeys(subscription, publicKey)) {
    await db.remove(entry.groupId);
    return { status: 'off' };
  }
  const saved = await save(client, group, subscription, wanted);
  return saved.ok ? { status: 'on' } : { status: 'on', error: saved.error };
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
    // Left by a later run (member changed) or by unmounting: its results are dropped. Read through a function, which TypeScript does not narrow.
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
      if (platform.support === 'home_screen') {
        setStatus('home_screen');
        return;
      }
      const next = await reconcile(client, platform, { token, title, member }, key.value, isLive);
      if (isLive()) {
        setStatus(next.status);
        setMessage(next.error === undefined ? undefined : notificationErrorMessage(next.error));
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

  const enable = (key: string) =>
    act(async () => {
      const permission = await platform.requestPermission();
      if (permission !== 'granted') {
        // Dismissed, the prompt can be asked again; refused, only the browser's settings lift it.
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      let subscription: PushSubscription;
      try {
        const current = await platform.getSubscription();
        if (current !== null && otherKeys(current, key)) {
          // The other groups on these old keys get the new subscription at their next opening.
          await current.unsubscribe();
        }
        subscription = current !== null && !otherKeys(current, key) ? current : await platform.subscribe(key);
      } catch {
        setMessage(m.notifications_subscribe_failed());
        return;
      }
      const result = await save(client, { token, title, member }, subscription);
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
      // One subscription per browser, shared by its groups: dropped only with the last one, even if another still holds an older address of it.
      const subscription = await platform.getSubscription();
      if (subscription !== null && (await db.all()).length === 0) {
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
    <div className={styles.notifications}>
      {status === 'home_screen' ? <p className={layout.muted}>{m.notifications_home_screen()}</p> : null}
      {status === 'denied' ? <p className={layout.muted}>{m.notifications_denied()}</p> : null}
      {status === 'off' && publicKey !== undefined ? (
        <>
          <button className={layout.link} type="button" disabled={busy} onClick={() => void enable(publicKey)}>
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
