import { createContext, use } from 'react';

import type { ApiClient } from './client.ts';

/** The API client of the app, handed by `App` so that tests give it a fake transport. */
export const ApiClientContext = createContext<ApiClient | undefined>(undefined);

export function useApiClient(): ApiClient {
  const client = use(ApiClientContext);
  if (client === undefined) {
    throw new Error('useApiClient is called outside of App');
  }
  return client;
}
