import { type GroupResponse, groupTokenSchema, type MemberId, type PhotoChangeResponse } from '@la-pince/core';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';

import { loadErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { saveLastGroup } from '../storage/device.ts';
import { keepSentPhoto, preloadPhotos } from '../storage/photoCache.ts';
import { type ApiResult, type GroupEditError, type PhotoError, photoUrl } from '../sync/client.ts';
import { useApiClient } from '../sync/context.ts';
import { createGroupStore } from '../sync/groupStore.ts';
import { GroupHome } from './GroupHome.tsx';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';
import type { EditResult, GroupEdit, PhotoResult } from './view.ts';

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
  // Each edit answers the whole group, shown at once. A refusal or a lost answer reads the group again: the edit may have gone through, or another
  // phone made the same one, and the next try would be judged on a stale list.
  const [edits] = useState((): Omit<GroupEdit, 'online' | 'photos'> => {
    const shown = (result: ApiResult<GroupResponse, GroupEditError>): EditResult => {
      if (!result.ok) {
        void store.reread();
        return result;
      }
      store.applyGroup(result.value);
      return { ok: true };
    };
    // `sent`: the photo this phone sent, kept under its address before the group shows it.
    const photoShown = async (result: ApiResult<PhotoChangeResponse, PhotoError>, id: MemberId, sent?: Blob): Promise<PhotoResult> => {
      if (!result.ok) {
        void store.reread();
        return result;
      }
      const { undo, ...group } = result.value;
      const version = group.members.find((member) => member.id === id)?.photo;
      if (sent !== undefined && version !== undefined) {
        await keepSentPhoto(photoUrl(token, id, version), sent).catch(() => undefined);
      }
      store.applyGroup(group);
      return undo === undefined ? { ok: true } : { ok: true, undo };
    };
    return {
      renameGroup: async (title) => shown(await client.renameGroup(token, title)),
      addMember: async (member) => shown(await client.addMember(token, member)),
      renameMember: async (id, name) => shown(await client.renameMember(token, id, name)),
      setPhoto: async (id, photo) => photoShown(await client.setPhoto(token, id, photo), id, photo),
      removePhoto: async (id) => photoShown(await client.removePhoto(token, id), id),
      undoPhoto: async (id, undo) => photoShown(await client.undoPhoto(token, id, undo), id),
    };
  });
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const ready = state.status === 'ready';
  // After each read, the photos this phone lacks, so that they show offline (docs/decisions/photos-stockage.md).
  const readAt = ready ? state.readAt : undefined;
  const photos =
    ready && state.group.photos === true
      ? state.group.members.flatMap((member) => (member.photo === undefined ? [] : [photoUrl(token, member.id, member.photo)]))
      : [];
  const photoList = photos.join(' ');
  useEffect(() => {
    if (readAt !== undefined && photoList !== '') {
      void preloadPhotos(photoList.split(' '), (request) => fetch(request)).catch(() => undefined);
    }
  }, [readAt, photoList]);

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
          token={token}
          group={state.group}
          changes={state.changes}
          outbox={state.outbox}
          readAt={state.readAt}
          currentMember={state.currentMember}
          onChooseMember={store.chooseMember}
          readError={state.readError}
          onRetry={() => void store.sync()}
          enqueue={store.enqueue}
          edits={edits}
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
