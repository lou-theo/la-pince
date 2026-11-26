import { describe, expect, it } from 'vitest';

import {
  adminGroupSchema,
  groupResponseSchema,
  groupUpdateSchema,
  memberNameKey,
  memberUpdateSchema,
  newMemberSchema,
  photoChangeResponseSchema,
} from './group.ts';

const group = {
  title: 'Trip',
  members: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
  ],
};

describe('groupResponseSchema', () => {
  it('accepts a group with its title and its members', () => {
    expect(groupResponseSchema.parse(group)).toStrictEqual(group);
  });

  it.each([
    ['a group without members', { ...group, members: [] }],
    ['a member listed twice', { ...group, members: [...group.members, { id: 'alice', name: 'Alice again' }] }],
    ['a member without a name', { ...group, members: [{ id: 'alice', name: '' }] }],
    ['a name over 50 characters', { ...group, members: [{ id: 'alice', name: 'a'.repeat(51) }] }],
    ['a name with a lone surrogate', { ...group, members: [{ id: 'alice', name: 'Ali\uD800' }] }],
    ['an empty title', { ...group, title: '' }],
    ['a title over 100 characters', { ...group, title: 'a'.repeat(101) }],
  ])('rejects %s', (_, response) => {
    expect(groupResponseSchema.safeParse(response).success).toBe(false);
  });

  // Only what the app sends is trimmed and refused with a control character: a name stored by the import before still reads.
  it('accepts a name with spaces at its ends or a line break, as stored', () => {
    const stored = { title: ' Trip ', members: [{ id: 'alice', name: 'Alice\nB. ' }] };
    expect(groupResponseSchema.parse(stored)).toStrictEqual(stored);
  });

  // A newer server may send a field this version of the app does not know yet.
  it('drops a field it does not know, on the group or on a member', () => {
    const newer = { ...group, picture: 'x', members: group.members.map((member) => ({ ...member, picture: 'x' })) };
    expect(groupResponseSchema.parse(newer)).toStrictEqual(group);
  });

  it('keeps the photo of a member and the photos of the instance', () => {
    const withPhotos = { ...group, photos: true, members: [{ id: 'alice', name: 'Alice', photo: 'a'.repeat(22) }, group.members[1]] };
    expect(groupResponseSchema.parse(withPhotos)).toStrictEqual(withPhotos);
  });

  it.each([
    ['a photo that is not a version', { ...group, members: [{ id: 'alice', name: 'Alice', photo: 'x' }] }],
    ['photos set to false', { ...group, photos: false }],
  ])('rejects %s', (_, response) => {
    expect(groupResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('photoChangeResponseSchema', () => {
  const undo = { version: 'a'.repeat(22), previous: null };

  it('reads the group and the undo of the change, which may be absent', () => {
    expect(photoChangeResponseSchema.parse({ ...group, undo })).toStrictEqual({ ...group, undo });
    expect(photoChangeResponseSchema.parse(group)).toStrictEqual(group);
  });

  it('rejects an undo that puts back the version it undoes', () => {
    expect(photoChangeResponseSchema.safeParse({ ...group, undo: { ...undo, previous: undo.version } }).success).toBe(false);
  });
});

describe('adminGroupSchema', () => {
  const token = 'a'.repeat(32);

  it('accepts a title, a link token and the members', () => {
    expect(adminGroupSchema.parse({ ...group, token })).toStrictEqual({ ...group, token });
  });

  it.each([
    ['a token shorter than 32 characters', { ...group, token: 'a'.repeat(31) }],
    ['a token with a character a link would encode', { ...group, token: `${'a'.repeat(31)}/` }],
    ['a member listed twice', { ...group, token, members: [...group.members, { id: 'bob', name: 'Bob again' }] }],
    ['no token', group],
    ['an unknown field', { ...group, token, picture: 'x' }],
    ['an unknown field on a member', { ...group, token, members: [{ id: 'alice', name: 'Alice', picture: 'x' }] }],
    ['a photo on a member, which changes by its own routes', { ...group, token, members: [{ id: 'alice', name: 'Alice', photo: 'a'.repeat(22) }] }],
    ['photos', { ...group, token, photos: true }],
  ])('rejects %s', (_, request) => {
    expect(adminGroupSchema.safeParse(request).success).toBe(false);
  });
});

// What a person types in the app: spaces at both ends removed before the bounds are checked, a control character refused anywhere.
describe('groupUpdateSchema', () => {
  it('trims the title before judging it', () => {
    expect(groupUpdateSchema.parse({ title: `  ${'a'.repeat(100)}\n` })).toStrictEqual({ title: 'a'.repeat(100) });
  });

  it.each([
    ['a title of spaces only', { title: '   ' }],
    ['a title over 100 characters once trimmed', { title: ` ${'a'.repeat(101)} ` }],
    ['a line break inside the title', { title: 'Trip\nto the sea' }],
    ['a tab inside the title', { title: 'Trip\tto the sea' }],
    ['a lone surrogate', { title: 'Trip\uD800' }],
    ['an unknown field', { title: 'Trip', members: [] }],
  ])('rejects %s', (_, request) => {
    expect(groupUpdateSchema.safeParse(request).success).toBe(false);
  });
});

describe('newMemberSchema', () => {
  it('takes the id drawn by the phone and the trimmed name', () => {
    expect(newMemberSchema.parse({ id: 'm-42', name: ' Chloé ' })).toStrictEqual({ id: 'm-42', name: 'Chloé' });
  });

  // Built with a zero-width joiner, and with tag characters for the flag of a region.
  it.each(['Chloé 👩‍🍳', 'Chloé 🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'])(
    'keeps an emoji built from several characters: %s',
    (name) => {
      expect(newMemberSchema.parse({ id: 'm42', name }).name).toBe(name);
    },
  );

  it.each([
    ['no id', { name: 'Chloé' }],
    ['an id a link would encode', { id: 'm/42', name: 'Chloé' }],
    ['an empty name once trimmed', { id: 'm42', name: ' \t ' }],
    ['a name over 50 characters', { id: 'm42', name: 'a'.repeat(51) }],
    ['a control character', { id: 'm42', name: 'Chlo\u0000é' }],
    ['only characters a screen does not draw', { id: 'm42', name: '\u200B\u200D\u3164 ' }],
    ['an unknown field', { id: 'm42', name: 'Chloé', picture: 'x' }],
  ])('rejects %s', (_, request) => {
    expect(newMemberSchema.safeParse(request).success).toBe(false);
  });
});

describe('memberUpdateSchema', () => {
  it('takes a trimmed name', () => {
    expect(memberUpdateSchema.parse({ name: 'Basile ' })).toStrictEqual({ name: 'Basile' });
  });

  it.each([
    ['nothing to change', {}],
    ['an empty name', { name: '' }],
    ['a control character', { name: 'Ba\u007Fsile' }],
    ['an unknown field', { name: 'Basile', id: 'other' }],
  ])('rejects %s', (_, request) => {
    expect(memberUpdateSchema.safeParse(request).success).toBe(false);
  });
});

describe('memberNameKey', () => {
  it.each([
    ['the case', 'Élodie', 'éLODIE'],
    ['an accent typed as one character or as a letter and its mark', '\u00C9lodie', 'E\u0301lodie'],
    ['spaces at the ends', ' Paul\t', 'paul'],
    ['characters a screen does not draw', 'Pa\u200Bul\u200D\uFE0F', 'paul'],
  ])('leaves out %s', (_, a, b) => {
    expect(memberNameKey(a)).toBe(memberNameKey(b));
  });

  it.each([
    ['another letter', 'Paul', 'Pauline'],
    ['a space inside', 'Jean Paul', 'JeanPaul'],
    ['an accent', 'Élodie', 'Elodie'],
  ])('tells names apart by %s', (_, a, b) => {
    expect(memberNameKey(a)).not.toBe(memberNameKey(b));
  });
});
