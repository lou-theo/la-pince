/**
 * Where the app is opened, as far as installing it goes: already `installed` (opened from the home screen), on a `desktop` (nothing offered), in the
 * browser `in_app` of a messaging or social app, or in a phone's browser, by system and family. Tablets count as phones. Safari from its version 26
 * (`ios_safari_26`) moved Share out of the bar most iPhones show.
 */
export type InstallContext =
  | 'installed'
  | 'desktop'
  | 'in_app'
  | 'ios_safari'
  | 'ios_safari_26'
  | 'ios_chrome'
  | 'ios_other'
  | 'android_chrome'
  | 'android_chromium'
  | 'android_firefox'
  | 'android_other';

/** What the browser tells of itself. */
export interface InstallEnvironment {
  readonly userAgent: string;
  /** Touch points of the screen: an iPad asking for the desktop site calls itself a Mac, told apart by its touch screen. */
  readonly maxTouchPoints: number;
  /** Whether the page runs as an app opened from the home screen (`display-mode: standalone`, or `navigator.standalone` on iOS). */
  readonly standalone: boolean;
}

/**
 * The install window an Android Chromium browser offers through `beforeinstallprompt`: `waiting` for it a few seconds after the start, `available`
 * once held, `absent` when it never came (app already installed, browser that does not offer it) or was used.
 */
export type PromptState = 'waiting' | 'available' | 'absent';

/**
 * The guide that fits a context: `android_button` opens the browser's install window from the app's own button; `android_menu` walks through
 * Chrome's ⋮ menu; `android_firefox` through Firefox's; `cannot` says the browser does not install apps and recommends Chrome; `ios_safari` goes
 * through Share in the bottom bar of Safari before its version 26, `ios_safari_26` asks first which bar Safari shows, its Share being in the « … »
 * menu or in the bar; `ios_share` through Share beside the address of another iPhone browser; `in_app` asks to open the link in a real browser.
 */
export type InstallGuide = 'android_button' | 'android_menu' | 'android_firefox' | 'cannot' | 'ios_safari' | 'ios_safari_26' | 'ios_share' | 'in_app';

// Marks of the browsers built into apps: Facebook and Messenger, Instagram, LINE, WeChat, Snapchat, LinkedIn, TikTok, the Google app on iOS, and
// any Android WebView (`; wv)`).
const inAppMarks = /FBAN|FBAV|FB_IAB|Instagram|\bLine\/|MicroMessenger|Snapchat|LinkedInApp|musical_ly|BytedanceWebview|\bGSA\/|; wv\)/;

// Chromium browsers that add their own name to Chrome's: they may lack Chrome's ⋮ « Installer l'application ».
const otherChromium = /SamsungBrowser|EdgA\/|OPR\/|OPT\/|YaBrowser|UCBrowser|Vivaldi|DuckDuckGo|MiuiBrowser|HuaweiBrowser|HeyTapBrowser|Silk\//;

/** Whether the browser runs on an iPhone or an iPad; iPadOS asks for the desktop site and calls itself a Mac, told apart by its touch screen. */
export const isAppleTouch = (userAgent: string, maxTouchPoints: number): boolean =>
  /iPhone|iPad|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1);

function iosContext(userAgent: string): InstallContext {
  if (userAgent.includes('CriOS/')) {
    return 'ios_chrome';
  }
  if (/\b(?:FxiOS|EdgiOS|OPiOS|OPT|Ddg)\//.test(userAgent)) {
    return 'ios_other';
  }
  // Every iPhone browser carries `Safari/`; a web view built into an app does not.
  if (!userAgent.includes('Safari/')) {
    return 'in_app';
  }
  // Safari's generation is read on `Version/`: under iOS 26 its `OS 18_6` stays put.
  const version = /\bVersion\/(\d+)/.exec(userAgent)?.[1];
  return version !== undefined && Number(version) >= 26 ? 'ios_safari_26' : 'ios_safari';
}

function androidContext(userAgent: string): InstallContext {
  if (userAgent.includes('Firefox/')) {
    return 'android_firefox';
  }
  if (!userAgent.includes('Chrome/')) {
    return 'android_other';
  }
  return otherChromium.test(userAgent) ? 'android_chromium' : 'android_chrome';
}

/** The context of the page, from what the browser says of itself. */
export function detectInstallContext({ userAgent, maxTouchPoints, standalone }: InstallEnvironment): InstallContext {
  if (standalone) {
    return 'installed';
  }
  if (inAppMarks.test(userAgent)) {
    return 'in_app';
  }
  if (isAppleTouch(userAgent, maxTouchPoints)) {
    return iosContext(userAgent);
  }
  return userAgent.includes('Android') ? androidContext(userAgent) : 'desktop';
}

/**
 * The guide to offer in a context: `none` where there is nothing to install (installed, desktop), `waiting` while an Android Chromium browser may
 * still hand its install window. Without it, Chrome still installs from its menu; another Chromium browser is taken as one that cannot.
 */
export function guideOf(context: InstallContext, prompt: PromptState): InstallGuide | 'none' | 'waiting' {
  switch (context) {
    case 'installed':
    case 'desktop':
      return 'none';
    case 'in_app':
      return 'in_app';
    case 'ios_safari':
    case 'ios_safari_26':
      return context;
    case 'ios_chrome':
    case 'ios_other':
      return 'ios_share';
    case 'android_firefox':
      return 'android_firefox';
    case 'android_other':
      return 'cannot';
    case 'android_chrome':
    case 'android_chromium':
      if (prompt === 'available') {
        return 'android_button';
      }
      if (prompt === 'waiting') {
        return 'waiting';
      }
      return context === 'android_chrome' ? 'android_menu' : 'cannot';
  }
}
