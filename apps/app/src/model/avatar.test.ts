import { memberSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { AVATAR_TONES, avatarOf } from './avatar.ts';

const members = Array.from({ length: AVATAR_TONES + 2 }, (_, index) =>
  memberSchema.parse({ id: `m${String(index)}`, name: `membre ${String(index)}` }),
);

describe('avatarOf', () => {
  it('gives the capitalized initial, accents kept, and the accent to who I am', () => {
    const [first, second] = members;
    if (first === undefined || second === undefined) {
      throw new Error('members');
    }
    expect(avatarOf(memberSchema.parse({ id: 'x', name: ' élodie' }), members, first.id)).toStrictEqual({
      initial: 'É',
      tone: members.length % AVATAR_TONES,
    });
    expect(avatarOf(first, members, first.id)).toStrictEqual({ initial: 'M', tone: 'me' });
    expect(avatarOf(second, members, first.id)).toStrictEqual({ initial: 'M', tone: 1 });
    // A blank name, which the server refuses, still gets a mark.
    expect(avatarOf({ ...second, name: '  ' }, members, first.id).initial).toBe('?');
  });

  it('gives each member the color of their place in the group, the palette starting over once used up', () => {
    const me = memberSchema.parse({ id: 'me', name: 'Moi' }).id;
    expect(members.map((member) => avatarOf(member, members, me).tone)).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1]);
  });
});
