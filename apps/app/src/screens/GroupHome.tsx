import type { Change, GroupResponse, Member, MemberId, Operation, OperationId } from '@la-pince/core';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';

import { loadErrorMessage } from '../i18n/errors.ts';
import { formatMoment } from '../i18n/moment.ts';
import { m } from '../i18n/paraglide/messages.js';
import { liveOperations, overlay, sortedBalances, transfers } from '../model/group.ts';
import type { LoadError } from '../sync/client.ts';
import type { QueueResult } from '../sync/groupStore.ts';
import { Avatar } from './Avatar.tsx';
import { Balances } from './Balances.tsx';
import { BottomNav, chromeOf } from './BottomNav.tsx';
import { EditOperation, NewExpense, NewReimbursement } from './Forms.tsx';
import styles from './GroupHome.module.css';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';
import { useListFilter } from './listFilterMemory.ts';
import { ListFilterBar } from './ListFilters.tsx';
import { GroupMembers, OnThisPhone, You } from './Me.tsx';
import { MemberBalance } from './MemberBalance.tsx';
import { Notifications } from './Notifications.tsx';
import { OperationDetail } from './OperationDetail.tsx';
import { OperationList } from './OperationList.tsx';
import { ShareLink } from './ShareLink.tsx';
import { Transfers } from './Transfers.tsx';
import { useOnline } from './useOnline.ts';
import type { GroupEdit, GroupView } from './view.ts';

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
  /** Edits of the group, the network aside, which this screen tells. */
  readonly edits: Omit<GroupEdit, 'online'>;
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
  edits,
}: GroupHomeProps): ReactNode {
  // A remembered member who left the group is asked again.
  const currentMember = group.members.find((member) => member.id === remembered);
  const [choosing, setChoosing] = useState(false);
  const [location] = useLocation();
  const chrome = chromeOf(location);
  const online = useOnline();
  // Kept while the group's screens change, an operation opened from the list included (docs/decisions/filtres-de-la-liste.md).
  const [filter, setFilter] = useListFilter(token);
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
    title: group.title,
    // Who has no network cannot edit: a read that failed for that says so, and so does the browser.
    edit: { ...edits, online: online && readError !== 'network' },
  };
  return (
    <Layout
      title={group.title}
      actions={
        <>
          <ShareLink token={token} title={group.title} />
          <Link className={layout.iconButton} href="/moi">
            <Avatar member={currentMember} view={view} />
            <span className={layout.visuallyHidden}>{m.group_you_are({ name: currentMember.name })}</span>
          </Link>
        </>
      }
      below={chrome.filters ? <ListFilterBar view={view} filter={filter} onChange={setFilter} /> : undefined}
      nav={chrome.nav ? <BottomNav section={chrome.section} /> : undefined}
      screenBar={chrome.screenBar}
    >
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
          <OperationList view={view} filter={filter} />
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
        <Route path="/soldes/virements">
          <Transfers view={view} />
        </Route>
        {/* The sheet's former address, which older links may still name. */}
        <Route path="/soldes/membres/:id">{({ id }) => <Redirect to={`/membres/${encodeURIComponent(id)}`} replace />}</Route>
        <Route path="/membres/:id">{({ id }) => <MemberBalance view={view} id={id} />}</Route>
        <Route path="/moi">
          <You view={view} />
        </Route>
        <Route path="/moi/groupe">
          <GroupMembers view={view} />
        </Route>
        <Route>
          <p className={layout.muted}>{m.not_found()}</p>
        </Route>
      </Switch>
      {/* Below my sheet on the tab “Toi”; mounted on every screen of the group, at the same place, so that each opening saves the subscription again. */}
      <div hidden={chrome.section !== 'me'}>
        <OnThisPhone
          notifications={<Notifications token={token} title={group.title} member={currentMember.id} />}
          onChangeMember={() => {
            setChoosing(true);
          }}
        />
      </div>
    </Layout>
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
