import type { MemberId } from '@la-pince/core';
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { compactDay, localDay } from '../model/dates.ts';
import {
  amountBound,
  dayBound,
  filterOperations,
  hasAdvanced,
  type ListFilter,
  NO_FILTER,
  normalized,
  paidByMe,
  togglePaidByMe,
} from '../model/listFilter.ts';
import { formatCents } from '../model/money.ts';
import { Avatar } from './Avatar.tsx';
import { FilterSheet } from './FilterSheet.tsx';
import { CloseIcon } from './FormFrame.tsx';
import styles from './ListFilters.module.css';
import { type GroupView, memberOf, shortName } from './view.ts';

interface ListFilterBarProps {
  readonly view: GroupView;
  readonly filter: ListFilter;
  readonly onChange: (filter: ListFilter) => void;
}

/**
 * Filters of the list, in the band under the group's title: the pills « Me concerne », « Payé par moi » and « Filtres », or, once a criterion of
 * the sheet is set, a one-line summary of the filters that opens the sheet again and a cross that clears them all.
 */
export function ListFilterBar({ view, filter, onChange }: ListFilterBarProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  // The pill « Filtres » or the summary, whichever shows: the sheet can turn one into the other.
  const opener = useRef<HTMLButtonElement>(null);
  const kept = useMemo(() => filterOperations(view.operations, filter, view.me), [view.operations, filter, view.me]);
  const open = () => {
    dialog.current?.showModal();
  };
  return (
    <>
      {hasAdvanced(filter, view.me) ? (
        <Summary
          view={view}
          filter={filter}
          opener={opener}
          onOpen={open}
          onClear={() => {
            onChange(NO_FILTER);
          }}
        />
      ) : (
        <div className={styles.pills} role="group" aria-label={m.filters_label()}>
          <button
            className={styles.pill}
            type="button"
            aria-pressed={filter.involvesMe}
            onClick={() => {
              onChange({ ...filter, involvesMe: !filter.involvesMe });
            }}
          >
            {filter.involvesMe ? <CheckIcon /> : null}
            {m.filters_involves_me()}
          </button>
          <button
            className={styles.pill}
            type="button"
            aria-pressed={paidByMe(filter, view.me)}
            onClick={() => {
              onChange(togglePaidByMe(filter, view.me));
            }}
          >
            {paidByMe(filter, view.me) ? <CheckIcon /> : null}
            {m.filters_paid_by_me()}
          </button>
          <button ref={opener} className={styles.pill} type="button" aria-haspopup="dialog" onClick={open}>
            <SlidersIcon />
            {m.filters_open()}
          </button>
        </div>
      )}
      <FilterSheet
        dialog={dialog}
        view={view}
        filter={filter}
        kept={kept}
        onChange={onChange}
        onClose={() => {
          // Browsers give the focus back to the opener by themselves, unless the sheet replaced it; a test environment may not.
          opener.current?.focus();
        }}
      />
    </>
  );
}

interface SummaryProps {
  readonly view: GroupView;
  readonly filter: ListFilter;
  readonly opener: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
  readonly onClear: () => void;
}

// Room kept for « +N » at the end of the line, in rem: wider than « +9 » and the gap before it.
const MORE_ROOM = 2.75;

