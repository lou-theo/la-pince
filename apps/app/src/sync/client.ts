import { apiErrorSchema, type GroupResponse, groupResponseSchema } from '@la-pince/core';

/** The part of `fetch` the client uses, so that tests hand it a fake transport. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Why a group could not be read: unknown link, no answer from the server, or an answer outside the contract. */
export type LoadError = 'group_not_found' | 'network' | 'unexpected';

export type GroupResult = { readonly ok: true; readonly group: GroupResponse } | { readonly ok: false; readonly error: LoadError };

export interface ApiClient {
  readonly fetchGroup: (token: string) => Promise<GroupResult>;
}

/** Client of the sync API of `apps/server`; every answer goes through the schemas of the core before the app reads it. */
export function createApiClient(fetchFn: Fetch): ApiClient {
  return {
    async fetchGroup(token) {
      let response: Response;
      try {
        response = await fetchFn(`/api/groups/${encodeURIComponent(token)}`);
      } catch {
        return { ok: false, error: 'network' };
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (response.ok) {
        const group = groupResponseSchema.safeParse(body);
        return group.success ? { ok: true, group: group.data } : { ok: false, error: 'unexpected' };
      }
      const error = apiErrorSchema.safeParse(body);
      return { ok: false, error: error.success && error.data.error === 'group_not_found' ? 'group_not_found' : 'unexpected' };
    },
  };
}
