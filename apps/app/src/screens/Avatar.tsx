import type { Member } from '@la-pince/core';
import { type ReactNode, useReducer } from 'react';

import { avatarOf } from '../model/avatar.ts';
import styles from './Avatar.module.css';
import type { GroupView } from './view.ts';

// When each photo last failed to load, by address: shared by every avatar, so that one failure does not make each screen ask again at once. Kept
// after a later success: the time only names the try, a new failure replacing it.
const failed = new Map<string, number>();

/**
 * Round avatar of a member, their initial on their color, under their photo when they have one; decorative, the member's name being said next to
 * it or in the control's label. A photo that fails to load (offline and never kept, missing a moment from the server's store just after a change)
 * leaves the initial, and is tried again once a later read of the group has ended, every 30 s while the app is open.
 */
export function Avatar({
  member,
  view,
}: {
  readonly member: Member;
  readonly view: Pick<GroupView, 'members' | 'me' | 'photoOf' | 'readAt'>;
}): ReactNode {
  const { initial, tone } = avatarOf(member, view.members, view.me);
  const [, failedNow] = useReducer((count: number) => count + 1, 0);
  const url = view.photoOf(member);
  const failedAt = url === undefined ? undefined : failed.get(url);
  const shown = failedAt === undefined || failedAt < view.readAt;
  return (
    <span className={`${styles.avatar ?? ''} ${(tone === 'me' ? styles.me : styles[`tone${String(tone)}`]) ?? ''}`} aria-hidden="true">
      {initial}
      {url !== undefined && shown ? (
        // A new element at each try: the one that failed would not ask again for the same address.
        <img
          key={`${url}#${String(failedAt)}`}
          className={styles.photo}
          src={url}
          alt=""
          decoding="async"
          onError={() => {
            failed.set(url, Date.now());
            failedNow();
          }}
        />
      ) : null}
    </span>
  );
}
