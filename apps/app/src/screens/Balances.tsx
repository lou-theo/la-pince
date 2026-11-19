import { type ReactNode, useId, useMemo } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { transfers } from '../model/group.ts';
import { formatCents } from '../model/money.ts';
import layout from './Layout.module.css';
import styles from './Operations.module.css';
import type { GroupView } from './view.ts';

/** Balance of every member, the largest first, then the transfers that would settle the group. */
export function Balances({ view }: { readonly view: GroupView }): ReactNode {
  const balancesTitle = useId();
  const transfersTitle = useId();
  const suggested = useMemo(() => transfers(view.balances), [view.balances]);
  return (
    <>
      <section className={styles.detailSection} aria-labelledby={balancesTitle}>
        <h2 id={balancesTitle} className={styles.sectionTitle}>
          {m.balances_title()}
        </h2>
        <p className={layout.muted}>{m.balances_explanation()}</p>
        <ul className={styles.lines}>
          {view.balances.map(({ member, balance }) => (
            <li key={member.id} className={member.id === view.me ? styles.mine : undefined}>
              <span>{view.nameOf(member.id)}</span>
              <span className={balance > 0 ? styles.positive : balance < 0 ? styles.negative : undefined}>
                {formatCents(balance, { signed: true })}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.detailSection} aria-labelledby={transfersTitle}>
        <h2 id={transfersTitle} className={styles.sectionTitle}>
          {m.transfers_title()}
        </h2>
        {suggested.length === 0 ? (
          <p className={layout.muted}>{m.transfers_none()}</p>
        ) : (
          <ul className={styles.transfers}>
            {suggested.map((transfer) => (
              <li key={`${transfer.from}>${transfer.to}`} className={transfer.from === view.me || transfer.to === view.me ? styles.mine : undefined}>
                {m.transfer_line({ from: view.nameOf(transfer.from), amount: formatCents(transfer.amount), to: view.nameOf(transfer.to) })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
