import { type ApiError, groupIdSchema, memberIdSchema } from '@la-pince/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { openNotificationDb } from '../storage/notificationDb.ts';
import { createApiClient } from '../sync/client.ts';
import { ApiClientContext } from '../sync/context.ts';
import type { PushPlatform, PushSupport } from '../sync/push.ts';
import { json } from '../testing/fake-server.ts';
import { Notifications } from './Notifications.tsx';

const token = 'demo-token-of-the-notification-tests-0123';
const publicKey = `B${'k'.repeat(86)}`;
const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
const member = (id: string) => memberIdSchema.parse(id);

type FakeSubscription = PushSubscription & { unsubscribed: boolean };

const bytesOf = (base64url: string) => Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;

/** A subscription of the browser, made with the instance's key unless another is given. */
function subscription(name: string, key = publicKey): FakeSubscription {
  const fake = {
    endpoint: endpoint(name),
    options: { applicationServerKey: bytesOf(key) },
    unsubscribed: false,
    toJSON: () => ({ endpoint: endpoint(name), keys }),
    unsubscribe: () => {
      fake.unsubscribed = true;
      return Promise.resolve(true);
    },
  };
  return fake as unknown as FakeSubscription;
}

/** A browser whose permission prompt answers `answer`, and whose push service gives a subscription named `phone`. */
function browser({
  support = 'ready',
  permission = 'default',
  answer = 'granted',
  current = null,
}: {
  support?: PushSupport;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  current?: FakeSubscription | null;
} = {}) {
  const state = { permission, current, subscribedWith: [] as string[] };
  const platform: PushPlatform = {
    support,
    permission: () => state.permission,
    requestPermission: () => {
      state.permission = answer;
      return Promise.resolve(answer);
    },
    getSubscription: () => Promise.resolve(state.current),
    subscribe: (key) => {
      state.subscribedWith.push(key);
      state.current = subscription('phone');
      return Promise.resolve(state.current);
    },
  };
  return { platform, state };
}

/** The server of the notification routes; `refuse` answers an error to a method and path instead, `hold` delays the answer to a subscription. */
function server({
  refuse = {},
  hold,
}: { refuse?: Record<string, [ApiError['error'], number]>; hold?: (member: string) => Promise<void> | undefined } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const client = createApiClient((url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const refused = refuse[`${method} ${url}`];
    if (refused !== undefined) {
      return Promise.resolve(json({ error: refused[0] }, refused[1]));
    }
    if (url === '/api/notifications/key') {
      return Promise.resolve(json({ publicKey }));
    }
    if (method === 'PUT') {
      const { member: as } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { member: string };
      return (hold?.(as) ?? Promise.resolve()).then(() => json({ groupId: 'week-end' }));
    }
    return Promise.resolve(new Response(null, { status: method === 'POST' ? 202 : 204 }));
  });
  return { client, calls, writes: () => calls.filter((call) => call.method !== 'GET') };
}

function show(client: ReturnType<typeof server>['client'], platform: PushPlatform, as = 'm1') {
  const element = (id: string) => (
    <ApiClientContext value={client}>
      <Notifications token={token} title="Week-end" member={member(id)} platform={platform} />
    </ApiClientContext>
  );
  const { rerender } = render(element(as));
  return {
    become: (id: string) => {
      rerender(element(id));
    },
  };
}

const subscriptionUrl = `/api/groups/${token}/subscription`;
const saved = async () => (await openNotificationDb()).all();
const remember = async (name: string, as = 'm1') => {
  await (
    await openNotificationDb()
  ).put({ groupId: groupIdSchema.parse('week-end'), token, title: 'Week-end', endpoint: endpoint(name), member: member(as) });
};

