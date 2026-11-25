import { type ApiError, groupResponseSchema, MAX_GROUP_MEMBERS, newMemberSchema } from '@la-pince/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../sync/client.ts';
import { fakeServer, json } from '../testing/fake-server.ts';
import { testGroup } from '../testing/group.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { renderApp } from '../testing/render.tsx';

const token = 'demo-token-of-the-my-page-tests-01234567';
const at = (location: { history: readonly string[] }) => location.history.at(-1)?.replace(`/g/${token}`, '');

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/**
 * Opens the group as Bruno at a path, on a fake server that edits the group as the real one does; records the edits sent. `fail` makes the edits it
 * picks fail for want of network, `answer` replaces the server's answer to an edit, `hold` keeps the edits waiting until it settles, `lose` loses
 * the answer to the edits it picks once the server made them.
 */
async function open(
  path: string,
  options: {
    fail?: (sent: Sent) => boolean;
    answer?: (sent: Sent) => Response | undefined;
    hold?: Promise<void>;
    lose?: (sent: Sent) => boolean;
    group?: typeof testGroup;
  } = {},
) {
  const server = fakeServer({ token, group: options.group ?? testGroup });
  const edits: Sent[] = [];
  const fetchFn: Fetch = (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'PATCH' || (method === 'POST' && url.endsWith('/members'))) {
      const sent = {
        method,
        url: url.replace(`/api/groups/${token}`, ''),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
      };
      edits.push(sent);
      if (options.fail?.(sent) === true) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const replaced = options.answer?.(sent);
      if (replaced !== undefined) {
        return Promise.resolve(replaced);
      }
      if (options.lose?.(sent) === true) {
        return server.fetch(url, init).then(() => Promise.reject(new TypeError('Failed to fetch')));
      }
      if (options.hold !== undefined) {
        return options.hold.then(() => server.fetch(url, init));
      }
    }
    return server.fetch(url, init);
  };
  await rememberMember(token, 'm2');
  const location = renderApp(`/g/${token}${path}`, fetchFn);
  await screen.findByRole('heading', { level: 1, name: 'Week-end' });
  return { user: userEvent.setup(), location, edits };
}

