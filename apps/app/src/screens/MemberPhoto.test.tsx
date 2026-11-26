import { type ApiError, groupResponseSchema } from '@la-pince/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../sync/client.ts';
import { change, fakeServer, json, photoVersionOf } from '../testing/fake-server.ts';
import { testGroup } from '../testing/group.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { memoryCache, stubPicture, syntheticJpeg } from '../testing/photo.ts';
import { renderApp } from '../testing/render.tsx';

const token = 'demo-token-of-the-photo-tests-0123456789';
const withPhotos = groupResponseSchema.parse({ ...testGroup, photos: true });
const picture = () => new File([new Uint8Array([1, 2, 3])], 'photo.heic', { type: 'image/heic' });
const jpegOf = (seed: number) => new Blob([syntheticJpeg(seed)], { type: 'image/jpeg' });
const photoInput = (inside: ParentNode = document) => {
  const input = inside.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('no input to choose a picture');
  }
  return input;
};
// The photo shown on the avatar of the sheet, or null for the initial.
const sheetPhoto = () => document.querySelector('main img');

/**
 * Opens the group as Bruno at a path, on a fake server that keeps photos (unless `group` says otherwise); `answer` replaces the server's answer to
 * a request. Records the photo routes asked, method and path.
 */
async function open(
  path: string,
  options: {
    group?: typeof withPhotos;
    answer?: (url: string, method: string) => Response | Promise<Response> | undefined;
    changes?: Parameters<typeof fakeServer>[0]['changes'];
  } = {},
) {
  const server = fakeServer({ token, group: options.group ?? withPhotos, ...(options.changes === undefined ? {} : { changes: options.changes }) });
  const asked: string[] = [];
  const fetchFn: Fetch = (url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/photo')) {
      asked.push(`${method} ${url.replace(`/api/groups/${token}`, '')}`);
    }
    const replaced = options.answer?.(url, method);
    return replaced === undefined ? server.fetch(url, init) : Promise.resolve(replaced);
  };
  await rememberMember(token, 'm2');
  renderApp(`/g/${token}${path}`, fetchFn);
  await screen.findByRole('heading', { level: 1, name: 'Week-end' });
  return { user: userEvent.setup(), server, asked };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the camera badge of a sheet', () => {
  it('is not offered on an instance that keeps no photos', async () => {
    await open('/membres/m1', { group: testGroup });
    expect(await screen.findByRole('heading', { level: 2, name: 'Alice' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Changer la photo de Alice' })).toBeNull();
  });

  it('is greyed offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await open('/membres/m1');
    expect((await screen.findByRole('button', { name: 'Changer la photo de Alice' })).hasAttribute('disabled')).toBe(true);
  });

  it('sets the photo chosen at once, said by a band whose “Annuler” puts the initial back', async () => {
    stubPicture();
    const { user, server, asked } = await open('/membres/m1');
    await user.click(await screen.findByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    expect(await screen.findByText('Photo de Alice changée')).toBeDefined();
    const version = await photoVersionOf(syntheticJpeg(1));
    expect(sheetPhoto()?.getAttribute('src')).toBe(`/api/groups/${token}/members/m1/photos/${version}`);
    expect(server.group().members[0]?.photo).toBe(version);

    await user.click(screen.getByRole('button', { name: 'Annuler ce changement de photo' }));
    await waitFor(() => {
      expect(screen.queryByText('Photo de Alice changée')).toBeNull();
    });
    expect(sheetPhoto()).toBeNull();
    expect(server.group().members[0]?.photo).toBeUndefined();
    expect(asked).toStrictEqual(['PUT /members/m1/photo', 'POST /members/m1/photo/undo']);
  });

  it('keeps the photo sent under its own version, even when the group answered already shows one another phone set since', async () => {
    stubPicture();
    const cache = memoryCache();
    vi.stubGlobal('caches', { open: () => Promise.resolve(cache) });
    // The photos the page loads into the cache after a read: none answered here.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
    const sent = await photoVersionOf(syntheticJpeg(1));
    const other = await photoVersionOf(syntheticJpeg(5));
    const { user } = await open('/membres/m1', {
      answer: (url, method) =>
        method === 'PUT'
          ? json({
              ...withPhotos,
              members: withPhotos.members.map((member) => (member.id === 'm1' ? { ...member, photo: other } : member)),
              undo: { version: sent, previous: null },
            })
          : undefined,
    });
    await user.click(await screen.findByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    await screen.findByText('Photo de Alice changée');
    expect(cache.urls().map((url) => url.split('/').at(-1))).toStrictEqual([sent]);
  });

  it('names my own photo as mine on my page', async () => {
    stubPicture();
    const { user } = await open('/moi');
    await user.click(await screen.findByRole('button', { name: 'Changer ta photo' }));
    await user.upload(photoInput(), picture());
    expect(await screen.findByText('Ta photo a changé')).toBeDefined();
  });

  it('offers, for a member with a photo, to choose another or to take it away, which “Annuler” brings back', async () => {
    const { user, server } = await open('/membres/m1');
    await server.fetch(`/api/groups/${token}/members/m1/photo`, { method: 'PUT', body: jpegOf(7) });
    // The next read brings the photo, set from another phone.
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(sheetPhoto()).not.toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Changer la photo de Alice' }));
    const menu = screen.getByRole('dialog', { name: 'Photo de Alice' });
    expect(within(menu).getByRole('button', { name: 'Choisir une photo' })).toBeDefined();
    await user.click(within(menu).getByRole('button', { name: 'Retirer la photo' }));
    expect(await screen.findByText('Photo de Alice retirée')).toBeDefined();
    expect(sheetPhoto()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Annuler ce changement de photo' }));
    await waitFor(() => {
      expect(sheetPhoto()).not.toBeNull();
    });
    expect(server.group().members[0]?.photo).toBe(await photoVersionOf(syntheticJpeg(7)));
  });

  it('undoes to the photo the server names, set by another phone before this one read it, never to what this phone had read', async () => {
    stubPicture();
    const { user, server } = await open('/membres/m1');
    await screen.findByRole('heading', { level: 2, name: 'Alice' });
    // Set from another phone, the app not reading again: it still shows the initial.
    await server.fetch(`/api/groups/${token}/members/m1/photo`, { method: 'PUT', body: jpegOf(6) });
    await user.click(screen.getByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    await screen.findByText('Photo de Alice changée');

    await user.click(screen.getByRole('button', { name: 'Annuler ce changement de photo' }));
    await waitFor(() => {
      expect(screen.queryByText('Photo de Alice changée')).toBeNull();
    });
    expect(server.group().members[0]?.photo).toBe(await photoVersionOf(syntheticJpeg(6)));
  });

  it('still says how a photo sent before a payment ended, its answer coming after the payment', async () => {
    stubPicture();
    let answer: (response: Response) => void = () => undefined;
    // Chloé owes Alice 15,00 € for her share of an expense Alice paid.
    const shopping = change({ id: 'op-shopping', date: '2026-11-05', title: 'Courses', payer: 'm1', lines: [['m3', 1_500]] });
    const { user } = await open('/membres/m1', {
      changes: [shopping],
      answer: (url, method) =>
        method === 'PUT'
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : undefined,
    });
    await user.click(await screen.findByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    await user.click(await screen.findByRole('button', { name: /^C'est payé : Chloé doit/ }));
    expect(await screen.findByText('Remboursement enregistré')).toBeDefined();

    answer(json({ error: 'photos_unavailable' } satisfies ApiError, 503));
    expect(await screen.findByText('Photo non enregistrée, réessaie plus tard.')).toBeDefined();
  });

  it('never undoes a photo another phone changed since, and says so', async () => {
    stubPicture();
    const { user, server } = await open('/membres/m1');
    await user.click(await screen.findByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    await screen.findByText('Photo de Alice changée');
    await server.fetch(`/api/groups/${token}/members/m1/photo`, { method: 'PUT', body: jpegOf(8) });

    await user.click(screen.getByRole('button', { name: 'Annuler ce changement de photo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('La photo a été changée entre-temps.');
    expect(server.group().members[0]?.photo).toBe(await photoVersionOf(syntheticJpeg(8)));
    // Read again: the sheet shows the photo the other phone set.
    await waitFor(() => {
      expect(sheetPhoto()?.getAttribute('src')).toContain(server.group().members[0]?.photo ?? 'none');
    });
  });

  it('says why a picture could not be read or a photo was not kept, nothing being changed', async () => {
    stubPicture({ decodes: false });
    const { user, asked } = await open('/membres/m1', {
      answer: (url, method) => (method === 'PUT' ? json({ error: 'photos_unavailable' } satisfies ApiError, 503) : undefined),
    });
    await user.click(await screen.findByRole('button', { name: 'Changer la photo de Alice' }));
    await user.upload(photoInput(), picture());
    expect((await screen.findByRole('alert')).textContent).toBe('Format non pris en charge, choisis une autre photo.');
    expect(asked).toStrictEqual([]);

    vi.restoreAllMocks();
    stubPicture();
    await user.upload(photoInput(), picture());
    expect(await screen.findByText('Photo non enregistrée, réessaie plus tard.')).toBeDefined();
    expect(sheetPhoto()).toBeNull();
  });
});

describe('the avatar', () => {
  it('shows the initial when the photo fails to load, and tries it again after a later read', async () => {
    const { server } = await open('/membres/m1');
    await server.fetch(`/api/groups/${token}/members/m1/photo`, { method: 'PUT', body: jpegOf(9) });
    window.dispatchEvent(new Event('online'));
    const photo = await waitFor(() => {
      const shown = sheetPhoto();
      expect(shown).not.toBeNull();
      return shown;
    });
    if (photo === null) {
      return;
    }
    fireEvent.error(photo);
    await waitFor(() => {
      expect(sheetPhoto()).toBeNull();
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Alice' })).toBeDefined();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(sheetPhoto()).not.toBeNull();
    });
  });
});

describe('the sheet to add a member', () => {
  it('takes a photo, optional, sent once the member is added', async () => {
    stubPicture();
    const { user, server, asked } = await open('/moi/groupe');
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    expect(within(sheet).getByText('Photo facultative. Son solde part de zéro.')).toBeDefined();
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter une photo (facultatif)' }));
    await user.upload(photoInput(sheet), picture());
    expect(await within(sheet).findByRole('button', { name: 'Changer la photo choisie' })).toBeDefined();
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }));

    await waitFor(() => {
      expect(server.group().members.at(-1)?.name).toBe('Zoé');
    });
    const zoe = server.group().members.at(-1);
    expect(zoe?.photo).toBe(await photoVersionOf(syntheticJpeg(1)));
    expect(asked).toStrictEqual([`PUT /members/${zoe?.id ?? ''}/photo`]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the member added when the photo fails, and says to try again from their sheet', async () => {
    stubPicture();
    const { user, server } = await open('/moi/groupe', {
      answer: (url, method) => (method === 'PUT' ? json({ error: 'photos_unavailable' } satisfies ApiError, 503) : undefined),
    });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    await user.upload(photoInput(sheet), picture());
    await within(sheet).findByRole('button', { name: 'Changer la photo choisie' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Membre ajouté, photo non envoyée : Photo non enregistrée, réessaie plus tard. Réessaie depuis sa fiche.',
    );
    expect(server.group().members.at(-1)?.name).toBe('Zoé');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says the photo failed even when the sheet was closed while it was on its way', async () => {
    stubPicture();
    let answer: (response: Response) => void = () => undefined;
    const { user, server } = await open('/moi/groupe', {
      answer: (url, method) =>
        method === 'PUT'
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : undefined,
    });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    await user.upload(photoInput(sheet), picture());
    await within(sheet).findByRole('button', { name: 'Changer la photo choisie' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé');
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }));
    await waitFor(() => {
      expect(server.group().members.at(-1)?.name).toBe('Zoé');
    });
    await user.click(within(sheet).getByRole('button', { name: 'Fermer' }));

    answer(json({ error: 'photos_unavailable' } satisfies ApiError, 503));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Membre ajouté, photo non envoyée : Photo non enregistrée, réessaie plus tard. Réessaie depuis sa fiche.',
    );
  });

  it('offers no photo on an instance that keeps none', async () => {
    const { user } = await open('/moi/groupe', { group: testGroup });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    expect(within(sheet).queryByRole('button', { name: 'Ajouter une photo (facultatif)' })).toBeNull();
    expect(within(sheet).getByText('Son solde part de zéro.')).toBeDefined();
  });
});
