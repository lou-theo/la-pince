import type { MemberId, PhotoUndo } from '@la-pince/core';
import { type ReactNode, useId, useRef, useState } from 'react';

import { photoErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import styles from './Balances.module.css';
import { Band, BandDetail, BandTitle, useBand } from './Band.tsx';
import { CloseIcon } from './FormFrame.tsx';
import sheet from './Me.module.css';
import { reducePhoto } from './reducePhoto.ts';
import { useMounted } from './useMounted.ts';
import { type GroupView, memberOf, type PhotoResult } from './view.ts';

/** What the band of a change of photo says: the photo leaving, the change made with its undo, or why it failed. */
type PhotoBandState =
  | { readonly kind: 'sending'; readonly change: 'set' | 'removed' }
  | {
      readonly kind: 'done';
      readonly change: 'set' | 'removed';
      /** Whose photo, named as when it changed. */
      readonly name: string;
      readonly undo?: PhotoUndo;
      /** Why the last try to undo it failed, “Annuler” staying. */
      readonly error?: string;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** A change of a member's photo from their sheet: choosing a picture, taking the photo away, undoing either, and the band that tells it. */
export interface PhotoEdit {
  readonly band: PhotoBandState | undefined;
  /** Whether a change or an undo is on its way, during which no other starts. */
  readonly busy: boolean;
  readonly choose: (file: Blob) => void;
  readonly remove: () => void;
  readonly undo: () => void;
}

/**
 * The state of a change of photo, living with the sheet: leaving it forgets the band, which goes after `BAND_DURATION` anyway. `onStart`: a change
 * starts, whose band takes the place of any other.
 */
export function usePhotoEdit(view: GroupView, id: MemberId, onStart: () => void): PhotoEdit {
  const [band, setBand] = useBand<PhotoBandState>();
  const [busy, setBusy] = useState(false);
  // A state is read at the next render: a second touch in the same frame would get through it.
  const working = useRef(false);
  const mounted = useMounted();
  const name = memberOf(view, id).name;

  const run = (work: () => Promise<void>) => {
    if (working.current) {
      return;
    }
    onStart();
    working.current = true;
    setBusy(true);
    void work().finally(() => {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    });
  };
  const shown = (change: 'set' | 'removed', result: PhotoResult) => {
    if (!mounted.current) {
      return;
    }
    if (result.ok) {
      setBand({ kind: 'done', change, name, ...(result.undo === undefined ? {} : { undo: result.undo }) });
    } else {
      setBand({ kind: 'failed', message: photoErrorMessage(result.error) });
    }
  };

  return {
    band,
    busy,
    choose: (file) => {
      run(async () => {
        setBand({ kind: 'sending', change: 'set' });
        const reduced = await reducePhoto(file);
        if (!reduced.ok) {
          if (mounted.current) {
            setBand({ kind: 'failed', message: photoErrorMessage(reduced.error) });
          }
          return;
        }
        shown('set', await view.edit.setPhoto(id, reduced.photo));
      });
    },
    remove: () => {
      run(async () => {
        setBand({ kind: 'sending', change: 'removed' });
        shown('removed', await view.edit.removePhoto(id));
      });
    },
    undo: () => {
      if (band?.kind !== 'done' || band.undo === undefined) {
        return;
      }
      const done = band;
      const { undo } = band;
      run(async () => {
        const result = await view.edit.undoPhoto(id, undo);
        if (!mounted.current) {
          return;
        }
        if (result.ok) {
          setBand(undefined);
        } else if (result.error === 'photo_changed') {
          // Another phone changed the photo since: never overwritten, and there is nothing left to undo.
          setBand({ kind: 'failed', message: photoErrorMessage(result.error) });
        } else {
          setBand({ ...done, error: photoErrorMessage(result.error) });
        }
      });
    },
  };
}

/**
 * The camera badge on the corner of a member's avatar, shown when the instance keeps photos (docs/decisions/edition-du-groupe.md, point i), greyed
 * offline. For a member without a photo it opens the phone's choice of a picture at once; for one with a photo, a sheet from the bottom offers
 * “Choisir une photo” or “Retirer la photo”. The input takes any picture, without `capture`, so that the phone offers its gallery and its camera.
 */
export function PhotoBadge({ view, id, edit }: { readonly view: GroupView; readonly id: MemberId; readonly edit: PhotoEdit }): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedBackdrop = useRef(false);
  const member = memberOf(view, id);
  const mine = id === view.me;
  const hasPhoto = view.photoOf(member) !== undefined;
  const disabled = !view.edit.online || edit.busy;

  const pick = () => {
    menu.current?.close();
    input.current?.click();
  };
  return (
    <>
      <button
        className={styles.photoBadge}
        type="button"
        aria-label={mine ? m.photo_change_me() : m.photo_change({ name: member.name })}
        aria-haspopup={hasPhoto ? 'dialog' : undefined}
        disabled={disabled}
        onClick={() => {
          if (hasPhoto) {
            menu.current?.showModal();
          } else {
            pick();
          }
        }}
      >
        <CameraIcon />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Emptied, so that the same picture chosen again is a change again.
          event.target.value = '';
          if (file !== undefined) {
            edit.choose(file);
          }
        }}
      />
      {hasPhoto ? (
        <dialog
          ref={menu}
          className={sheet.sheet}
          aria-labelledby={titleId}
          onPointerDown={(event) => {
            pressedBackdrop.current = event.target === menu.current;
          }}
          onClick={(event) => {
            // A touch on the backdrop lands on the dialog itself, its content filling the sheet.
            if (pressedBackdrop.current && event.target === menu.current) {
              menu.current.close();
            }
          }}
        >
          <div className={sheet.sheetContent}>
            <span className={sheet.handle} aria-hidden="true" />
            <div className={sheet.sheetHead}>
              <h2 id={titleId} className={sheet.sheetTitle}>
                {mine ? m.photo_menu_title_me() : m.photo_menu_title({ name: member.name })}
              </h2>
              <button
                className={sheet.close}
                type="button"
                aria-label={m.form_close()}
                onClick={() => {
                  menu.current?.close();
                }}
              >
                <CloseIcon />
              </button>
            </div>
            <button className={styles.photoChoice} type="button" disabled={disabled} onClick={pick}>
              {m.photo_choose()}
            </button>
            <button
              className={`${styles.photoChoice ?? ''} ${styles.photoRemove ?? ''}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                menu.current?.close();
                edit.remove();
              }}
            >
              {m.photo_remove()}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}

/** The band of a change of photo: “Photo de X changée” or “retirée”, with “Annuler” while the server gave a way to undo it. */
export function PhotoBand({ edit, mine }: { readonly edit: PhotoEdit; readonly mine: boolean }): ReactNode {
  const { band } = edit;
  if (band === undefined) {
    return null;
  }
  switch (band.kind) {
    case 'sending':
      return <Band nav={false}>{band.change === 'set' ? m.photo_sending() : m.photo_removing()}</Band>;
    case 'failed':
      return (
        <Band nav={false} alert>
          {band.message}
        </Band>
      );
    case 'done': {
      const title =
        band.change === 'set'
          ? mine
            ? m.photo_changed_me()
            : m.photo_changed({ name: band.name })
          : mine
            ? m.photo_removed_me()
            : m.photo_removed({ name: band.name });
      return (
        <Band
          nav={false}
          {...(band.undo === undefined
            ? {}
            : {
                action: {
                  text: edit.busy ? m.undo_cancelling() : m.undo_button(),
                  label: m.photo_undo_label(),
                  disabled: edit.busy,
                  onClick: edit.undo,
                },
              })}
        >
          <BandTitle>{title}</BandTitle>
          {band.error === undefined ? null : <BandDetail alert>{band.error}</BandDetail>}
        </Band>
      );
    }
  }
}

/** The camera of the badge and of the sheet to add a member. */
export function CameraIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
