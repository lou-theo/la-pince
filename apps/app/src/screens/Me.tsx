import { MAX_GROUP_TITLE_LENGTH, type MemberId, memberNameKey } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { sheetHref } from '../model/back.ts';
import { AddMember } from './AddMember.tsx';
import { Avatar } from './Avatar.tsx';
import { EditOffline } from './EditOffline.tsx';
import installStyles from './Install.module.css';
import { InstallGuideLink } from './InstallOffer.tsx';
import { BackBar } from './Layout.tsx';
import styles from './Me.module.css';
import { MemberSheet } from './MemberBalance.tsx';
import { RenameField } from './RenameField.tsx';
import type { GroupView } from './view.ts';

/**
 * The bar of my page: the way back to the expenses, the group's title, and its two tabs, links in the address (`/moi`, `/moi/groupe`) shown as a
 * segmented control.
 */
function MeBar({ view, tab }: { readonly view: GroupView; readonly tab: 'you' | 'group' }) {
  return (
    <BackBar href="/" label={m.me_back()} title={view.title}>
      <nav className={styles.tabs} aria-label={m.me_tabs_label()}>
        <Link className={styles.tab} href="/moi" aria-current={tab === 'you' ? 'page' : undefined}>
          {m.me_tab_you()}
        </Link>
        <Link className={styles.tab} href="/moi/groupe" aria-current={tab === 'group' ? 'page' : undefined}>
          {m.me_tab_group()}
        </Link>
      </nav>
    </BackBar>
  );
}

/** The tab “Toi” of my page: my sheet, then what is set on this phone, which the group's home shows below (`OnThisPhone`). */
export function You({ view }: { readonly view: GroupView }): ReactNode {
  return (
    <>
      <MeBar view={view} tab="you" />
      <MemberSheet view={view} id={view.me} here="/moi" you />
    </>
  );
}

/** The tab “Le groupe” of my page: its name to rename, its members, each opening their sheet, and a way to add one. */
export function GroupMembers({ view }: { readonly view: GroupView }): ReactNode {
  const count = useId();
  const taken = (text: string, self?: MemberId) =>
    view.members.some((member) => member.id !== self && memberNameKey(member.name) === memberNameKey(text));
  return (
    <>
      <MeBar view={view} tab="group" />
      {view.edit.online ? null : <EditOffline />}
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <span className={styles.titleLabel}>{m.members_title()}</span>
          <RenameField
            value={view.title}
            maxLength={MAX_GROUP_TITLE_LENGTH}
            label={m.rename_group()}
            field={m.members_title()}
            online={view.edit.online}
            onSave={view.edit.renameGroup}
          >
            <span className={styles.groupTitle}>{view.title}</span>
          </RenameField>
        </div>
      </div>
      <section className={styles.section} aria-labelledby={count}>
        <h2 id={count} className={styles.sectionTitle}>
          {view.members.length === 1 ? m.members_count_one() : m.members_count({ count: String(view.members.length) })}
        </h2>
        <ul className={styles.card}>
          {view.members.map((member) => (
            <li key={member.id}>
              <Link className={styles.member} href={sheetHref(member.id, '/moi/groupe')} aria-label={view.nameOf(member.id)}>
                <Avatar member={member} view={view} />
                <span className={styles.memberName}>{member.name}</span>
                {member.id === view.me ? <span className={styles.youTag}>{m.you()}</span> : null}
                <Chevron />
              </Link>
            </li>
          ))}
          <li>
            <AddMember online={view.edit.online} taken={taken} onAdd={view.edit.addMember} photos={view.edit.photos} onPhoto={view.edit.setPhoto} />
          </li>
        </ul>
      </section>
    </>
  );
}

function Chevron() {
  return (
    <svg
      className={styles.chevron}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** The way to the guide of this browser on my page, La Pince peeking: on a phone outside of the installed app only (`InstallGuideLink`). */
export function InstallEntry({ title }: { readonly title: string }): ReactNode {
  return (
    <InstallGuideLink title={title} className={`${styles.card ?? ''} ${styles.rowButton ?? ''} ${styles.installRow ?? ''}`}>
      <img className={installStyles.peek} src="/logo.svg" alt="" />
      <span className={`${styles.rowText ?? ''} ${styles.installText ?? ''}`}>{m.install_entry()}</span>
      <Chevron />
    </InstallGuideLink>
  );
}

/** What my page sets on this phone, below my sheet: the install of the app, the notifications of the group, and who I am. */
export function OnThisPhone({
  install,
  notifications,
  onChangeMember,
}: {
  /** The way to the guide, shown on a phone outside of the installed app only. */
  readonly install: ReactNode;
  readonly notifications: ReactNode;
  readonly onChangeMember: () => void;
}): ReactNode {
  const title = useId();
  const hint = useId();
  return (
    <section className={styles.section} aria-labelledby={title}>
      <h2 id={title} className={styles.sectionTitle}>
        {m.me_on_this_phone()}
      </h2>
      {install}
      <div className={`${styles.card ?? ''} ${styles.notifications ?? ''}`}>{notifications}</div>
      <button
        className={`${styles.card ?? ''} ${styles.rowButton ?? ''}`}
        type="button"
        aria-label={m.group_change_member()}
        aria-describedby={hint}
        onClick={onChangeMember}
      >
        <span className={styles.rowText}>{m.group_change_member()}</span>
        <span id={hint} className={styles.rowHint}>
          {m.me_change_hint()}
        </span>
      </button>
    </section>
  );
}
