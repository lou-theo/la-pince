import { type ReactNode, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import type { InstallOutcome } from '../install/platform.ts';
import styles from './Install.module.css';
import {
  AndroidBrowser,
  AndroidHomeScreen,
  AndroidInstallWindow,
  AppInstallSheet,
  ChromeMenu,
  InstallScene,
  type ScenePoint,
} from './InstallScene.tsx';
import { useMounted } from './useMounted.ts';

/** The guides built so far; the others offer nothing yet. */
export type BuiltGuide = 'android_button' | 'android_menu';

interface Step {
  readonly instruction: string;
  readonly note?: string;
  readonly tap: ScenePoint;
  readonly ripple?: 'light' | 'green';
  readonly screen: ReactNode;
}

interface Drawn {
  readonly title: string;
  readonly host: string;
}

// Where La Pince taps, in the screen's units of `InstallScene`.
const sheetButton = { x: 89, y: 305 };
const windowButton = { x: 133, y: 186 };
const homeIcon = { x: 29, y: 199 };
const menuDots = { x: 168, y: 16 };
const menuItem = { x: 74, y: 100 };

const installWindow = (host: string) => (
  <AndroidInstallWindow host={host} label={m.install_scene_window_title()} cancel={m.install_scene_cancel()} install={m.install_guide_install()} />
);

function stepsOf(guide: BuiltGuide, { title, host }: Drawn): readonly Step[] {
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
            <AndroidInstallWindow
              host={host}
              label={m.install_scene_window_title()}
              cancel={m.install_scene_cancel()}
              install={m.install_guide_install()}
              appear
            />
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
  return [
    { instruction: m.install_menu_step_menu(), note: m.install_menu_already(), tap: menuDots, ripple: 'green', screen: browser },
    {
      instruction: m.install_menu_step_item(),
      tap: menuItem,
      ripple: 'green',
      screen: (
        <>
          {browser}
          <ChromeMenu item={m.install_scene_menu_item()} />
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
    { instruction: m.install_menu_step_open(), tap: homeIcon, screen: home },
  ];
}

interface InstallGuideProps extends Drawn {
  readonly guide: BuiltGuide;
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
export function InstallGuide({ guide, title, host, install, onUnavailable, onClose }: InstallGuideProps): ReactNode {
  const [index, setIndex] = useState(0);
  const mounted = useMounted();
  const steps = stepsOf(guide, { title, host });
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
          <h2 className={styles.guideTitle}>{m.install_guide_title()}</h2>
          <span className={styles.muted}>{m.install_guide_step({ step: index + 1, total: steps.length })}</span>
        </div>
        <button className={styles.close} type="button" aria-label={m.install_guide_close()} onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {/* A new scene at each step, so that its animation starts over with the instruction. */}
      <InstallScene key={`${guide}-${String(index)}`} tap={step.tap} ripple={step.ripple}>
        {step.screen}
      </InstallScene>
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
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
          }}
        >
          {m.install_guide_previous()}
        </button>
        {primary}
      </div>
    </div>
  );
}
