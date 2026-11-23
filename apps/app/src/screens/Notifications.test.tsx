import { type ApiError, groupIdSchema, memberIdSchema } from '@la-pince/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function subscription(name: string): FakeSubscription {
  const fake = {
    endpoint: endpoint(name),
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

/** The server of the notification routes; `refuse` answers an error to a method and path instead. */
function server({ refuse = {} }: { refuse?: Record<string, [ApiError['error'], number]> } = {}) {
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
      return Promise.resolve(json({ groupId: 'week-end' }));
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

  it('keeps the subscription of the browser when another group still uses it', async () => {
    const api = server();
    const { platform, state } = browser({ current: subscription('phone'), permission: 'granted' });
    await remember('phone');
    await (
      await openNotificationDb()
    ).put({
      groupId: groupIdSchema.parse('other'),
      token: `other-token-${'x'.repeat(32)}`,
      title: 'Coloc',
      endpoint: endpoint('phone'),
      member: member('m9'),
    });
    show(api.client, platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    expect(await screen.findByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect((await saved()).map((group) => group.groupId)).toStrictEqual(['other']);
    expect(state.current?.unsubscribed).toBe(false);
  });

  it('follows who I am: the subscription moves to the new member', async () => {
    const api = server();
    const { platform } = browser({ current: subscription('phone'), permission: 'granted' });
    await remember('phone');
    const { become } = show(api.client, platform);
    expect(await screen.findByText('Notifications activées sur cet appareil.')).toBeDefined();
    expect(api.writes()).toStrictEqual([]);
    become('m2');
    await waitFor(async () => {
      expect((await saved())[0]?.member).toBe('m2');
    });
    expect(api.writes()).toStrictEqual([
      { method: 'PUT', url: subscriptionUrl, body: { member: 'm2', subscription: { endpoint: endpoint('phone'), keys } } },
    ]);
  });

  it('saves again a subscription whose address changed', async () => {
    const changed = server();
    await remember('old');
    show(changed.client, browser({ current: subscription('phone'), permission: 'granted' }).platform);
    await waitFor(async () => {
      expect((await saved())[0]?.endpoint).toBe(endpoint('phone'));
    });
    expect(changed.writes().map((call) => call.method)).toStrictEqual(['PUT']);
  });

  it('forgets a group whose subscription the browser dropped', async () => {
    await remember('phone');
    show(server().client, browser({ permission: 'granted' }).platform);
    expect(await screen.findByRole('button', { name: 'Activer les notifications' })).toBeDefined();
    expect(await saved()).toStrictEqual([]);
  });

  it('tells when the browser blocks notifications', async () => {
    show(server().client, browser({ answer: 'denied' }).platform);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer les notifications' }));
    expect(await screen.findByText(/Les notifications sont bloquées pour ce site/)).toBeDefined();
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
