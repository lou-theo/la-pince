import { type ReactNode, type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { browserInstallPlatform, type InstallPlatform } from '../install/platform.ts';
import { detectInstallContext, guideOf, type InstallContext, type InstallGuide as Guide } from '../model/install.ts';
import { rememberInstallOffered, wasInstallOffered } from '../storage/device.ts';
import styles from './Install.module.css';
import { type BuiltGuide, builtGuides, InstallGuide } from './InstallGuide.tsx';
import layout from './Layout.module.css';

interface InstallOfferProps {
  /** Title of the group shown on the phone drawn by the guide; the app's name without a group. */
  readonly title?: string;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: InstallPlatform;
}

// One instance, as `useSyncExternalStore` wants the same subscribe function at each render.
let browser: InstallPlatform | undefined;

const built: ReadonlySet<string> = new Set(builtGuides);
const isBuilt = (guide: Guide | 'none' | 'waiting'): guide is BuiltGuide => built.has(guide);

/** The browser's APIs, the context of the page and the guide that fits it at the moment. */
function useBrowserGuide(given: InstallPlatform | undefined) {
  const platform = given ?? (browser ??= browserInstallPlatform());
  const [context] = useState(() => detectInstallContext(platform.environment()));
  const prompt = useSyncExternalStore(platform.onPromptChange, platform.prompt);
  return { platform, context, guide: guideOf(context, prompt) };
}

/** Opens the dialog as a modal once `open` turns true, calling `onShow` then. */
function useModal(dialog: RefObject<HTMLDialogElement | null>, open: boolean, onShow?: () => void): void {
  useEffect(() => {
    const element = dialog.current;
    if (open && element?.open === false) {
      onShow?.();
      element.showModal();
    }
  }, [dialog, open, onShow]);
}

interface GuideOfBrowserProps {
  readonly guide: BuiltGuide;
  readonly context: InstallContext;
  readonly title: string;
  readonly platform: InstallPlatform;
  /** Another guide to show, when the browser could not open its install window. */
  readonly onGuide: (guide: BuiltGuide) => void;
  readonly onClose: () => void;
}

/** The guide in its dialog; the browser unable to open its install window, Chrome still installs from its menu, another browser is one that cannot. */
function GuideOfBrowser({ guide, context, title, platform, onGuide, onClose }: GuideOfBrowserProps): ReactNode {
  return (
    <InstallGuide
      key={guide}
      guide={guide}
      maybeInstalled={context === 'android_chromium'}
      title={title}
      host={location.host}
      install={platform.install}
      onUnavailable={() => {
        onGuide(context === 'android_chrome' ? 'android_menu' : 'cannot');
      }}
      onClose={onClose}
    />
  );
}

// `waiting` for the guide to be known, `done` once nothing is to offer or the sheet closed: never offered again by this screen.
type Phase = { readonly name: 'waiting' | 'offer' | 'done' } | { readonly name: 'guide'; readonly guide: BuiltGuide };

/**
 * The offer to install the app, over the screen at the first arrival in this browser on a phone, then the guide of its browser: shown once,
 * whatever comes of it. Where no guide exists yet for the browser, nothing is offered, and the offer stays to make.
 */
export function InstallOffer({ title, platform: given }: InstallOfferProps): ReactNode {
  const { platform, context, guide } = useBrowserGuide(given);
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'waiting' });
  // Chrome may hand its window a few seconds after the start: the offer opens then. Once the guide is known, it is decided for this screen, so
  // that a window coming later never covers what the person is doing.
  if (phase.name === 'waiting' && guide !== 'waiting') {
    setPhase({ name: isBuilt(guide) && !wasInstallOffered() ? 'offer' : 'done' });
  }
  const open = phase.name === 'offer' || phase.name === 'guide';

  // Remembered as soon as shown: a reload or a guide left halfway does not offer it again.
  useModal(dialog, open, rememberInstallOffered);

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
        <GuideOfBrowser
          guide={phase.guide}
          context={context}
          title={title ?? m.app_name()}
          platform={platform}
          onGuide={(next) => {
            setPhase({ name: 'guide', guide: next });
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
  const { platform, context, guide } = useBrowserGuide(given);
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<BuiltGuide | undefined>(undefined);
  useModal(dialog, shown !== undefined);

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
          <GuideOfBrowser guide={shown} context={context} title={title} platform={platform} onGuide={setShown} onClose={close} />
        </dialog>
      )}
    </>
  );
}
