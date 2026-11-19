import type { GroupResponse, Member } from '@la-pince/core';
import { type ReactNode, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { readCurrentMember, saveCurrentMember } from '../storage/device.ts';
import styles from './GroupHome.module.css';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';

/** Home of a group: asks “who I am” until this phone knows it, then shows the group as that member. */
export function GroupHome({ token, group }: { readonly token: string; readonly group: GroupResponse }): ReactNode {
  // A remembered member who left the group is asked again.
  const [currentMember, setCurrentMember] = useState(() => {
    const stored = readCurrentMember(token);
    return group.members.find((member) => member.id === stored);
  });
  const [choosing, setChoosing] = useState(false);

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
  return (
    <Layout>
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
      <p className={layout.muted}>{m.group_operations_coming()}</p>
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
