import { describe, expect, it } from 'vitest';

import { adminGroupSchema, groupResponseSchema } from './group.ts';

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
    ['an unknown field', { ...group, token: 'secret' }],
  ])('rejects %s', (_, response) => {
    expect(groupResponseSchema.safeParse(response).success).toBe(false);
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
  ])('rejects %s', (_, request) => {
    expect(adminGroupSchema.safeParse(request).success).toBe(false);
  });
});
