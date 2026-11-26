import { type ReactNode, useState } from 'react';
import { Redirect, Route, Switch } from 'wouter';

import { m } from './i18n/paraglide/messages.js';
import { GroupScreen } from './screens/GroupScreen.tsx';
import layout from './screens/Layout.module.css';
import { Layout } from './screens/Layout.tsx';
import { type ListFilterMemory, ListFilterMemoryContext } from './screens/listFilterMemory.ts';
import { PasteLink } from './screens/PasteLink.tsx';
import { readLastGroup } from './storage/device.ts';
import type { ApiClient } from './sync/client.ts';
import { ApiClientContext } from './sync/context.ts';

/** Routes of the app; `/` goes back to the last group opened on this phone, or asks for a link. */
export function App({ client }: { readonly client: ApiClient }): ReactNode {
  const [filters] = useState((): ListFilterMemory => new Map());
  return (
    <ApiClientContext value={client}>
      <ListFilterMemoryContext value={filters}>
        <Switch>
          <Route path="/">
            <Home />
          </Route>
          <Route path="/lien">
            <PasteLink />
          </Route>
          <Route path="/g/:token" nest>
            {({ token }) => <GroupScreen token={token} />}
          </Route>
          <Route>
            <Layout>
              <p className={layout.muted}>{m.not_found()}</p>
            </Layout>
          </Route>
        </Switch>
      </ListFilterMemoryContext>
    </ApiClientContext>
  );
}

function Home() {
  const lastGroup = readLastGroup();
  return lastGroup === undefined ? <PasteLink /> : <Redirect to={`/g/${lastGroup}`} replace />;
}