/** The filters set, as small square tags on one line, those beyond the room hidden and counted in « +N », the first one always shown. */
function Summary({ view, filter, opener, onOpen, onClear }: SummaryProps) {
  const [today] = useState(() => localDay(new Date()));
  const tags = summaryTags(view, filter, today);
  const box = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState(0);
  // Measured against the whole width of the button, which « +N » does not change: tags keep their place on one line, those hidden included.
  useLayoutEffect(() => {
    const button = opener.current;
    const element = box.current;
    if (button === null || element === null) {
      return;
    }
    const count = () => {
      const ends = [...element.children].map((tag) => (tag as HTMLElement).offsetLeft + (tag as HTMLElement).offsetWidth);
      const room = button.clientWidth;
      if (ends.every((end) => end <= room)) {
        setHidden(0);
        return;
      }
      const rem = Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));
      const shown = ends.filter((end) => end <= room - MORE_ROOM * rem).length;
      setHidden(ends.length - Math.max(shown, 1));
    };
    count();
    const observer = new ResizeObserver(count);
    observer.observe(button);
    return () => {
      observer.disconnect();
    };
  }, [opener, tags.length, filter]);
  return (
    <div className={styles.summary}>
      <button
        ref={opener}
        className={styles.summaryButton}
        type="button"
        aria-haspopup="dialog"
        aria-label={`${m.filters_edit()} ${tags.map((tag) => tag.text).join(', ')}`}
        onClick={onOpen}
      >
        <span ref={box} className={styles.tags}>
          {tags.map((tag, index) => (
            <span
              key={tag.key}
              className={tag.strong ? `${styles.tag ?? ''} ${styles.strong ?? ''}` : styles.tag}
              style={index >= tags.length - hidden ? { visibility: 'hidden' } : undefined}
            >
              {tag.content}
            </span>
          ))}
        </span>
        {hidden > 0 ? <span className={`${styles.tag ?? ''} ${styles.strong ?? ''}`}>{m.filters_more({ count: String(hidden) })}</span> : null}
      </button>
      <button className={styles.clear} type="button" aria-label={m.filters_reset()} onClick={onClear}>
        <CloseIcon />
      </button>
    </div>
  );
}

interface Tag {
  readonly key: string;
  readonly content: ReactNode;
  /** What the tag says, in the label of the summary. */
  readonly text: string;
  /** A value said alone (an amount, a day), bolder than a label followed by faces. */
  readonly strong: boolean;
}

/** One tag per filter set, in the order of the sheet, « Me concerne » first since it has no place there. */
function summaryTags(view: GroupView, filter: ListFilter, today: string): Tag[] {
  const tags: Tag[] = [];
  const value = (key: string, text: string) => {
    tags.push({ key, content: text, text, strong: true });
  };
  const people = (key: string, label: string, members: readonly MemberId[]) => {
    const names = members.map((id) => shortName(view, id, 'object')).join(', ');
    tags.push({ key, content: <Faces view={view} label={label} members={members} />, text: `${label} ${names}`, strong: false });
  };
  if (filter.involvesMe) {
    value('me', m.filters_involves_me());
  }
  const search = filter.search.trim();
  if (normalized(search) !== '') {
    value('search', m.filters_tag_search({ text: search }));
  }
  if (filter.kind !== 'all') {
    value('kind', filter.kind === 'expense' ? m.filters_kind_expense() : m.filters_kind_reimbursement());
  }
  if (filter.payers.length > 0) {
    people('payers', m.filters_tag_payers(), filter.payers);
  }
  if (filter.involved.length > 0) {
    // « Au moins un » said only where it changes something, from two members.
    people(
      'involved',
      filter.involvedMode === 'any' && filter.involved.length > 1 ? m.filters_tag_involved_any() : m.filters_tag_involved(),
      filter.involved,
    );
  }
  const min = amountBound(filter.minAmount);
  if (min !== undefined) {
    value('min', m.filters_tag_min({ amount: formatCents(min) }));
  }
  const max = amountBound(filter.maxAmount);
  if (max !== undefined) {
    value('max', m.filters_tag_max({ amount: formatCents(max) }));
  }
  const from = dayBound(filter.from);
  if (from !== undefined) {
    value('from', m.filters_tag_from({ day: compactDay(from, today) }));
  }
  const to = dayBound(filter.to);
  if (to !== undefined) {
    value('to', m.filters_tag_to({ day: compactDay(to, today) }));
  }
  return tags;
}

// Faces shown in a tag before « +N »: more would push the other tags out.
const MAX_FACES = 3;

/** « De » or « Pour » and the faces of the members, overlapping. */
function Faces({ view, label, members }: { readonly view: GroupView; readonly label: string; readonly members: readonly MemberId[] }) {
  const more = members.length - MAX_FACES;
  return (
    <>
      <span className={styles.tagLabel}>{label}</span>
      <span className={styles.faces}>
        {members.slice(0, MAX_FACES).map((id) => (
          <span key={id} className={styles.face}>
            <Avatar member={memberOf(view, id)} view={view} />
          </span>
        ))}
      </span>
      {more > 0 ? <span className={styles.facesMore}>{m.filters_more({ count: String(more) })}</span> : null}
    </>
  );
}

function CheckIcon() {
  return (
    <svg
      className={styles.pillIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg className={styles.pillIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}
