import {
  apiErrorSchema,
  type ChangesResponse,
  changesResponseSchema,
  type Cursor,
  type GroupResponse,
  groupResponseSchema,
  MAX_CHANGES,
  type Operation,
  operationBatchResponseSchema,
  pageFollowsQuery,
  type RevisionResult,
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
  /** Sends revisions in one batch; the result of each, in the order sent. */
  readonly sendOperations: (token: string, operations: readonly Operation[]) => Promise<ApiResult<RevisionResult[]>>;
}

// A request still pending past this is given up as a network failure: an answer that never ends would otherwise hold the outbox lock forever.
const REQUEST_TIMEOUT = 30_000;

interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Client of the sync API of `apps/server`; every answer goes through the schemas of the core before the app reads it. */
export function createApiClient(fetchFn: Fetch): ApiClient {
  async function read<T>(url: string, schema: Schema<T>, init?: RequestInit): Promise<ApiResult<T, ChangesError>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);
    let response: Response;
    let body: unknown;
    try {
      response = await fetchFn(url, { ...init, signal: controller.signal });
      body = await response.json().catch(() => undefined);
    } catch {
      return { ok: false, error: 'network' };
    } finally {
      clearTimeout(timeout);
    }
    if (controller.signal.aborted) {
      return { ok: false, error: 'network' };
    }
    if (response.ok) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'unexpected' };
    }
    const error = apiErrorSchema.safeParse(body);
    const code = error.success ? error.data.error : undefined;
    return { ok: false, error: code === 'group_not_found' || code === 'cursor_ahead' ? code : 'unexpected' };
  }

  const groupUrl = (token: string) => `/api/groups/${encodeURIComponent(token)}`;

  // Only a read of the changes may answer `cursor_ahead`: elsewhere such an answer is outside the contract.
  const withoutCursor = <T>(result: ApiResult<T, ChangesError>): ApiResult<T> =>
    result.ok || result.error !== 'cursor_ahead' ? (result as ApiResult<T>) : { ok: false, error: 'unexpected' };

  return {
    async fetchGroup(token) {
      return withoutCursor(await read(groupUrl(token), groupResponseSchema));
    },
    async fetchChanges(token, since) {
      const result = await read(`${groupUrl(token)}/changes?since=${String(since)}`, changesResponseSchema);
      if (result.ok && !pageFollowsQuery({ since, limit: MAX_CHANGES }, result.value)) {
        return { ok: false, error: 'unexpected' };
      }
      return result;
    },
    async sendOperations(token, operations) {
      const result = withoutCursor(
        await read(`${groupUrl(token)}/operations`, operationBatchResponseSchema, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations }),
        }),
      );
      if (!result.ok) {
        return result;
      }
      const { results } = result.value;
      const answersEach =
        results.length === operations.length && results.every((answer, index) => answer.revisionId === operations[index]?.revisionId);
      return answersEach ? { ok: true, value: results } : { ok: false, error: 'unexpected' };
    },
  };
}
