import type { MemberId } from '@la-pince/core';
import { type MouseEvent, type PointerEvent, type ReactNode, type RefObject, useId, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import type { OperationView } from '../model/group.ts';
import { amountBound, type ListFilter, NO_FILTER } from '../model/listFilter.ts';
import { Avatar } from './Avatar.tsx';
import styles from './ListFilters.module.css';
import { type GroupView, memberOf, shortName } from './view.ts';

interface FilterSheetProps {
  readonly dialog: RefObject<HTMLDialogElement | null>;
  readonly view: GroupView;
  readonly filter: ListFilter;
  /** Operations the filters keep, counted on the button that closes the sheet. */
  readonly kept: readonly OperationView[];
  readonly onChange: (filter: ListFilter) => void;
  readonly onClose: () => void;
}

/**
 * The sheet of the filters, rising from the bottom, a native modal dialog: search by title, kind, who paid, who is involved, amounts and days. Each
 * change applies at once to the list behind; « Voir N dépenses », Escape or a touch on the backdrop close it, the filters staying.
 */
export function FilterSheet({ dialog, view, filter, kept, onChange, onClose }: FilterSheetProps): ReactNode {
  const titleId = useId();
  const backdrop = useBackdropClose(dialog);
  const set = (changes: Partial<ListFilter>) => {
    onChange({ ...filter, ...changes });
  };
  const close = () => {
    dialog.current?.close();
  };
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={(event) => {
        // React lets the close of the grid, inside, bubble up here.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      {...backdrop}
    >
      <div className={styles.sheetContent}>
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {m.filters_title()}
          </h2>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => {
              onChange(NO_FILTER);
            }}
          >
            {m.filters_clear()}
          </button>
        </div>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="search"
            value={filter.search}
            placeholder={m.filters_search()}
            aria-label={m.filters_search()}
            autoComplete="off"
            onChange={(event) => {
              set({ search: event.target.value });
            }}
          />
        </label>
        <div className={styles.row}>
          <h3 className={styles.rowTitle}>{m.filters_kind()}</h3>
          <Segmented
            label={m.filters_kind()}
            value={filter.kind}
            options={[
              ['all', m.filters_kind_all()],
              ['expense', m.filters_kind_expense()],
              ['reimbursement', m.filters_kind_reimbursement()],
            ]}
            onChange={(kind) => {
              set({ kind });
            }}
          />
        </div>
        <People
          view={view}
          title={m.filters_payers()}
          add={m.filters_add_payer()}
          chosen={filter.payers}
          onChange={(payers) => {
            set({ payers });
          }}
        />
        <People
          view={view}
          title={m.filters_involved()}
          add={m.filters_add_involved()}
          chosen={filter.involved}
          onChange={(involved) => {
            set({ involved });
          }}
        >
          {/* With one member, all of them or at least one is the same. */}
          {filter.involved.length < 2 ? null : (
            <Segmented
              label={m.filters_involved()}
              value={filter.involvedMode}
              options={[
                ['all', m.filters_involved_all()],
                ['any', m.filters_involved_any()],
              ]}
              onChange={(involvedMode) => {
                set({ involvedMode });
              }}
            />
          )}
        </People>
        <div className={styles.pair}>
          <AmountBox
            label={m.filters_min()}
            placeholder={m.filters_min_placeholder()}
            value={filter.minAmount}
            onChange={(minAmount) => {
              set({ minAmount });
            }}
          />
          <AmountBox
            label={m.filters_max()}
            placeholder={m.filters_max_placeholder()}
            value={filter.maxAmount}
            onChange={(maxAmount) => {
              set({ maxAmount });
            }}
          />
        </div>
        <div className={styles.pair}>
          <DayBox
            label={m.filters_from()}
            value={filter.from}
            onChange={(from) => {
              set({ from });
            }}
          />
          <DayBox
            label={m.filters_to()}
            value={filter.to}
            onChange={(to) => {
              set({ to });
            }}
          />
        </div>
        <button className={styles.submit} type="button" onClick={close}>
          {showLabel(kept)}
        </button>
      </div>
    </dialog>
  );
}

/** The lines kept, named « dépenses » or « remboursements » when they are all of one kind, « résultats » when mixed. */
function showLabel(kept: readonly OperationView[]): string {
  const count = kept.length;
  if (count === 0) {
    return m.filters_show_none();
  }
  if (kept.every((operation) => operation.kind === 'reimbursement')) {
    return count === 1 ? m.filters_show_reimbursements_one() : m.filters_show_reimbursements({ count: String(count) });
  }
  if (kept.every((operation) => operation.kind === 'expense')) {
    return count === 1 ? m.filters_show_one() : m.filters_show({ count: String(count) });
  }
  return m.filters_show_mixed({ count: String(count) });
}

/** Closes a modal dialog on a touch on its backdrop, which lands on the dialog itself, its content filling it; a press begun inside does not count. */
function useBackdropClose(dialog: RefObject<HTMLDialogElement | null>) {
  const pressed = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressed.current = event.target === dialog.current;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (pressed.current && event.target === dialog.current) {
        dialog.current.close();
      }
    },
  };
}

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}

