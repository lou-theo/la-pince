import { render } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from '../App.tsx';
import { createApiClient, type Fetch } from '../sync/client.ts';

/** Renders the app at a path with a fake transport; the location records where the app went. */
export function renderApp(path: string, fetchFn: Fetch): ReturnType<typeof memoryLocation> {
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook}>
      <App client={createApiClient(fetchFn)} />
    </Router>,
  );
  return location;
}
