/**
 * Whether this browser can receive notifications: `ready`; `home_screen`, an iPhone or iPad where Safari offers them only to an app opened from the
 * home screen (iOS 16.4 or later); `unsupported`, any other browser without the Push API.
 */
export type PushSupport = 'ready' | 'home_screen' | 'unsupported';

/** The browser's notification and push APIs the app uses, so that tests hand it a fake one. */
export interface PushPlatform {
  readonly support: PushSupport;
  readonly permission: () => NotificationPermission;
  readonly requestPermission: () => Promise<NotificationPermission>;
  /** The push subscription of this browser, shared by all its groups, or `null` without one or without a service worker. */
  readonly getSubscription: () => Promise<PushSubscription | null>;
  /** Subscribes this browser with the instance's public key; throws when the push service refuses or the service worker is missing. */
  readonly subscribe: (publicKey: string) => Promise<PushSubscription>;
}

function supportOf(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'ready';
  }
  // iPadOS asks for the desktop site and calls itself a Mac, told apart by its touch screen.
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return apple ? 'home_screen' : 'unsupported';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** The browser's own APIs; the service worker is registered by the app at start, in the built app only. */
export function browserPushPlatform(): PushPlatform {
  const support = supportOf();
  // `getRegistration` rather than `ready`, which never settles where no service worker is registered (dev server).
  const registration = async () => (await navigator.serviceWorker.getRegistration()) ?? undefined;
  return {
    support,
    permission: () => (support === 'ready' ? Notification.permission : 'denied'),
    requestPermission: () => Notification.requestPermission(),
    async getSubscription() {
      return (await registration())?.pushManager.getSubscription() ?? null;
    },
    async subscribe(publicKey) {
      const current = await registration();
      if (current === undefined) {
        throw new Error('no service worker');
      }
      return current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    },
  };
}