/** A small switch between a few choices, the one in force pressed. */
function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          className={styles.segment}
          type="button"
          aria-pressed={option === value}
          onClick={() => {
            onChange(option);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

interface PeopleProps {
  readonly view: GroupView;
  readonly title: string;
  /** Label of the round button that opens the grid of the members. */
  readonly add: string;
  readonly chosen: readonly MemberId[];
  readonly onChange: (chosen: MemberId[]) => void;
  /** What goes at the end of the title's line. */
  readonly children?: ReactNode;
}

/** The members chosen only, each a badge whose cross removes them, then « Ajouter », which opens the grid of the whole group. */
function People({ view, title, add, chosen, onChange, children }: PeopleProps) {
  const picker = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The choice in the grid, applied by « Valider » only, taken from the members chosen at each opening.
  const [draft, setDraft] = useState<readonly MemberId[]>(chosen);
  return (
    <section className={styles.people} aria-labelledby={titleId}>
      <div className={styles.row}>
        <h3 id={titleId} className={styles.rowTitle}>
          {title}
        </h3>
        {children}
      </div>
      <ul className={styles.chosen}>
        {chosen.map((id) => {
          const member = memberOf(view, id);
          return (
            <li key={id}>
              <button
                className={styles.badge}
                type="button"
                aria-label={id === view.me ? m.filters_remove_me() : m.filters_remove({ name: memberOf(view, id).name })}
                onClick={() => {
                  onChange(chosen.filter((other) => other !== id));
                }}
              >
                <span className={styles.badgeAvatar}>
                  <Avatar member={member} view={view} />
                  <span className={styles.remove} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M7 7l10 10M17 7L7 17" />
                    </svg>
                  </span>
                </span>
                <span className={styles.badgeName}>{shortName(view, id)}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            className={styles.badge}
            type="button"
            aria-label={add}
            aria-haspopup="dialog"
            onClick={() => {
              setDraft(chosen);
              picker.current?.showModal();
            }}
          >
            <span className={styles.addCircle} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className={styles.badgeName}>{m.filters_add()}</span>
          </button>
        </li>
      </ul>
      <PeoplePicker dialog={picker} view={view} title={title} draft={draft} onDraft={setDraft} onChange={onChange} />
    </section>
  );
}

interface PeoplePickerProps {
  readonly dialog: RefObject<HTMLDialogElement | null>;
  readonly view: GroupView;
  readonly title: string;
  readonly draft: readonly MemberId[];
  readonly onDraft: (draft: readonly MemberId[]) => void;
  readonly onChange: (chosen: MemberId[]) => void;
}

/**
 * The grid of the group's members, five a row, over the sheet: a touch picks or drops one, « Aucun » drops them all, « Valider · N personnes »
 * applies the choice; Escape or a touch on the backdrop leave it as it was.
 */
function PeoplePicker({ dialog, view, title, draft, onDraft, onChange }: PeoplePickerProps) {
  const titleId = useId();
  const backdrop = useBackdropClose(dialog);
  const close = () => {
    dialog.current?.close();
  };
  // The members in the order of the group, whatever the order of the touches; those who left it, which the grid cannot show, stay picked until
  // « Aucun ».
  const picked = [
    ...view.members.filter((member) => draft.includes(member.id)).map((member) => member.id),
    ...draft.filter((id) => !view.members.some((member) => member.id === id)),
  ];
  return (
    <dialog ref={dialog} className={styles.sheet} aria-labelledby={titleId} {...backdrop}>
      <div className={styles.sheetContent}>
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {title}
          </h2>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => {
              onDraft([]);
            }}
          >
            {m.filters_pick_none()}
          </button>
        </div>
        <ul className={styles.grid}>
          {view.members.map((member) => {
            const pressed = draft.includes(member.id);
            return (
              <li key={member.id}>
                <button
                  className={styles.cell}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={view.nameOf(member.id)}
                  title={view.nameOf(member.id)}
                  onClick={() => {
                    onDraft(pressed ? draft.filter((id) => id !== member.id) : [...draft, member.id]);
                  }}
                >
                  <span className={styles.cellAvatar}>
                    <Avatar member={member} view={view} />
                    {pressed ? (
                      <span className={styles.remove} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 12.5l4 4L18 8" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.cellName}>{shortName(view, member.id)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          className={styles.submit}
          type="button"
          onClick={() => {
            onChange(picked);
            close();
          }}
        >
          {picked.length === 0
            ? m.filters_pick_submit_none()
            : picked.length === 1
              ? m.filters_pick_submit_one()
              : m.filters_pick_submit({ count: String(picked.length) })}
        </button>
      </div>
    </dialog>
  );
}

function AmountBox({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const unreadable = value.trim() !== '' && amountBound(value) === undefined;
  return (
    <label className={styles.box}>
      <span className={styles.boxLabel}>{label}</span>
      <input
        className={styles.boxInput}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={unreadable ? true : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function DayBox({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <label className={styles.box}>
      <span className={styles.boxLabel}>{label}</span>
      <input
        className={styles.boxInput}
        type="date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
