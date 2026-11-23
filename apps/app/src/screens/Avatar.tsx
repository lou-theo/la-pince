import type { Member } from '@la-pince/core';
import type { ReactNode } from 'react';

import { avatarOf } from '../model/avatar.ts';
import styles from './Avatar.module.css';
import type { GroupView } from './view.ts';

/** Round avatar of a member, their initial on their color; decorative, the member's name being said next to it or in the control's label. */
export function Avatar({ member, view }: { readonly member: Member; readonly view: Pick<GroupView, 'members' | 'me'> }): ReactNode {
  const { initial, tone } = avatarOf(member, view.members, view.me);
  return (
    <span className={`${styles.avatar ?? ''} ${(tone === 'me' ? styles.me : styles[`tone${String(tone)}`]) ?? ''}`} aria-hidden="true">
      {initial}
    </span>
  );
}
