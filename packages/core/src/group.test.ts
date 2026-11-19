import { describe, expect, it } from 'vitest';

import { groupResponseSchema } from './group.ts';

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
    ['an empty title', { ...group, title: '' }],
    ['a title over 100 characters', { ...group, title: 'a'.repeat(101) }],
    ['an unknown field', { ...group, token: 'secret' }],
  ])('rejects %s', (_, response) => {
    expect(groupResponseSchema.safeParse(response).success).toBe(false);
  });
});