const memberLines = () =>
  within(screen.getByRole('region', { name: /membres?$/ }))
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('my page', () => {
  it('opens on “Toi”, my sheet in my words, then this phone; “Le groupe” lists the members, each opening their sheet', async () => {
    const { user, location } = await open('/moi');
    const tabs = within(screen.getByRole('navigation', { name: 'Ta page' }));
    expect(tabs.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('aria-current')])).toStrictEqual([
      ['Toi', 'page'],
      ['Le groupe', null],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Bruno' })).toBeDefined();
    expect(screen.getByText('À jour')).toBeDefined();
    expect(screen.getByText('Rien à rembourser : tu es à jour avec tout le monde.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?de=m2&retour=%2Fmoi`,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Sur ce téléphone' }).closest('[hidden]')).toBeNull();

    await user.click(tabs.getByRole('link', { name: 'Le groupe' }));
    expect(at(location)).toBe('/moi/groupe');
    expect(screen.getByRole('link', { name: 'Le groupe', current: 'page' })).toBeDefined();
    // This phone stays mounted for the notifications, hidden off “Toi”.
    expect(screen.getByRole('heading', { level: 2, name: 'Sur ce téléphone', hidden: true }).closest('[hidden]')).not.toBeNull();
    expect(screen.getByText('Week-end', { selector: 'span' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '3 membres' })).toBeDefined();
    expect(memberLines()).toStrictEqual(['Alice', 'Bruno (toi)', 'Chloé']);
    expect(within(screen.getByRole('link', { name: 'Bruno (toi)' })).getByText('toi')).toBeDefined();

    // A member's sheet from the group, back to the group; the reimbursement page from it comes back to the sheet, still leading to the group.
    await user.click(screen.getByRole('link', { name: 'Alice' }));
    expect(at(location)).toBe('/membres/m1?retour=%2Fmoi%2Fgroupe');
    expect(screen.queryByRole('navigation', { name: 'Sections du groupe' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Déclarer un remboursement' }));
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(at(location)).toBe('/membres/m1?retour=%2Fmoi%2Fgroupe');
    await user.click(screen.getByRole('link', { name: 'Retour au groupe' }));
    expect(at(location)).toBe('/moi/groupe');
    await user.click(screen.getByRole('link', { name: 'Retour aux dépenses' }));
    expect(at(location)).toBe('/');
  });

  it('opens a sheet from the transfers back to them, and any other way back to the balances', async () => {
    const { user, location } = await open('/membres/m1?retour=%2Fsoldes%2Fvirements');
    await user.click(screen.getByRole('link', { name: 'Retour aux remboursements suggérés' }));
    expect(at(location)).toBe('/soldes/virements');
    cleanup();
    await open('/membres/m1?retour=%2F%2Fevil.example');
    expect(screen.getByRole('link', { name: 'Retour aux soldes' }).getAttribute('href')).toBe(`/g/${token}/soldes`);
  });
});

describe('renaming in place', () => {
  it('renames a member by the keyboard: Enter sends, Escape gives up, an unchanged name sends nothing, the pencil gets the focus back', async () => {
    const { user, edits } = await open('/membres/m1?retour=%2Fsoldes');
    const pencil = screen.getByRole('button', { name: 'Renommer Alice' });
    await user.click(pencil);
    const field = screen.getByRole('textbox', { name: 'Prénom' });
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('maxlength')).toBe('50');
    await user.clear(field);
    await user.type(field, 'Alicia{Escape}');
    expect(screen.getByRole('heading', { level: 2, name: 'Alice' })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Renommer Alice' }));

    // Leaving the field keeps it open; the same name, spaces around, closes it without a request.
    await user.click(screen.getByRole('button', { name: 'Renommer Alice' }));
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), ' ');
    await user.click(document.body);
    expect(screen.getByRole('textbox', { name: 'Prénom' })).toBeDefined();
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), '{Enter}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(edits).toStrictEqual([]);

    await user.click(screen.getByRole('button', { name: 'Renommer Alice' }));
    await user.clear(screen.getByRole('textbox', { name: 'Prénom' }));
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), ' Alicia {Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Alicia' })).toBeDefined();
    expect(edits).toStrictEqual([{ method: 'PATCH', url: '/members/m1', body: { name: 'Alicia' } }]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Renommer Alicia' }));
  });

  it('renames by the buttons, the check greyed for a name another member has, which the server refuses too', async () => {
    const { user, edits } = await open('/membres/m1?retour=%2Fsoldes', {
      // Taken on the server meanwhile, which this phone does not know yet.
      answer: (sent) => (JSON.stringify(sent.body) === '{"name":"Zoé"}' ? json({ error: 'member_name_taken' } satisfies ApiError, 409) : undefined),
    });
    await user.click(screen.getByRole('button', { name: 'Renommer Alice' }));
    const field = screen.getByRole('textbox', { name: 'Prénom' });
    await user.clear(field);
    await user.type(field, 'chloé');
    expect(screen.getByRole('button', { name: 'Valider' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Un autre membre du groupe porte déjà ce prénom.');
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect(edits).toStrictEqual([]);

    await user.clear(field);
    await user.type(field, 'Zoé');
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Un autre membre du groupe porte déjà ce prénom.');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Prénom' }).value).toBe('Zoé');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Alice' })).toBeDefined();
  });

  it('keeps what was typed when the network fails, to try again', async () => {
    let down = true;
    const { user, edits } = await open('/moi/groupe', { fail: () => down });
    await user.click(screen.getByRole('button', { name: 'Renommer le groupe' }));
    const field = screen.getByRole('textbox', { name: 'Nom du groupe' });
    expect(field.getAttribute('maxlength')).toBe('100');
    await user.clear(field);
    await user.type(field, 'Vacances{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    down = false;
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Vacances' })).toBeDefined();
    expect(edits.map((sent) => sent.body)).toStrictEqual([{ title: 'Vacances' }, { title: 'Vacances' }]);
  });

  it('keeps the field open while the new name is on its way: Escape and the cross would look like cancelling it', async () => {
    let release = () => undefined as void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = await open('/moi/groupe', { hold });
    await user.click(screen.getByRole('link', { name: 'Alice' }));
    await user.click(screen.getByRole('button', { name: 'Renommer Alice' }));
    const field = screen.getByRole('textbox', { name: 'Prénom' });
    await user.clear(field);
    await user.type(field, 'Alicia{Enter}');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('textbox', { name: 'Prénom' })).toBe(field);
    release();
    expect(await screen.findByRole('heading', { level: 2, name: 'Alicia' })).toBeDefined();
    expect(screen.queryByRole('textbox', { name: 'Prénom' })).toBeNull();
  });

  it('renames who I am from my tab, the band of the group saying it at once', async () => {
    const { user } = await open('/moi');
    await user.click(screen.getByRole('button', { name: 'Changer ton prénom' }));
    await user.clear(screen.getByRole('textbox', { name: 'Prénom' }));
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), 'Bruno-Paul{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Bruno-Paul' })).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Retour aux dépenses' }));
    expect(screen.getByRole('link', { name: 'Tu es Bruno-Paul' })).toBeDefined();
  });
});

