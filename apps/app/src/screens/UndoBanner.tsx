import type { ReactNode } from 'react';

import { queueErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { formatCents } from '../model/money.ts';
import type { PaidTransfer } from '../model/settle.ts';
import styles from './UndoBanner.module.css';
import type { Settle } from './useSettle.ts';
import { type GroupView, shortName } from './view.ts';

/** “Payé” transfer in a few words: who paid whom, and how much. */
export function paidText(view: GroupView, { transfer }: PaidTransfer): string {
  return m.undo_detail({ from: shortName(view, transfer.from), to: shortName(view, transfer.to), amount: formatCents(transfer.amount) });
}

/**
 * The band above the menu after “C'est payé”: the reimbursement recorded and “Annuler”, until the screen is left or another transfer is paid. It
 * follows the screen in the flow, sticking above the menu: at the end of the screen it sits below the last line and the line of the last sync.
 */
export function UndoBanner({ view, settle }: { readonly view: GroupView; readonly settle: Settle }): ReactNode {
  const { band } = settle;
  // Its reimbursement gone (deleted elsewhere, or refused by the server), there is nothing left to undo.
  if (band === undefined || (band.kind === 'saved' && !settle.live.has(band.paid.operation.id))) {
    return null;
  }
  if (band.kind === 'failed') {
    return (
      <div className={styles.band} role="alert">
        <p className={styles.text}>{band.error === 'too_large' ? m.form_error_too_large() : queueErrorMessage(band.error)}</p>
      </div>
    );
  }
  return (
    <div className={styles.band} role="status">
      <p className={styles.text}>
        <strong className={styles.title}>{m.undo_saved()}</strong>
        <span className={styles.detail}>{paidText(view, band.paid)}</span>
        {band.error === undefined ? undefined : (
          <span className={styles.detail} role="alert">
            {queueErrorMessage(band.error)}
          </span>
        )}
      </p>
      <button
        className={styles.undo}
        type="button"
        aria-label={m.undo_label()}
        disabled={settle.busy !== undefined}
        onClick={() => {
          settle.undo(band.paid);
        }}
      >
        {settle.busy === 'undo' ? m.undo_cancelling() : m.undo_button()}
      </button>
    </div>
  );
}
