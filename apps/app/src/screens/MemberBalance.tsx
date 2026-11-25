import { type MemberId, memberIdSchema, memberNameKey } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link, useSearch } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { backOf, sheetHref } from '../model/back.ts';
import { memberSheet, type Standing } from '../model/balances.ts';
import { formatCents } from '../model/money.ts';
import { transferRows } from '../model/settle.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import { EditOffline } from './EditOffline.tsx';
import { reimbursementHref } from './Forms.tsx';
import layout from './Layout.module.css';
import { BackBar } from './Layout.tsx';
import { RenameField } from './RenameField.tsx';
import { PlusIcon, rowKey, TransferLine } from './Transfers.tsx';
import { UndoBanner } from './UndoBanner.tsx';
import { useSettle } from './useSettle.ts';
import { type GroupView, isMember, memberOf, shortName, syncLine } from './view.ts';

// Same bound as the server's (`enteredTextSchema` of a name).
const MAX_NAME_LENGTH = 50;

/** Label of a sheet's arrow, after the screen it leads back to. */
function backLabel(back: string): string {
  switch (back) {
    case '/soldes/virements':
      return m.sheet_back_transfers();
    case '/moi':
      return m.sheet_back_me();
    case '/moi/groupe':
      return m.sheet_back_group();
    default:
      return m.transfers_back();
  }
}

/** A member's sheet at its own address, opened from the balances, the transfers or the group's tab, whose arrow leads back there (`?retour=`). */
export function MemberBalance({ view, id: path }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const back = backOf('sheet', new URLSearchParams(useSearch()).get('retour'));
  const parsed = memberIdSchema.safeParse(path);
  const known = parsed.success && memberSheet(parsed.data, view.balances, view.transfers, view.members) !== undefined;
  return (
    <>
      <BackBar href={back} label={backLabel(back)} title={view.title} />
      {parsed.success && known ? (
        <MemberSheet view={view} id={parsed.data} here={sheetHref(parsed.data, back)} you={false} />
      ) : (
        <p className={layout.muted}>{m.member_not_found()}</p>
      )}
    </>
  );
}

interface MemberSheetProps {
  readonly view: GroupView;
  readonly id: MemberId;
  /** The address of this screen, where the reimbursement page comes back. */
  readonly here: string;
  /** The tab “Toi” of my page: my name as I typed it, without “(toi)”. */
  readonly you: boolean;
}

/**
 * A member's sheet: their avatar, their name with a pencil to rename them, their balance, then the transfers they should make, or those they should
 * receive, each with “C'est payé”. Anyone with the link edits any member (docs/decisions/edition-du-groupe.md, point d).
 */
export function MemberSheet({ view, id, here, you }: MemberSheetProps): ReactNode {
  const pays = useId();
  const receives = useId();
  const settle = useSettle(view);
  const sheet = memberSheet(id, view.balances, view.transfers, view.members);
  if (sheet === undefined) {
    return <p className={layout.muted}>{m.member_not_found()}</p>;
  }
  const mine = id === view.me;
  const member = memberOf(view, id);
  const inGroup = isMember(view, id);
  const payRows = transferRows(
    sheet.pays,
    settle.paid.filter((line) => line.transfer.from === id),
    settle.live,
  );
  const receiveRows = transferRows(
    sheet.receives,
    settle.paid.filter((line) => line.transfer.to === id),
    settle.live,
  );
  const name = <h2 className={styles.sheetName}>{you ? member.name : view.nameOf(id)}</h2>;
  return (
    <>
      {inGroup && !view.edit.online ? <EditOffline /> : null}
      <div className={styles.sheetHead}>
        {/* The place of the camera badge, which photos will put on the avatar's corner without moving anything. */}
        <span className={styles.bigAvatar}>
          <Avatar member={member} view={view} />
        </span>
        {/* A member who left the group is not in its list: the server would not find them to rename. */}
        {inGroup ? (
          <RenameField
            value={member.name}
            maxLength={MAX_NAME_LENGTH}
            label={mine ? m.rename_me() : m.rename_member({ name: member.name })}
            field={m.rename_name()}
            taken={(text) => view.members.some((other) => other.id !== id && memberNameKey(other.name) === memberNameKey(text))}
            online={view.edit.online}
            onSave={(text) => view.edit.renameMember(id, text)}
            centered
          >
            {name}
          </RenameField>
        ) : (
          name
        )}
        <StandingLine standing={sheet.standing} balance={sheet.balance} mine={mine} />
      </div>
      {/* A member who left the group is not offered by the reimbursement page: the server would refuse a reimbursement naming them. */}
      {inGroup ? (
        <Link className={styles.declare} href={declareHref(id, sheet.standing, here)}>
          <PlusIcon />
          {m.member_declare()}
        </Link>
      ) : null}
      {payRows.length === 0 && receiveRows.length === 0 ? <p className={layout.muted}>{mine ? m.member_nothing_me() : m.member_nothing()}</p> : null}
      {payRows.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={pays}>
          <h3 id={pays} className={styles.sheetTitle}>
            {mine ? m.member_pays_me() : m.member_pays()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {payRows.map((row) => (
              <TransferLine
                key={rowKey(row)}
                view={view}
                row={row}
                settle={settle}
                avatar={row.transfer.to}
                text={m.transfer_to({ name: shortName(view, row.transfer.to, 'object') })}
              />
            ))}
          </ul>
        </section>
      )}
      {receiveRows.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={receives}>
          <h3 id={receives} className={styles.sheetTitle}>
            {mine ? m.member_receives_me() : m.member_receives()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {receiveRows.map((row) => (
              <TransferLine
                key={rowKey(row)}
                view={view}
                row={row}
                settle={settle}
                avatar={row.transfer.from}
                text={shortName(view, row.transfer.from)}
              />
            ))}
          </ul>
        </section>
      )}
      {payRows.length === 0 && receiveRows.length === 0 ? null : <p className={layout.muted}>{m.member_suggested()}</p>}
      <p className={layout.muted}>{syncLine(view)}</p>
      <UndoBanner view={view} settle={settle} nav={false} />
    </>
  );
}

function StandingLine({ standing, balance, mine }: { readonly standing: Standing; readonly balance: number; readonly mine: boolean }) {
  const amount = <strong className={styles.sheetAmount}>{formatCents(Math.abs(balance))}</strong>;
  switch (standing) {
    case 'settled':
      return <p className={styles.word}>{m.member_settled()}</p>;
    case 'owes':
      return (
        <p className={styles.owes}>
          {mine ? m.member_owes_me() : m.member_owes()} {amount}
        </p>
      );
    case 'ahead':
      return (
        <p className={styles.ahead}>
          {mine ? m.member_ahead_me() : m.member_ahead()} {amount}
        </p>
      );
  }
}

/**
 * The reimbursement page, with the member on the side their balance asks for: giving for one who owes or is settled, receiving for one the group
 * owes, me included, the page then asking who gives it. Closing it comes back to this sheet, `here`.
 */
function declareHref(id: MemberId, standing: Standing, here: string): string {
  return standing === 'ahead' ? reimbursementHref({ to: id, back: here }) : reimbursementHref({ from: id, back: here });
}
