import { groupTokenSchema } from '@la-pince/core';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'wouter';

import { loadErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { saveLastGroup } from '../storage/device.ts';
import type { GroupResult } from '../sync/client.ts';
import { useApiClient } from '../sync/context.ts';
import { GroupHome } from './GroupHome.tsx';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';

/** Screen of a group link (`/g/:token`): checks the token, reads the group from the server, then hands it to the group's home. */
export function GroupScreen({ token }: { readonly token: string }): ReactNode {
  if (!groupTokenSchema.safeParse(token).success) {
    return (
      <Layout>
        <p className={layout.error}>{m.link_invalid()}</p>
        <OtherLink />
      </Layout>
    );
  }
  return <GroupLoader token={token} />;
}

function GroupLoader({ token }: { readonly token: string }) {
  const client = useApiClient();
  const [attempt, setAttempt] = useState(0);
  // The answer remembers what it answers, so that a new token or a retry shows the loading state until its own answer arrives.
  const [loaded, setLoaded] = useState<{ token: string; attempt: number; result: GroupResult }>();

  useEffect(() => {
    let current = true;
    void client.fetchGroup(token).then((result) => {
      if (!current) {
        return;
      }
      if (result.ok) {
        saveLastGroup(token);
      }
      setLoaded({ token, attempt, result });
    });
    return () => {
      current = false;
    };
  }, [client, token, attempt]);

  if (loaded?.token !== token || loaded.attempt !== attempt) {
    return (
      <Layout>
        <p className={layout.muted} role="status">
          {m.group_loading()}
        </p>
      </Layout>
    );
  }
  const { result } = loaded;
  if (result.ok) {
    return <GroupHome key={token} token={token} group={result.group} />;
  }
  return (
    <Layout>
      <p className={layout.error} role="alert">
        {loadErrorMessage(result.error)}
      </p>
      {result.error === 'group_not_found' ? (
        <OtherLink />
      ) : (
        <button
          className={layout.button}
          type="button"
          onClick={() => {
            setAttempt(attempt + 1);
          }}
        >
          {m.group_retry()}
        </button>
      )}
    </Layout>
  );
}

function OtherLink() {
  return (
    <Link className={layout.link} href="/lien">
      {m.group_other_link()}
    </Link>
  );
}
