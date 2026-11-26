import { type ReactNode, useEffect, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import type { InstallOutcome } from '../install/platform.ts';
import type { InstallGuide as InstallGuideOf } from '../model/install.ts';
import { CannotInstall } from './CannotInstall.tsx';
import styles from './Install.module.css';
import {
  addPoint,
  AddToHomeScreen,
  AndroidBrowser,
  AndroidHomeScreen,
  AndroidInstallWindow,
  AppInstallSheet,
  BrowserMenu,
  ChromeIosBrowser,
  chromeShare,
  InstallScene,
  IosHomeScreen,
  type SafariBar,
  SafariBarChoice,
  SafariBrowser,
  SafariMenu,
  safariMenuShare,
  safariPoints,
  type ScenePoint,
  sharePoints,
  ShareSheet,
} from './InstallScene.tsx';
import { useMounted } from './useMounted.ts';

/** The guides built so far; the others offer nothing yet. */
export const builtGuides = [
  'android_button',
  'android_menu',
  'android_firefox',
  'cannot',
  'ios_safari',
  'ios_safari_26',
  'ios_share',
] as const satisfies readonly InstallGuideOf[];
export type BuiltGuide = (typeof builtGuides)[number];

/** The bars of Safari 26 or later the guide tells apart, chosen at its first step. */
type ChosenBar = Exclude<SafariBar, 'classic'>;

type Step = {
  readonly instruction: string;
  readonly note?: string | undefined;
} & (
  | {
      readonly choice?: false;
      readonly tap: ScenePoint;
      readonly ripple?: 'light' | 'green' | undefined;
      readonly swipe?: boolean | undefined;
      readonly screen: ReactNode;
    }
  // The choice of Safari's bar, in place of the phone drawn.
  | { readonly choice: true }
);

interface Drawn {
  readonly title: string;
  readonly host: string;
}

// Where La Pince taps, in the screen's units of `InstallScene`; on a wide button, at its end, its words left readable.
const sheetButton = { x: 140, y: 305 };
const windowButton = { x: 133, y: 186 };
const homeIcon = { x: 29, y: 199 };
const menuDots = { x: 168, y: 16 };
const menuItem = { x: 150, y: 100 };

// The window of Android's home screen, in the system's color rather than Chrome's blue.
const systemAccent = '#5a3fb0';

const installWindow = (host: string, appear = false) => (
  <AndroidInstallWindow
    host={host}
    label={m.install_scene_window_title()}
    cancel={m.install_scene_cancel()}
    install={m.install_guide_install()}
    appear={appear}
  />
);

/**
 * The steps through the Share sheet of an iPhone, from the page in `browser` once Share is reached: scroll to its entry `entry`, touch it, add, and
 * open the app from the home screen; under Safari 26 or later, its switch to open as a web app left on.
 */
function shareSteps(
  { title, host }: Drawn,
  browser: ReactNode,
  {
    entry,
    scroll,
    scrollNote,
    touch,
    webApp,
  }: { readonly entry: string; readonly scroll: string; readonly scrollNote?: string | undefined; readonly touch: string; readonly webApp: boolean },
): readonly Step[] {
  const sheet = (scrolled: 'moving' | 'scrolled') => (
    <>
      {browser}
      <ShareSheet host={host} copy={m.install_scene_copy()} entry={entry} scroll={scrolled} />
    </>
  );
  const add = (
    <AddToHomeScreen
      host={host}
      cancel={m.install_scene_cancel()}
      add={m.install_scene_add()}
      webApp={webApp ? m.install_scene_web_app() : undefined}
    />
  );
  return [
    { instruction: scroll, note: scrollNote, tap: sharePoints.swipe, swipe: true, screen: sheet('moving') },
    { instruction: touch, tap: sharePoints.entry, ripple: 'green', screen: sheet('scrolled') },
    { instruction: webApp ? m.install_ios_add_web_app() : m.install_ios_add(), tap: addPoint, ripple: 'green', screen: add },
    { instruction: m.install_step_open(), tap: homeIcon, ripple: 'green', screen: <IosHomeScreen title={title} /> },
  ];
}

/** The steps of an iPhone's guide: Safari before 26 by Share in its bar; Safari 26 or later by the bar chosen first; Chrome and others by Share. */
function iosStepsOf(guide: 'ios_safari' | 'ios_safari_26' | 'ios_share', drawn: Drawn, bar: ChosenBar): readonly Step[] {
  const { title, host } = drawn;
  const shareSheet = (appear: 'slide' | 'grow', entry: string) => (
    <ShareSheet host={host} copy={m.install_scene_copy()} entry={entry} appear={appear} />
  );
  if (guide === 'ios_share') {
    const browser = <ChromeIosBrowser host={host} title={title} />;
    const entry = m.install_scene_add_home_screen();
    return [
      {
        instruction: m.install_share_address(),
        tap: chromeShare,
        ripple: 'green',
        screen: (
          <>
            {browser}
            {shareSheet('grow', entry)}
          </>
        ),
      },
      ...shareSteps(drawn, browser, { entry, scroll: m.install_share_scroll(), touch: m.install_share_row(), webApp: false }),
    ];
  }
  const shown: SafariBar = guide === 'ios_safari' ? 'classic' : bar;
  const browser = <SafariBrowser host={host} title={title} bar={shown} />;
  const entry = m.install_scene_home_screen();
  const throughShare = shareSteps(drawn, browser, {
    entry,
    scroll: m.install_ios_scroll(),
    scrollNote: m.install_ios_scroll_note(),
    touch: m.install_ios_home_row(),
    webApp: guide === 'ios_safari_26',
  });
  const toShare: readonly Step[] =
    shown === 'compact'
      ? [
          {
            instruction: m.install_ios_more(),
            tap: safariPoints.more,
            ripple: 'green',
            screen: (
              <>
                {browser}
                <SafariMenu share={m.install_scene_share()} />
              </>
            ),
          },
          {
            instruction: m.install_ios_share_row(),
            tap: safariMenuShare,
            ripple: 'green',
            screen: (
              <>
                {browser}
                <SafariMenu share={m.install_scene_share()} flash />
                {shareSheet('slide', entry)}
              </>
            ),
          },
        ]
      : [
          {
            instruction: m.install_ios_share_bar(),
            note: m.install_ios_share_bar_note(),
            tap: safariPoints.share(shown),
            ripple: 'green',
            screen: (
              <>
                {browser}
                {shareSheet('slide', entry)}
              </>
            ),
          },
        ];
  const choice: readonly Step[] =
    guide === 'ios_safari_26' ? [{ instruction: m.install_ios_layout(), note: m.install_ios_layout_note(), choice: true }] : [];
  return [...choice, ...toShare, ...throughShare];
}

/**
 * The steps of Firefox on Android, by its ⋮ menu and « Plus » to the entry that installs the app, then the window of Android's home screen; and
 * those of the shortcut a browser that cannot install still makes, by its menu and its entry to add the page to the home screen.
 */
function otherAndroidSteps(guide: 'android_firefox' | 'cannot', title: string, browser: ReactNode): readonly Step[] {
  const addWindow = (
    <AndroidInstallWindow
      label={m.install_scene_add_home_screen()}
      cancel={m.install_scene_cancel()}
      install={m.install_scene_add()}
      accent={systemAccent}
    />
  );
  const withBrowser = (over: ReactNode) => (
    <>
      {browser}
      {over}
    </>
  );
  if (guide === 'cannot') {
    const item = m.install_scene_add_home_screen();
    return [
      {
        instruction: m.install_menu_step_menu(),
        note: m.install_shortcut_menu_note(),
        tap: menuDots,
        ripple: 'green',
        screen: withBrowser(<BrowserMenu item={item} appear />),
      },
      {
        instruction: m.install_shortcut_item(),
        note: m.install_shortcut_item_note(),
        tap: menuItem,
        ripple: 'green',
        screen: withBrowser(<BrowserMenu item={item} flash />),
      },
      { instruction: m.install_shortcut_add(), tap: windowButton, screen: withBrowser(addWindow) },
    ];
  }
  const more = m.install_scene_more();
  return [
    {
      instruction: m.install_menu_step_menu(),
      note: m.install_firefox_menu_note(),
      tap: menuDots,
      ripple: 'green',
      screen: withBrowser(<BrowserMenu item={more} glyph="unfold" appear />),
    },
    {
      instruction: m.install_firefox_more(),
      tap: menuItem,
      ripple: 'green',
      screen: withBrowser(<BrowserMenu item={more} glyph="unfold" flash />),
    },
    {
      instruction: m.install_firefox_item(),
      tap: menuItem,
      ripple: 'green',
      screen: withBrowser(<BrowserMenu item={m.install_scene_firefox_item()} flash />),
    },
    { instruction: m.install_firefox_add(), tap: windowButton, screen: withBrowser(addWindow) },
    { instruction: m.install_step_open(), tap: homeIcon, screen: <AndroidHomeScreen title={title} /> },
  ];
}

function stepsOf(guide: BuiltGuide, drawn: Drawn, bar: ChosenBar): readonly Step[] {
  if (guide === 'ios_safari' || guide === 'ios_safari_26' || guide === 'ios_share') {
    return iosStepsOf(guide, drawn, bar);
  }
  const { title, host } = drawn;
  const browser = <AndroidBrowser host={host} title={title} />;
  const home = <AndroidHomeScreen title={title} />;
  if (guide === 'android_button') {
    return [
      {
        instruction: m.install_button_step_button(),
        tap: sheetButton,
        screen: (
          <>
            {browser}
            <AppInstallSheet title={m.install_scene_install_app()} install={m.install_guide_install()} />
            {installWindow(host, true)}
          </>
        ),
      },
      {
        instruction: m.install_button_step_window(),
        tap: windowButton,
        screen: (
          <>
            {browser}
            {installWindow(host)}
          </>
        ),
      },
      { instruction: m.install_button_step_done(), tap: homeIcon, screen: home },
    ];
  }
  if (guide === 'android_firefox' || guide === 'cannot') {
    return otherAndroidSteps(guide, title, browser);
  }
  return [
    { instruction: m.install_menu_step_menu(), note: m.install_menu_already(), tap: menuDots, ripple: 'green', screen: browser },
    {
      instruction: m.install_menu_step_item(),
      tap: menuItem,
      ripple: 'green',
      screen: (
        <>
          {browser}
          <BrowserMenu item={m.install_scene_menu_item()} />
        </>
      ),
    },
    {
      instruction: m.install_menu_step_window(),
      tap: windowButton,
      screen: (
        <>
          {browser}
          {installWindow(host)}
        </>
      ),
    },
    { instruction: m.install_step_open(), tap: homeIcon, screen: home },
  ];
}

interface InstallGuideProps extends Drawn {
  readonly guide: BuiltGuide;
  /** With `cannot`, whether the browser may have installed the app already, as a Chromium browser that hands no install window. */
  readonly maybeInstalled?: boolean;
  /** Opens the browser's install window, for `android_button`. */
  readonly install: () => Promise<InstallOutcome>;
  /** The browser could not open its window: another guide, or none. */
  readonly onUnavailable: () => void;
  readonly onClose: () => void;
}

/**
 * The guide of a browser, a step at a time: La Pince mimics the gesture on a phone drawn, the instruction below, « Précédent » and « Suivant ».
 * With `android_button`, the app's « Installer » opens the browser's window at once: accepted, the guide ends on the icon to touch; dismissed, it
 * closes, the person having said no.
 */
export function InstallGuide({ guide, maybeInstalled = false, title, host, install, onUnavailable, onClose }: InstallGuideProps): ReactNode {
  const [index, setIndex] = useState(0);
  // Once installed, the steps before lead nowhere: the window opens once.
  const [installed, setInstalled] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useMounted();
  // Safari's compact bar first, its default.
  const [bar, setBar] = useState<ChosenBar>('compact');
  // A browser that cannot install says so first; the steps of a shortcut come once asked.
  const [shortcut, setShortcut] = useState(false);
  const intro = guide === 'cannot' && !shortcut;
  // The button that opened the guide is gone: the focus goes to its title, for a screen reader to start there; again between the word that the
  // browser cannot install and the shortcut's steps.
  useEffect(() => {
    heading.current?.focus();
  }, [shortcut]);
  const steps = stepsOf(guide, { title, host }, bar);
  const step = steps[index] ?? steps[0];
  if (step === undefined) {
    return null;
  }
  const last = index === steps.length - 1;

  const openWindow = async () => {
    setIndex(1);
    const outcome = await install();
    if (!mounted.current) {
      return;
    }
    if (outcome === 'accepted') {
      setInstalled(true);
      setIndex(2);
    } else if (outcome === 'dismissed') {
      onClose();
    } else {
      onUnavailable();
    }
  };

  let primary: ReactNode;
  if (last) {
    primary = (
      <button className={styles.primary} type="button" onClick={onClose}>
        {m.install_guide_done()}
      </button>
    );
  } else if (guide === 'android_button' && index === 0) {
    primary = (
      <button className={`${styles.primary ?? ''} ${styles.nudge ?? ''}`} type="button" onClick={() => void openWindow()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        {m.install_guide_install()}
      </button>
    );
  } else {
    primary = (
      <button
        className={styles.primary}
        type="button"
        onClick={() => {
          setIndex(index + 1);
        }}
      >
        {m.install_guide_next()}
      </button>
    );
  }

  return (
    <div className={styles.guide}>
      <span className={styles.handle} aria-hidden="true" />
      <div className={styles.guideHead}>
        <div className={styles.guideTitles}>
          <h2 ref={heading} className={styles.guideTitle} tabIndex={-1}>
            {guide === 'cannot' && shortcut ? m.install_shortcut_title() : m.install_guide_title()}
          </h2>
          {intro ? null : <span className={styles.muted}>{m.install_guide_step({ step: index + 1, total: steps.length })}</span>}
        </div>
        <button className={styles.close} type="button" aria-label={m.install_guide_close()} onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {intro ? (
        <CannotInstall
          maybeInstalled={maybeInstalled}
          onShortcut={() => {
            setShortcut(true);
          }}
        />
      ) : (
        <>
          {step.choice === true ? (
            <SafariBarChoice
              value={bar}
              onChange={setBar}
              labels={{ group: m.install_ios_layout_label(), compact: m.install_ios_layout_compact(), bar: m.install_ios_layout_bar() }}
            />
          ) : (
            // A new scene at each step, so that its animation starts over with the instruction.
            <InstallScene key={`${guide}-${bar}-${String(index)}`} tap={step.tap} ripple={step.ripple} swipe={step.swipe}>
              {step.screen}
            </InstallScene>
          )}
          <div className={styles.instruction} aria-live="polite">
            <h3 key={index} className={styles.instructionText}>
              {step.instruction}
            </h3>
            {step.note === undefined ? null : <p className={styles.muted}>{step.note}</p>}
          </div>
          <div className={styles.dots} aria-hidden="true">
            {steps.map(({ instruction }, dot) => (
              <span key={instruction} className={dot === index ? styles.dotCurrent : dot < index ? styles.dotDone : styles.dot} />
            ))}
          </div>
          <div className={styles.buttons}>
            <button
              className={styles.secondary}
              type="button"
              // The shortcut's first step goes back to the browser's word that it cannot install.
              disabled={(index === 0 && guide !== 'cannot') || installed}
              onClick={() => {
                if (index === 0) {
                  setShortcut(false);
                } else {
                  setIndex(index - 1);
                }
              }}
            >
              {m.install_guide_previous()}
            </button>
            {primary}
          </div>
        </>
      )}
    </div>
  );
}
