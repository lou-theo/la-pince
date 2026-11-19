import {
  apiErrorSchema,
  type ChangesResponse,
  changesResponseSchema,
  type Cursor,
  type GroupResponse,
  groupResponseSchema,
  MAX_CHANGES,
  pageFollowsQuery,
} from '@la-pince/core';

/** The part of `fetch` the client uses, so that tests hand it a fake transport. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Why a read failed, as the screens tell it: unknown link, no answer from the server, or an answer outside the contract. */
export type LoadError = 'group_not_found' | 'network' | 'unexpected';

export type ApiResult<T, E extends string = LoadError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** `cursor_ahead`: the server's history is behind the cursor (rebuilt), the reader starts again from 0. */
export type ChangesError = LoadError | 'cursor_ahead';

export interface ApiClient {
  readonly fetchGroup: (token: string) => Promise<ApiResult<GroupResponse>>;
  /** One page of the changes since the cursor, checked to answer that very query. */
  readonly fetchChanges: (token: string, since: Cursor) => Promise<ApiResult<ChangesResponse, ChangesError>>;
}

interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Client of the sync API of `apps/server`; every answer goes through the schemas of the core before the app reads it. */
export function createApiClient(fetchFn: Fetch): ApiClient {
  async function read<T>(url: string, schema: Schema<T>): Promise<ApiResult<T, ChangesError>> {
    let response: Response;
    try {
      response = await fetchFn(url);
    } catch {
      return { ok: false, error: 'network' };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'unexpected' };
    }
    const error = apiErrorSchema.safeParse(body);
    const code = error.success ? error.data.error : undefined;
    return { ok: false, error: code === 'group_not_found' || code === 'cursor_ahead' ? code : 'unexpected' };
  }

  const groupUrl = (token: string) => `/api/groups/${encodeURIComponent(token)}`;

  return {
    async fetchGroup(token) {
      const result = await read(groupUrl(token), groupResponseSchema);
      if (result.ok) {
        return result;
      }
      // A group read never answers `cursor_ahead`: such an answer is outside the contract.
      return { ok: false, error: result.error === 'cursor_ahead' ? 'unexpected' : result.error };
    },
    async fetchChanges(token, since) {
      const result = await read(`${groupUrl(token)}/changes?since=${String(since)}`, changesResponseSchema);
      if (result.ok && !pageFollowsQuery({ since, limit: MAX_CHANGES }, result.value)) {
        return { ok: false, error: 'unexpected' };
      }
      return result;
    },
  };
}
