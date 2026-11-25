import { type MemberId, memberIdSchema } from '@la-pince/core';

// The screens a member's sheet opens from: the balances, the transfers, and the two tabs of my page.
const SHEET_BACKS: readonly string[] = ['/soldes', '/soldes/virements', '/moi', '/moi/groupe'];
const DEFAULT_BACK = '/soldes';

/** Link to a member's sheet, whose arrow leads back to `back`; an identifier needs no escaping (`memberIdSchema`). */
export function sheetHref(id: MemberId, back: string): string {
  return `/membres/${id}?${new URLSearchParams({ retour: back }).toString()}`;
}

/**
 * Where the way back of a screen leads, read from its `?retour=`: for a member's sheet, one of the screens it opens from; for the reimbursement page,
 * also a sheet, itself with its way back. Anything else (another site, a path outside the group's screens) leads to the balances, and a sheet's link
 * is rebuilt rather than taken as given.
 */
export function backOf(screen: 'sheet' | 'reimbursement', retour: string | null): string {
  if (retour === null) {
    return DEFAULT_BACK;
  }
  if (SHEET_BACKS.includes(retour)) {
    return retour;
  }
  const sheet = screen === 'reimbursement' ? /^\/membres\/([^/?#]+)(?:\?([^#]*))?$/.exec(retour) : null;
  const id = memberIdSchema.safeParse(sheet?.[1]);
  if (sheet === null || !id.success) {
    return DEFAULT_BACK;
  }
  return sheetHref(id.data, backOf('sheet', new URLSearchParams(sheet[2] ?? '').get('retour')));
}
