import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { browserInstallPlatform, type InstallPlatform } from '../install/platform.ts';
import { detectInstallContext, guideOf, type InstallContext, type InstallGuide as Guide } from '../model/install.ts';
import { rememberInstallOffered, wasInstallOffered } from '../storage/device.ts';
import styles from './Install.module.css';
import { type BuiltGuide, InstallGuide } from './InstallGuide.tsx';
import layout from './Layout.module.css';

interface InstallOfferProps {
  /** Title of the group shown on the phone drawn by the guide; the app's name without a group. */
  readonly title?: string;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: InstallPlatform;
}

// One instance, as `useSyncExternalStore` wants the same subscribe function at each render.
let browser: InstallPlatform | undefined;

const builtGuides: ReadonlySet<string> = new Set<BuiltGuide>(['android_button', 'android_menu', 'ios_safari', 'ios_safari_26', 'ios_share']);
const isBuilt = (guide: Guide | 'none' | 'waiting'): guide is BuiltGuide => builtGuides.has(guide);

// The browser could not open its install window: Chrome still installs from its menu, another browser has no guide left.
const fallbackOf = (context: InstallContext): BuiltGuide | undefined => (context === 'android_chrome' ? 'android_menu' : undefined);

const sharedPlatform = (given: InstallPlatform | undefined): InstallPlatform => given ?? (browser ??= browserInstallPlatform());

// `waiting` for the guide to be known, `done` once nothing is to offer or the sheet closed: never offered again by this screen.
type Phase = { readonly name: 'waiting' | 'offer' | 'done' } | { readonly name: 'guide'; readonly guide: BuiltGuide };

/**
 * The offer to install the app, over the screen at the first arrival in this browser on a phone, then the guide of its browser: shown once,
 * whatever comes of it. Where no guide exists yet for the browser, nothing is offered, and the offer stays to make.
 */
export function InstallOffer({ title, platform: given }: InstallOfferProps): ReactNode {
  const platform = sharedPlatform(given);
  const [context] = useState(() => detectInstallContext(platform.environment()));
  const prompt = useSyncExternalStore(platform.onPromptChange, platform.prompt);
  const guide = guideOf(context, prompt);
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'waiting' });
  // Chrome may hand its window a few seconds after the start: the offer opens then. Once the guide is known, it is decided for this screen, so
  // that a window coming later never covers what the person is doing.
  if (phase.name === 'waiting' && guide !== 'waiting') {
    setPhase({ name: isBuilt(guide) && !wasInstallOffered() ? 'offer' : 'done' });
  }
  const open = phase.name === 'offer' || phase.name === 'guide';

  useEffect(() => {
    const element = dialog.current;
    if (open && element?.open === false) {
      // Remembered as soon as shown: a reload or a guide left halfway does not offer it again.
      rememberInstallOffered();
      element.showModal();
    }
  }, [open]);

  const close = () => {
    dialog.current?.close();
  };

  if (!open) {
    return null;
  }
  return (
    <dialog
      ref={dialog}
      className={phase.name === 'guide' ? `${styles.sheet ?? ''} ${styles.tall ?? ''}` : styles.sheet}
      aria-label={phase.name === 'guide' ? m.install_guide_title() : m.install_offer_title()}
      onClose={() => {
        setPhase({ name: 'done' });
      }}
    >
      {phase.name === 'offer' ? (
        <div className={styles.offer}>
          <span className={styles.handle} aria-hidden="true" />
          <div className={styles.hero} aria-hidden="true">
            <span className={styles.halo} />
            <span className={styles.hop}>
              <img className={styles.bob} src="/logo.svg" alt="" />
            </span>
          </div>
          <h2 className={styles.offerTitle}>
            <span>{m.install_offer_title()}</span>
            <span className={styles.follow}>{m.install_offer_follow()}</span>
          </h2>
          <p className={styles.offerText}>{m.install_offer_explanation()}</p>
          <button
            className={`${styles.primary ?? ''} ${styles.start ?? ''}`}
            type="button"
            onClick={() => {
              // The guide of the moment: Chrome may have handed its window since the offer opened.
              const now = guideOf(context, platform.prompt());
              if (isBuilt(now)) {
                setPhase({ name: 'guide', guide: now });
              } else {
                close();
              }
            }}
          >
            {m.install_offer_start()}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <button className={styles.later} type="button" onClick={close}>
            {m.install_offer_later()}
          </button>
        </div>
      ) : null}
      {phase.name === 'guide' ? (
        <InstallGuide
          key={phase.guide}
          guide={phase.guide}
          title={title ?? m.app_name()}
          host={location.host}
          install={platform.install}
          onUnavailable={() => {
            const fallback = fallbackOf(context);
            if (fallback === undefined) {
              close();
            } else {
              setPhase({ name: 'guide', guide: fallback });
            }
          }}
          onClose={close}
        />
      ) : null}
    </dialog>
  );
}

interface InstallGuideLinkProps {
  /** Title of the group shown on the phone drawn by the guide. */
  readonly title: string;
  readonly label: string;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: InstallPlatform;
}

/**
 * A link to the guide of this browser, for a screen that needs the app installed (the notifications on an iPhone): the guide opens at once,
 * without the offer, as often as asked. Nothing where no guide fits.
 */
export function InstallGuideLink({ title, label, platform: given }: InstallGuideLinkProps): ReactNode {
  const platform = sharedPlatform(given);
  const [context] = useState(() => detectInstallContext(platform.environment()));
  const prompt = useSyncExternalStore(platform.onPromptChange, platform.prompt);
  const guide = guideOf(context, prompt);
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<BuiltGuide | undefined>(undefined);

  useEffect(() => {
    const element = dialog.current;
    if (shown !== undefined && element?.open === false) {
      element.showModal();
    }
  }, [shown]);

  const close = () => {
    dialog.current?.close();
  };

  if (!isBuilt(guide) && shown === undefined) {
    return null;
  }
  return (
    <>
      <button
        className={layout.link}
        type="button"
        onClick={() => {
          if (isBuilt(guide)) {
            setShown(guide);
          }
        }}
      >
        {label}
      </button>
      {shown === undefined ? null : (
        <dialog
          ref={dialog}
          className={`${styles.sheet ?? ''} ${styles.tall ?? ''}`}
          aria-label={m.install_guide_title()}
          onClose={() => {
            setShown(undefined);
          }}
        >
          <InstallGuide
            key={shown}
            guide={shown}
            title={title}
            host={location.host}
            install={platform.install}
            onUnavailable={() => {
              const fallback = fallbackOf(context);
              if (fallback === undefined) {
                close();
              } else {
                setShown(fallback);
              }
            }}
            onClose={close}
          />
        </dialog>
      )}
    </>
  );
}
