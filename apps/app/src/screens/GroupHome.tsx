import type { Change, GroupResponse, Member, MemberId, Operation, OperationId } from '@la-pince/core';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';

import { loadErrorMessage } from '../i18n/errors.ts';
import { formatMoment } from '../i18n/moment.ts';
import { m } from '../i18n/paraglide/messages.js';
import { liveOperations, overlay, sortedBalances, transfers } from '../model/group.ts';
import type { LoadError } from '../sync/client.ts';
import type { QueueResult } from '../sync/groupStore.ts';
import { Balances } from './Balances.tsx';
import { EditOperation, NewExpense, NewReimbursement } from './Forms.tsx';
import styles from './GroupHome.module.css';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';
import { Notifications } from './Notifications.tsx';
import { OperationDetail } from './OperationDetail.tsx';
import { OperationList } from './OperationList.tsx';
import { ShareLink } from './ShareLink.tsx';
import type { GroupView } from './view.ts';

interface GroupHomeProps {
  /** Token of the group's link, which the members pass on to each other. */
  readonly token: string;
  readonly group: GroupResponse;
  readonly changes: ReadonlyMap<OperationId, Change>;
  /** Revisions waiting to be sent, in the order they were entered. */
  readonly outbox: readonly Operation[];
  readonly readAt: number;
  /** Who I am, as remembered on this phone, possibly a member who left the group. */
  readonly currentMember: MemberId | undefined;
  readonly onChooseMember: (member: MemberId) => void;
  /** Why the last read failed, the group shown being the last one read in full. */
  readonly readError: LoadError | undefined;
  readonly onRetry: () => void;
  readonly enqueue: (operation: Operation) => Promise<QueueResult>;
}

/** Home of a group: asks “who I am” until this phone knows it, then shows the group as that member, its operations and its balances. */
export function GroupHome({
  token,
  group,
  changes,
  outbox,
  readAt,
  currentMember: remembered,
  onChooseMember,
  readError,
  onRetry,
  enqueue,
}: GroupHomeProps): ReactNode {
  // A remembered member who left the group is asked again.
  const currentMember = group.members.find((member) => member.id === remembered);
  const [choosing, setChoosing] = useState(false);
  const computed = useMemo(() => {
    // Balances count what this phone entered and has not sent yet, computed by the same core.
    const { revisions, pending } = overlay(changes, outbox);
    const operations = liveOperations(revisions, pending);
    const balances = sortedBalances(group.members, operations);
    return { operations, balances, transfers: transfers(balances), pendingCount: pending.size };
  }, [changes, outbox, group.members]);

  if (currentMember === undefined || choosing) {
    return (
      <WhoAmI
        title={group.title}
        members={group.members}
        currentMember={currentMember}
        onChoose={(member) => {
          onChooseMember(member.id);
          setChoosing(false);
        }}
      />
    );
  }
  const view: GroupView = {
    ...computed,
    me: currentMember.id,
    // Who I am is named “(toi)” wherever a member is named.
    nameOf: (id: MemberId) => {
      const name = group.members.find((member) => member.id === id)?.name ?? id;
      return id === currentMember.id ? `${name} (${m.you()})` : name;
    },
    members: group.members,
    enqueue,
    readAt,
  };
  return (
    <Layout>
      <header className={styles.groupHeader}>
        <h1 className={layout.title}>{group.title}</h1>
        <p className={styles.me}>
          <span>{m.group_you_are({ name: currentMember.name })}</span>
          <button
            className={layout.link}
            type="button"
            onClick={() => {
              setChoosing(true);
            }}
          >
            {m.group_change_member()}
          </button>
        </p>
        <ShareLink token={token} title={group.title} />
        <Notifications token={token} title={group.title} member={currentMember.id} />
      </header>
      <nav className={styles.tabs} aria-label={m.tabs_label()}>
        <Tab href="/">{m.tab_operations()}</Tab>
        <Tab href="/soldes">{m.tab_balances()}</Tab>
      </nav>
      {readError === 'network' ? (
        // Without network the app keeps working: the outbox leaves on its own once the server answers.
        <div className={styles.offline} role="status">
          <p>{(computed.pendingCount > 0 ? m.group_offline_pending : m.group_offline)({ when: formatMoment(readAt) })}</p>
          <button className={layout.link} type="button" onClick={onRetry}>
            {m.group_retry()}
          </button>
        </div>
      ) : readError === undefined ? null : (
        <div className={styles.readError} role="alert">
          <p>
            {m.group_read_failed()} {loadErrorMessage(readError)}
          </p>
          <button className={layout.link} type="button" onClick={onRetry}>
            {m.group_retry()}
          </button>
        </div>
      )}
      <Switch>
        <Route path="/">
          <OperationList view={view} />
        </Route>
        <Route path="/nouvelle-depense">
          <NewExpense view={view} />
        </Route>
        <Route path="/nouveau-remboursement">
          <NewReimbursement view={view} />
        </Route>
        <Route path="/operations/:id/modifier">{({ id }) => <EditOperation view={view} id={id} />}</Route>
        <Route path="/operations/:id">{({ id }) => <OperationDetail view={view} id={id} />}</Route>
        <Route path="/soldes">
          <Balances view={view} />
        </Route>
        <Route>
          <p className={layout.muted}>{m.not_found()}</p>
        </Route>
      </Switch>
    </Layout>
  );
}

function Tab({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const [location] = useLocation();
  // The routes match with or without a trailing slash; every screen but the balances belongs to the operations (detail, forms).
  const path = location.replace(/(.)\/+$/, '$1');
  const active = href === '/soldes' ? path === href : path !== '/soldes';
  return (
    <Link className={active ? `${styles.tab ?? ''} ${styles.active ?? ''}` : styles.tab} href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}

interface WhoAmIProps {
  readonly title: string;
  readonly members: readonly Member[];
  readonly currentMember: Member | undefined;
  readonly onChoose: (member: Member) => void;
}

/** “Who I am”: one button per member, in the order they were added to the group. */
function WhoAmI({ title, members, currentMember, onChoose }: WhoAmIProps) {
  return (
    <Layout>
      <p className={layout.muted}>{title}</p>
      <h1 className={layout.title}>{m.who_am_i_title()}</h1>
      <p className={layout.muted}>{m.who_am_i_explanation()}</p>
      <ul className={styles.members}>
        {members.map((member) => (
          <li key={member.id}>
            <button
              className={styles.member}
              type="button"
              aria-pressed={member.id === currentMember?.id}
              onClick={() => {
                onChoose(member);
              }}
            >
              {member.name}
            </button>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
