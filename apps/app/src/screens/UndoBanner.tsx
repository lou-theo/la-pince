import type { ReactNode } from 'react';

import { queueErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { formatCents } from '../model/money.ts';
import type { PaidTransfer } from '../model/settle.ts';
import { Band, BandDetail, BandTitle } from './Band.tsx';
import type { Settle } from './useSettle.ts';
import { type GroupView, shortName } from './view.ts';

/** “Payé” transfer in a few words: who paid whom, and how much. */
export function paidText(view: GroupView, { transfer }: PaidTransfer): string {
  return m.undo_detail({ from: shortName(view, transfer.from), to: shortName(view, transfer.to), amount: formatCents(transfer.amount) });
}

/**
 * The band after “C'est payé”: the reimbursement recorded and “Annuler”, for `BAND_DURATION`, until the screen is left, or until another transfer is paid.
 * `nav`: the screen has the menu at the bottom.
 */
export function UndoBanner({ view, settle, nav }: { readonly view: GroupView; readonly settle: Settle; readonly nav: boolean }): ReactNode {
  const { band } = settle;
  // Its reimbursement gone (deleted elsewhere, or refused by the server), there is nothing left to undo.
  if (band === undefined || (band.kind === 'saved' && !settle.live.has(band.paid.operation.id))) {
    return null;
  }
  if (band.kind === 'failed') {
    return (
      <Band nav={nav} alert>
        {band.error === 'too_large' ? m.form_error_too_large() : queueErrorMessage(band.error)}
      </Band>
    );
  }
  return (
    <Band
      nav={nav}
      action={{
        text: settle.busy === 'undo' ? m.undo_cancelling() : m.undo_button(),
        label: m.undo_label(),
        disabled: settle.busy !== undefined,
        onClick: () => {
          settle.undo(band.paid);
        },
      }}
    >
      <BandTitle>{m.undo_saved()}</BandTitle>
      <BandDetail>{paidText(view, band.paid)}</BandDetail>
      {band.error === undefined ? undefined : <BandDetail alert>{queueErrorMessage(band.error)}</BandDetail>}
    </Band>
  );
}