describe('notifications of a group', () => {
  it('subscribes this phone as who I am, sends a test, then stops and drops the subscription of the browser', async () => {
    const api = server();
    const { platform, state } = browser();
    show(api.client, platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByText('Notifications activées sur cet appareil.')).toBeDefined();
    expect(state.subscribedWith).toStrictEqual([publicKey]);
    expect(api.writes()).toStrictEqual([
      { method: 'PUT', url: subscriptionUrl, body: { member: 'm1', subscription: { endpoint: endpoint('phone'), keys } } },
    ]);
    expect(await saved()).toStrictEqual([{ groupId: 'week-end', token, title: 'Week-end', endpoint: endpoint('phone'), member: 'm1' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Essayer' }));
    expect(await screen.findByText("Notification d'essai envoyée : elle arrive en quelques secondes.")).toBeDefined();
    expect(api.writes().at(-1)).toStrictEqual({ method: 'POST', url: `${subscriptionUrl}/test`, body: { endpoint: endpoint('phone') } });

    const held = state.current;
    fireEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
    expect(await screen.findByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect(api.writes().at(-1)).toStrictEqual({ method: 'DELETE', url: subscriptionUrl, body: { endpoint: endpoint('phone') } });
    expect(await saved()).toStrictEqual([]);
    expect(held?.unsubscribed).toBe(true);
  });

  it('keeps the subscription of the browser while another group is subscribed, even under an older address of it', async () => {
    const api = server();
    const { platform, state } = browser({ current: subscription('phone'), permission: 'granted' });
    await remember('phone');
    await (
      await openNotificationDb()
    ).put({
      groupId: groupIdSchema.parse('other'),
      token: `other-token-${'x'.repeat(32)}`,
      title: 'Coloc',
      endpoint: endpoint('older'),
      member: member('m9'),
    });
    show(api.client, platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    expect(await screen.findByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect((await saved()).map((group) => group.groupId)).toStrictEqual(['other']);
    expect(state.current?.unsubscribed).toBe(false);
  });

  it('saves the subscription again at each opening, as who I am, and follows a change of member', async () => {
    const api = server();
    const { platform } = browser({ current: subscription('phone'), permission: 'granted' });
    await remember('phone');
    const { become } = show(api.client, platform);
    expect(await screen.findByText('Notifications activées sur cet appareil.')).toBeDefined();
    await waitFor(() => {
      expect(api.writes()).toHaveLength(1);
    });
    become('m2');
    await waitFor(async () => {
      expect((await saved())[0]?.member).toBe('m2');
    });
    expect(api.writes().map((call) => call.body)).toStrictEqual([
      { member: 'm1', subscription: { endpoint: endpoint('phone'), keys } },
      { member: 'm2', subscription: { endpoint: endpoint('phone'), keys } },
    ]);
  });

  it('renames the group kept on the phone, and saves again a subscription whose address changed', async () => {
    await remember('old');
    render(
      <ApiClientContext value={server().client}>
        <Notifications
          token={token}
          title="Coloc"
          member={member('m1')}
          platform={browser({ current: subscription('phone'), permission: 'granted' }).platform}
        />
      </ApiClientContext>,
    );
    await waitFor(async () => {
      expect(await saved()).toStrictEqual([{ groupId: 'week-end', token, title: 'Coloc', endpoint: endpoint('phone'), member: 'm1' }]);
    });
  });

  it('sends the subscriptions one at a time: a member chosen back reaches the server last, even after a slow answer', async () => {
    const slow = Promise.withResolvers<undefined>();
    const api = server({ hold: (as) => (as === 'm2' ? slow.promise : undefined) });
    await remember('phone');
    const { become } = show(api.client, browser({ current: subscription('phone'), permission: 'granted' }).platform);
    await waitFor(() => {
      expect(api.writes()).toHaveLength(1);
    });
    become('m2');
    await waitFor(() => {
      expect(api.writes()).toHaveLength(2);
    });
    become('m1');
    slow.resolve(undefined);
    await waitFor(async () => {
      expect(api.writes().map((call) => (call.body as { member: string }).member)).toStrictEqual(['m1', 'm2', 'm1']);
      expect((await saved())[0]?.member).toBe('m1');
    });
  });

  it('tells when the server could not take the subscription at opening, and stays on to try again at the next', async () => {
    await remember('phone');
    show(
      server({ refuse: { [`PUT ${subscriptionUrl}`]: ['too_many_subscriptions', 409] } }).client,
      browser({ current: subscription('phone'), permission: 'granted' }).platform,
    );
    expect(await screen.findByText("Le groupe a atteint le nombre maximal d'appareils abonnés.")).toBeDefined();
    expect(screen.getByText('Notifications activées sur cet appareil.')).toBeDefined();
    expect((await saved()).map((group) => group.groupId)).toStrictEqual(['week-end']);
  });

  it('forgets a subscription made with other keys, and replaces it when notifications are activated again', async () => {
    const api = server();
    const old = subscription('old', `B${'o'.repeat(86)}`);
    const { platform, state } = browser({ current: old, permission: 'granted' });
    await remember('old');
    show(api.client, platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByText('Notifications activées sur cet appareil.')).toBeDefined();
    expect(old.unsubscribed).toBe(true);
    expect(state.subscribedWith).toStrictEqual([publicKey]);
    expect((await saved())[0]?.endpoint).toBe(endpoint('phone'));
  });

  it('forgets a group whose subscription the browser dropped', async () => {
    await remember('phone');
    show(server().client, browser({ permission: 'granted' }).platform);
    expect(await screen.findByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect(await saved()).toStrictEqual([]);
  });

  it('tells when the browser blocks notifications, at the prompt or already, and offers them again after a dismissed prompt', async () => {
    show(server().client, browser({ answer: 'denied' }).platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByText(/Les notifications sont bloquées pour ce site/)).toBeDefined();
    cleanup();

    show(server().client, browser({ permission: 'denied' }).platform);
    expect(await screen.findByText(/Les notifications sont bloquées pour ce site/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Activer les notifications' })).toBeNull();
    cleanup();

    show(server().client, browser({ answer: 'default' }).platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Activer les notifications' }).hasAttribute('disabled')).toBe(false);
    });
  });

  it('tells why the server refused the subscription', async () => {
    show(server({ refuse: { [`PUT ${subscriptionUrl}`]: ['too_many_subscriptions', 409] } }).client, browser().platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByText("Le groupe a atteint le nombre maximal d'appareils abonnés.")).toBeDefined();
    expect(await saved()).toStrictEqual([]);
  });

  it('turns off when a test finds the phone no longer subscribed on the server', async () => {
    await remember('phone');
    show(
      server({ refuse: { [`POST ${subscriptionUrl}/test`]: ['subscription_not_found', 404] } }).client,
      browser({ current: subscription('phone'), permission: 'granted' }).platform,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Essayer' }));
    expect(await screen.findByText("Cet appareil n'est plus abonné : active à nouveau les notifications.")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect(await saved()).toStrictEqual([]);
  });

  it('shows nothing on an instance without notifications, nor in a browser without the Push API, and tells an iPhone to use the home screen', async () => {
    const disabled = server({ refuse: { 'GET /api/notifications/key': ['notifications_disabled', 404] } });
    const { container, unmount } = render(
      <ApiClientContext value={disabled.client}>
        <Notifications token={token} title="Week-end" member={member('m1')} platform={browser().platform} />
      </ApiClientContext>,
    );
    await waitFor(() => {
      expect(disabled.calls).toHaveLength(1);
    });
    expect(container.innerHTML).toBe('');
    unmount();

    const unsupported = server();
    const other = render(
      <ApiClientContext value={unsupported.client}>
        <Notifications token={token} title="Week-end" member={member('m1')} platform={browser({ support: 'unsupported' }).platform} />
      </ApiClientContext>,
    );
    expect(other.container.innerHTML).toBe('');
    expect(unsupported.calls).toStrictEqual([]);
    other.unmount();

    show(server().client, browser({ support: 'home_screen' }).platform);
    expect(await screen.findByText(/ajoute d'abord La Pince à l'écran d'accueil/)).toBeDefined();
  });
});
