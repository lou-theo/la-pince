import { describe, expect, it } from 'vitest';

import { detectInstallContext, guideOf, type InstallContext, type PromptState } from './install.ts';

const iosBase = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const androidBase = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)';
const webView = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0';

// User agents in the form the browsers send them, the Android ones reduced as Chromium does since its version 110.
const userAgents: readonly (readonly [name: string, userAgent: string, context: InstallContext, maxTouchPoints?: number])[] = [
  ['Chrome, Android phone', `${androidBase} Chrome/131.0.0.0 Mobile Safari/537.36`, 'android_chrome'],
  ['Chrome, Android tablet', `${androidBase} Chrome/131.0.0.0 Safari/537.36`, 'android_chrome'],
  ['Samsung Internet', `${androidBase} SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`, 'android_chromium'],
  ['Edge, Android', `${androidBase} Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0`, 'android_chromium'],
  ['Opera, Android', `${androidBase} Chrome/131.0.0.0 Mobile Safari/537.36 OPR/86.0.0.0`, 'android_chromium'],
  ['Firefox, Android', 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0', 'android_firefox'],
  [
    'old Android browser',
    'Mozilla/5.0 (Linux; U; Android 4.4.2; fr-fr; GT-I9505 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    'android_other',
  ],
  ['Android WebView of an app', `${webView} Chrome/130.0.6723.102 Mobile Safari/537.36`, 'in_app'],
  ['Facebook, Android', `${webView} Chrome/130.0.6723.102 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/489.0.0.47.103;]`, 'in_app'],
  ['Instagram, Android', `${webView} Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 356.0.0.41.101 Android (34/14; 420dpi)`, 'in_app'],
  ['Safari, iPhone', `${iosBase} Version/18.7 Mobile/15E148 Safari/604.1`, 'ios_safari'],
  [
    'Safari 18, iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'ios_safari',
  ],
  [
    'Safari 16.3, iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
    'ios_safari',
  ],
  // Under iOS 26, Safari says `OS 18_6` still: its generation is in `Version/`.
  [
    'Safari 26, iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    'ios_safari_26',
  ],
  [
    'Safari 27, iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1',
    'ios_safari_26',
  ],
  ['Chrome, iPhone', `${iosBase} CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1`, 'ios_chrome'],
  [
    'Chrome, iPhone under iOS 26',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
    'ios_chrome',
  ],
  ['Firefox, iPhone', `${iosBase} FxiOS/132.0 Mobile/15E148 Safari/605.1.15`, 'ios_other'],
  ['Edge, iPhone', `${iosBase} EdgiOS/131.0.2903.68 Version/18.0 Mobile/15E148 Safari/604.1`, 'ios_other'],
  [
    'Safari, iPad',
    'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
    'ios_safari',
  ],
  [
    'Safari, iPad asking for the desktop site',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Safari/605.1.15',
    'ios_safari',
    5,
  ],
  [
    'Safari 26, iPad asking for the desktop site',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    'ios_safari_26',
    5,
  ],
  [
    'Facebook, iPhone',
    `${iosBase} Mobile/22H20 [FBAN/FBIOS;FBAV/489.0.0.36.106;FBBV/680000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/18.7]`,
    'in_app',
  ],
  ['Instagram, iPhone', `${iosBase} Mobile/22H20 Instagram 356.0.0.24.84 (iPhone14,5; iOS 18_7; fr_FR; fr; scale=3.00; 1170x2532)`, 'in_app'],
  ['Google app, iPhone', `${iosBase} GSA/345.0.704297344 Mobile/15E148 Safari/604.1`, 'in_app'],
  ['web view of an iPhone app', `${iosBase} Mobile/15E148`, 'in_app'],
  [
    'Safari, Mac',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Safari/605.1.15',
    'desktop',
    0,
  ],
  ['Chrome, Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'desktop'],
  ['Firefox, Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'desktop'],
];

describe('context of the page', () => {
  it.each(userAgents.map(([name, userAgent, context, maxTouchPoints = 0]) => [name, userAgent, context, maxTouchPoints] as const))(
    '%s',
    (_, userAgent, context, maxTouchPoints) => {
      expect(detectInstallContext({ userAgent, maxTouchPoints, standalone: false })).toBe(context);
    },
  );

  it('is installed when opened from the home screen, whatever the browser says', () => {
    for (const [, userAgent] of userAgents) {
      expect(detectInstallContext({ userAgent, maxTouchPoints: 5, standalone: true })).toBe('installed');
    }
  });
});

describe('guide of a context', () => {
  const prompts: readonly PromptState[] = ['waiting', 'available', 'absent'];

  it('offers nothing where there is nothing to install', () => {
    for (const prompt of prompts) {
      expect(guideOf('installed', prompt)).toBe('none');
      expect(guideOf('desktop', prompt)).toBe('none');
    }
  });

  it('follows the browser elsewhere than on Android Chromium, without waiting for an install window', () => {
    const fixed: readonly (readonly [InstallContext, string])[] = [
      ['in_app', 'in_app'],
      ['ios_safari', 'ios_safari'],
      ['ios_safari_26', 'ios_safari_26'],
      ['ios_chrome', 'ios_share'],
      ['ios_other', 'ios_share'],
      ['android_firefox', 'android_firefox'],
      ['android_other', 'cannot'],
    ];
    for (const [context, guide] of fixed) {
      for (const prompt of prompts) {
        expect(guideOf(context, prompt)).toBe(guide);
      }
    }
  });

  it("opens the install window from the app's button on Android Chromium, once the browser hands it", () => {
    expect(guideOf('android_chrome', 'available')).toBe('android_button');
    expect(guideOf('android_chromium', 'available')).toBe('android_button');
    expect(guideOf('android_chrome', 'waiting')).toBe('waiting');
    expect(guideOf('android_chromium', 'waiting')).toBe('waiting');
  });

  it("goes through Chrome's menu without an install window, and takes another Chromium browser for one that cannot install", () => {
    expect(guideOf('android_chrome', 'absent')).toBe('android_menu');
    expect(guideOf('android_chromium', 'absent')).toBe('cannot');
  });
});
