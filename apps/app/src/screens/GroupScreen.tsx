import { groupTokenSchema } from '@la-pince/core';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';

import { loadErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { saveLastGroup } from '../storage/device.ts';
import { useApiClient } from '../sync/context.ts';
import { createGroupStore } from '../sync/groupStore.ts';
import { GroupHome } from './GroupHome.tsx';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';

/** Screen of a group link (`/g/:token` and below): checks the token, reads the group from the server, then hands it to the group's home. */
export function GroupScreen({ token }: { readonly token: string }): ReactNode {
  if (!groupTokenSchema.safeParse(token).success) {
    return (
      <Layout>
        <p className={layout.error}>{m.link_invalid()}</p>
        <OtherLink />
      </Layout>
    );
  }
  return <GroupLoader key={token} token={token} />;
}

function GroupLoader({ token }: { readonly token: string }) {
  const client = useApiClient();
  const [store] = useState(() => createGroupStore(client, token));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const ready = state.status === 'ready';

  useEffect(() => store.start(), [store]);
  useEffect(() => {
    if (ready) {
      saveLastGroup(token);
    }
  }, [ready, token]);

  switch (state.status) {
    case 'loading':
      return (
        <Layout>
          <p className={layout.muted} role="status">
            {m.group_loading()}
          </p>
        </Layout>
      );
    case 'error':
      return (
        <Layout>
          <p className={layout.error} role="alert">
            {loadErrorMessage(state.error)}
          </p>
          {state.error === 'group_not_found' ? (
            <OtherLink />
          ) : (
            <button
              className={layout.button}
              type="button"
              onClick={() => {
                void store.load();
              }}
            >
              {m.group_retry()}
            </button>
          )}
        </Layout>
      );
    case 'ready':
      return (
        <GroupHome
          group={state.group}
          changes={state.changes}
          outbox={state.outbox}
          readAt={state.readAt}
          currentMember={state.currentMember}
          onChooseMember={store.chooseMember}
          readError={state.readError}
          onRetry={() => void store.sync()}
          enqueue={store.enqueue}
        />
      );
  }
}

function OtherLink() {
  return (
    // `~` leaves the group's nested routes.
    <Link className={layout.link} href="~/lien">
      {m.group_other_link()}
    </Link>
  );
}
