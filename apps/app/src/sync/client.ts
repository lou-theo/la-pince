import {
  apiErrorSchema,
  type ChangesResponse,
  changesResponseSchema,
  type Cursor,
  type GroupId,
  type GroupResponse,
  groupResponseSchema,
  MAX_CHANGES,
  type MemberId,
  type NewMember,
  type Operation,
  operationBatchResponseSchema,
  pageFollowsQuery,
  pushKeyResponseSchema,
  type RevisionId,
  type RevisionResult,
  type SubscribeRequest,
  subscribeResponseSchema,
} from '@la-pince/core';

/** The part of `fetch` the client uses, so that tests hand it a fake transport. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Why a read failed, as the screens tell it: unknown link, no answer from the server, or an answer outside the contract. */
export type LoadError = 'group_not_found' | 'network' | 'unexpected';

export type ApiResult<T, E extends string = LoadError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** `unknown_cursor`: the server no longer has the revision at the cursor (database restored), the reader starts again from 0. */
export type ChangesError = LoadError | 'unknown_cursor';

/**
 * Why a request about notifications failed: `notifications_disabled`, the instance has not set them up; `too_many_subscriptions`, the group holds the
 * most; `invalid_request`, the server refused the phone's push service or the member; `subscription_not_found`, the server no longer has this phone.
 */
export type NotificationError = LoadError | 'notifications_disabled' | 'too_many_subscriptions' | 'invalid_request' | 'subscription_not_found';

/**
 * Why an edit of the group failed: `invalid_request`, the server refused the text; `member_not_found`, no such member in the group;
 * `too_many_members`, the group is full; `member_name_taken`, another member already has the name.
 */
export type GroupEditError = LoadError | 'invalid_request' | 'member_not_found' | 'too_many_members' | 'member_name_taken';

export interface ApiClient {
  readonly fetchGroup: (token: string) => Promise<ApiResult<GroupResponse>>;
  /** One page of the changes since the cursor, given with the revision received at it past 0, checked to answer that very query. */
  readonly fetchChanges: (token: string, since: Cursor, revision: RevisionId | undefined) => Promise<ApiResult<ChangesResponse, ChangesError>>;
  /** Sends revisions in one batch; the result of each, in the order sent. */
  readonly sendOperations: (token: string, operations: readonly Operation[]) => Promise<ApiResult<RevisionResult[]>>;
  /** The instance's public push key, which the phone gives its push service when it subscribes. */
  readonly fetchPushKey: () => Promise<ApiResult<string, NotificationError>>;
  /** Subscribes this phone to the group's notifications as a member, or moves it to that member; gives the group's id, which push messages carry. */
  readonly subscribe: (token: string, request: SubscribeRequest) => Promise<ApiResult<GroupId, NotificationError>>;
  readonly unsubscribe: (token: string, endpoint: string) => Promise<ApiResult<undefined, NotificationError>>;
  /** Asks the server to send a test notification to this phone. */
  readonly sendTest: (token: string, endpoint: string) => Promise<ApiResult<undefined, NotificationError>>;
  /** Renames the group; gives the whole group as the server holds it. */
  readonly renameGroup: (token: string, title: string) => Promise<ApiResult<GroupResponse, GroupEditError>>;
  /**
   * Adds a member at the end of the list; gives the whole group. The id is drawn once, when the sheet to add a member opens, and sent again with each
   * new try: a request whose answer was lost then finds the member it created instead of adding a second one.
   */
  readonly addMember: (token: string, member: NewMember) => Promise<ApiResult<GroupResponse, GroupEditError>>;
  /** Renames a member; gives the whole group. */
  readonly renameMember: (token: string, id: MemberId, name: string) => Promise<ApiResult<GroupResponse, GroupEditError>>;
}

// A request still pending past this is given up as a network failure: an answer that never ends would otherwise hold the outbox lock forever.
const REQUEST_TIMEOUT = 30_000;

interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

// Answers without a body (204, 202).
const noBody: Schema<undefined> = { safeParse: () => ({ success: true, data: undefined }) };

const EDIT_ERRORS = ['group_not_found', 'invalid_request', 'member_not_found', 'too_many_members', 'member_name_taken'] as const;

const NOTIFICATION_ERRORS = [
  'group_not_found',
  'notifications_disabled',
  'too_many_subscriptions',
  'invalid_request',
  'subscription_not_found',
] as const;

/** Client of the API of `apps/server`; every answer goes through the schemas of the core before the app reads it. */
export function createApiClient(fetchFn: Fetch): ApiClient {
  // `known`: the error codes the route may answer; any other is outside the contract.
  async function read<T, E extends string>(
    url: string,
    schema: Schema<T>,
    known: readonly E[],
    init?: RequestInit,
  ): Promise<ApiResult<T, E | 'network' | 'unexpected'>> {
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
    const code = known.find((candidate) => error.success && candidate === error.data.error);
    return { ok: false, error: code ?? 'unexpected' };
  }

  const groupUrl = (token: string) => `/api/groups/${encodeURIComponent(token)}`;
  const sendJson = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    async fetchGroup(token) {
      return read(groupUrl(token), groupResponseSchema, ['group_not_found']);
    },
    async fetchChanges(token, since, revision) {
      const query = new URLSearchParams({ since: String(since), ...(revision === undefined ? {} : { revision }) });
      const result = await read(`${groupUrl(token)}/changes?${query.toString()}`, changesResponseSchema, ['group_not_found', 'unknown_cursor']);
      if (result.ok && !pageFollowsQuery({ since, limit: MAX_CHANGES }, result.value)) {
        return { ok: false, error: 'unexpected' };
      }
      return result;
    },
    async sendOperations(token, operations) {
      const result = await read(`${groupUrl(token)}/operations`, operationBatchResponseSchema, ['group_not_found'], sendJson('POST', { operations }));
      if (!result.ok) {
        return result;
      }
      const { results } = result.value;
      const answersEach =
        results.length === operations.length && results.every((answer, index) => answer.revisionId === operations[index]?.revisionId);
      return answersEach ? { ok: true, value: results } : { ok: false, error: 'unexpected' };
    },
    async fetchPushKey() {
      const result = await read('/api/notifications/key', pushKeyResponseSchema, ['notifications_disabled']);
      return result.ok ? { ok: true, value: result.value.publicKey } : result;
    },
    async subscribe(token, request) {
      const result = await read(`${groupUrl(token)}/subscription`, subscribeResponseSchema, NOTIFICATION_ERRORS, sendJson('PUT', request));
      return result.ok ? { ok: true, value: result.value.groupId } : result;
    },
    async unsubscribe(token, endpoint) {
      return read(`${groupUrl(token)}/subscription`, noBody, NOTIFICATION_ERRORS, sendJson('DELETE', { endpoint }));
    },
    async sendTest(token, endpoint) {
      return read(`${groupUrl(token)}/subscription/test`, noBody, NOTIFICATION_ERRORS, sendJson('POST', { endpoint }));
    },
    async renameGroup(token, title) {
      return read(groupUrl(token), groupResponseSchema, EDIT_ERRORS, sendJson('PATCH', { title }));
    },
    async addMember(token, member) {
      return read(`${groupUrl(token)}/members`, groupResponseSchema, EDIT_ERRORS, sendJson('POST', member));
    },
    async renameMember(token, id, name) {
      return read(`${groupUrl(token)}/members/${encodeURIComponent(id)}`, groupResponseSchema, EDIT_ERRORS, sendJson('PATCH', { name }));
    },
  };
}
