import type { Member, MemberId } from '@la-pince/core';

/** Number of avatar colors in the palette of `global.css` (`--avatar-0` and on), who I am taking the accent instead. */
export const AVATAR_TONES = 12;

const segmenter = new Intl.Segmenter('fr-FR');

/** Avatar of a member: the initial of their name, and a color that stays theirs on every screen, the accent for who I am. */
export function avatarOf(member: Member, members: readonly Member[], me: MemberId): { readonly initial: string; readonly tone: 'me' | number } {
  // The first character as a reader sees it, an accented letter written in two code points included.
  const [first] = segmenter.segment(member.name.trim());
  const initial = first?.segment.toLocaleUpperCase('fr-FR') ?? '?';
  if (member.id === me) {
    return { initial, tone: 'me' };
  }
  // By the order of addition, stable as long as the group lives; a member missing from the list takes the last color.
  const position = members.findIndex((candidate) => candidate.id === member.id);
  return { initial, tone: (position === -1 ? members.length : position) % AVATAR_TONES };
}
