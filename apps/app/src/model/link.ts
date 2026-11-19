import { groupTokenSchema } from '@la-pince/core';

/**
 * Token of a group link pasted by hand: a whole link (`…/g/<token>`, with or without the site, query or fragment) or the token alone; undefined
 * when the text holds none.
 */
export function tokenFromLink(text: string): string | undefined {
  const trimmed = text.trim();
  const start = trimmed.lastIndexOf('/g/');
  const candidate = start === -1 ? trimmed : trimmed.slice(start + '/g/'.length).replace(/[/?#].*$/s, '');
  const token = groupTokenSchema.safeParse(candidate);
  return token.success ? token.data : undefined;
}

/** Link of a group on this site, the one its members share; the token is already checked by the route. */
export function groupLink(origin: string, token: string): string {
  return `${origin}/g/${token}`;
}
