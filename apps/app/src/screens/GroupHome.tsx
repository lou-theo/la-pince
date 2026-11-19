import type { Change, GroupResponse, Member, MemberId, OperationId } from '@la-pince/core';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { liveOperations, sortedBalances, transfers } from '../model/group.ts';
import { readCurrentMember, saveCurrentMember } from '../storage/device.ts';
import { Balances } from './Balances.tsx';
import styles from './GroupHome.module.css';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';
import { OperationDetail } from './OperationDetail.tsx';
import { OperationList } from './OperationList.tsx';
import type { GroupView } from './view.ts';

interface GroupHomeProps {
  readonly token: string;
  readonly group: GroupResponse;
  readonly changes: ReadonlyMap<OperationId, Change>;
}

/** Home of a group: asks “who I am” until this phone knows it, then shows the group as that member, its operations and its balances. */
export function GroupHome({ token, group, changes }: GroupHomeProps): ReactNode {
  // A remembered member who left the group is asked again.
  const [currentMember, setCurrentMember] = useState(() => {
    const stored = readCurrentMember(token);
    return group.members.find((member) => member.id === stored);
  });
  const [choosing, setChoosing] = useState(false);
  const computed = useMemo(() => {
    const operations = liveOperations(changes.values());
    const balances = sortedBalances(group.members, operations);
    return { operations, balances, transfers: transfers(balances) };
  }, [changes, group.members]);

  if (currentMember === undefined || choosing) {
    return (
      <WhoAmI
        title={group.title}
        members={group.members}
        currentMember={currentMember}
        onChoose={(member) => {
          saveCurrentMember(token, member.id);
          setCurrentMember(member);
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
    memberOrder: group.members.map((member) => member.id),
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
      </header>
      <nav className={styles.tabs} aria-label={m.tabs_label()}>
        <Tab href="/">{m.tab_operations()}</Tab>
        <Tab href="/soldes">{m.tab_balances()}</Tab>
      </nav>
      <Switch>
        <Route path="/">
          <OperationList view={view} />
        </Route>
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
  // The routes match with or without a trailing slash; an operation's detail belongs to the list of operations.
  const path = location.replace(/(.)\/+$/, '$1');
  const active = href === '/' ? path === '/' || path.startsWith('/operations/') : path === href;
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