describe('adding a member', () => {
  it('opens a sheet on the first name, sends the same id again after a failure, closes once added, and draws a new id next time', async () => {
    let down = true;
    const { user, edits } = await open('/moi/groupe', { fail: () => down });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    expect(sheet.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(within(sheet).getByRole('textbox', { name: 'Prénom' }));
    expect(within(sheet).getByText('Son solde part de zéro.')).toBeDefined();
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé{Enter}');
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    down = false;
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }));
    await waitFor(() => {
      expect(sheet.hasAttribute('open')).toBe(false);
    });
    expect(memberLines()).toStrictEqual(['Alice', 'Bruno (toi)', 'Chloé', 'Zoé']);
    expect(screen.getByRole('heading', { level: 2, name: '4 membres' })).toBeDefined();
    const [first, second] = edits.map((sent) => newMemberSchema.parse(sent.body));
    expect(second).toStrictEqual(first);
    expect(first?.name).toBe('Zoé');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ajouter un membre' }));

    // Escape, the backdrop and the cross close without asking.
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Prénom' }).value).toBe('');
    await user.keyboard('{Escape}');
    expect(sheet.hasAttribute('open')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    await user.click(sheet);
    expect(sheet.hasAttribute('open')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Yann');
    await user.click(within(sheet).getByRole('button', { name: 'Fermer' }));
    expect(sheet.hasAttribute('open')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Yann{Enter}');
    await waitFor(() => {
      expect(memberLines()).toHaveLength(5);
    });
    const third = newMemberSchema.parse(edits.at(-1)?.body);
    expect(third.id).not.toBe(first?.id);
  });

  it('leaves alone a sheet opened again while the answer for the one closed is on its way', async () => {
    let release = () => undefined as void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = await open('/moi/groupe', { hold });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé{Enter}');
    await user.click(within(sheet).getByRole('button', { name: 'Fermer' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Yann');
    release();
    await waitFor(() => {
      expect(memberLines()).toContain('Zoé');
    });
    expect(sheet.hasAttribute('open')).toBe(true);
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Prénom' }).value).toBe('Yann');
    expect(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('reads the group again when the answer to an addition is lost, the member it made showing at once', async () => {
    const { user } = await open('/moi/groupe', { lose: () => true });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé{Enter}');
    expect(await within(sheet).findByRole('alert')).toBeDefined();
    await waitFor(() => {
      expect(memberLines()).toContain('Zoé');
    });
  });

  it('stays open on a text selection released over the backdrop, and says why it cannot add once the network is gone', async () => {
    const { user } = await open('/moi/groupe');
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    const field = within(sheet).getByRole('textbox', { name: 'Prénom' });
    await user.type(field, 'Zoé');
    fireEvent.pointerDown(field);
    fireEvent.click(sheet);
    expect(sheet.hasAttribute('open')).toBe(true);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    const why = await within(sheet).findByRole('status');
    expect(why.textContent).toMatch(/^Pas de réseau\./);
    expect(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }).getAttribute('aria-describedby')).toBe(why.id);
  });

  it('greys a name already taken and tells a full group', async () => {
    const full = groupResponseSchema.parse({
      title: 'Week-end',
      members: Array.from({ length: MAX_GROUP_MEMBERS }, (_, index) => ({ id: `m${String(index + 1)}`, name: `Membre ${String(index + 1)}` })),
    });
    const { user, edits } = await open('/moi/groupe', { group: full });
    await user.click(screen.getByRole('button', { name: 'Ajouter un membre' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau membre' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'membre 7');
    expect(within(sheet).getByRole('button', { name: 'Ajouter au groupe' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).getByRole('alert').textContent).toBe('Un autre membre du groupe porte déjà ce prénom.');
    await user.clear(within(sheet).getByRole('textbox', { name: 'Prénom' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Prénom' }), 'Zoé{Enter}');
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Le groupe a atteint son nombre maximal de membres.');
    expect(edits).toHaveLength(1);
  });
});

describe('without network', () => {
  it('greys every edit and says why, when the browser is offline or a read failed for want of network', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { user } = await open('/moi/groupe');
    const offline = /^Pas de réseau\. Les changements de prénom/;
    expect(screen.getByText(offline)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Renommer le groupe' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ajouter un membre' }).disabled).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Alice' }));
    expect(screen.getByText(offline)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Renommer Alice' }).disabled).toBe(true);

    // Back online, as the browser says.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Renommer Alice' }).disabled).toBe(false);
    });
    expect(screen.queryByText(offline)).toBeNull();
    cleanup();

    // The copy kept on this phone, opened while the server does not answer, the browser saying it is online.
    renderApp(`/g/${token}/moi/groupe`, () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await screen.findByText(offline)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ajouter un membre' }).disabled).toBe(true);
  });
});
