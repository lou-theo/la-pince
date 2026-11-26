import { type ReactNode, useId } from 'react';

import styles from './InstallScene.module.css';

// Colors are fixed, not the theme's: the phone drawn shows the browser and the app in their light look, whatever the theme of this one.
// The scene is drawn in its own units, scaled to the room the sheet leaves: a phone of 190 × 384 centered on a sand card of 358 × 416, its screen
// inset by 6. Everything a step draws is in the screen's units, 178 wide and 372 high.
const card = { width: 358, height: 416 };
const phone = { x: 84, y: 16, width: 190, height: 384 };
const screen = { x: phone.x + 6, y: phone.y + 6, width: 178, height: 372 };

// Where the front of the claw lies in `logo.svg` (viewBox -46 -15 276 276): the tip of the banknote it holds, at 92 % and 24 % of the drawing.
const pointer = { size: 64, tipX: 59, tipY: 15 };

/** A point of the phone's screen, in the screen's units. */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

interface InstallSceneProps {
  /** What the phone's screen shows, in the screen's units. */
  readonly children: ReactNode;
  /** Where La Pince taps, claw first, coming from below on the left as the logo faces; where it starts its swipe up with `swipe`. */
  readonly tap?: ScenePoint;
  /** Ripple of the tap: light over a dark screen, green over a light one. */
  readonly ripple?: 'light' | 'green' | undefined;
  /** La Pince swipes up from `tap`, scrolling a list, rather than tapping it. */
  readonly swipe?: boolean | undefined;
}

/**
 * A phone drawn on a sand card, with La Pince (`public/logo.svg` as it is) tapping where the step says, again and again: the guide's way of showing
 * each gesture. The animations stop where the system asks for reduced motion, La Pince then resting on the point.
 */
export function InstallScene({ children, tap, ripple = 'light', swipe = false }: InstallSceneProps): ReactNode {
  const clip = useId();
  return (
    <div className={styles.card}>
      <svg className={styles.scene} viewBox={`0 0 ${String(card.width)} ${String(card.height)}`} aria-hidden="true">
        <rect x={phone.x} y={phone.y} width={phone.width} height={phone.height} rx="26" fill="#1c1917" />
        <clipPath id={clip}>
          <rect width={screen.width} height={screen.height} rx="20" />
        </clipPath>
        <g transform={`translate(${String(screen.x)} ${String(screen.y)})`} clipPath={`url(#${clip})`}>
          <rect width={screen.width} height={screen.height} fill="#faefd8" />
          {children}
        </g>
        {tap === undefined ? null : (
          <g transform={`translate(${String(screen.x + tap.x)} ${String(screen.y + tap.y)})`}>
            {swipe ? null : <circle className={`${styles.ripple ?? ''} ${ripple === 'green' ? (styles.rippleGreen ?? '') : ''}`} r="14" />}
            <g className={swipe ? styles.swipe : styles.tap}>
              <image href="/logo.svg" x={-pointer.tipX} y={-pointer.tipY} width={pointer.size} height={pointer.size} />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

/** Text of the scene, in the screen's units. */
export function SceneText({
  x,
  y,
  size,
  weight = 400,
  color = '#1c1917',
  anchor = 'start',
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly weight?: number;
  readonly color?: string;
  readonly anchor?: 'start' | 'middle' | 'end';
  readonly children: string;
}): ReactNode {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={color} textAnchor={anchor} dominantBaseline="central">
      {children}
    </text>
  );
}

// Lines of the expenses behind, a sketch: the length of a title and the color of an amount.
const sketchLines: readonly (readonly [number, string])[] = [
  [46, '#1d4ed8'],
  [30, '#b23a0a'],
  [56, '#b23a0a'],
  [40, '#1d4ed8'],
  [62, '#b23a0a'],
  [34, '#6b6560'],
  [50, '#b23a0a'],
  [44, '#1d4ed8'],
];

/** The app's icon: `public/icon.svg`, a rounded square, or a disc as Android's launcher crops it. */
export function AppIcon({
  x,
  y,
  size,
  round = false,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly round?: boolean;
}): ReactNode {
  const clip = useId();
  return (
    <>
      <clipPath id={clip}>
        <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} />
      </clipPath>
      <image
        href={round ? '/icon-maskable.svg' : '/icon.svg'}
        x={x}
        y={y}
        width={size}
        height={size}
        clipPath={round ? `url(#${clip})` : undefined}
      />
    </>
  );
}

/** The group open in Chrome on Android: the address bar with its ⋮ menu, the band of the group and its expenses. */
export function AndroidBrowser({ host, title }: { readonly host: string; readonly title: string }): ReactNode {
  return (
    <>
      <rect width={screen.width} height="32" fill="#ffffff" />
      <rect x="8" y="6" width="134" height="20" rx="10" fill="#eef0f2" />
      <g transform="translate(15 12.5)" fill="none" stroke="#57534e" strokeWidth="1">
        <rect x="0.5" y="3" width="6" height="4.5" rx="1" />
        <path d="M1.8 3V1.8a1.7 1.7 0 0 1 3.4 0V3" />
      </g>
      <SceneText x={25} y={16} size={7.5}>
        {host}
      </SceneText>
      <rect x="149.5" y="11.5" width="9" height="9" rx="2" fill="none" stroke="#1c1917" strokeWidth="1.5" />
      {[11.5, 16, 20.5].map((y) => (
        <circle key={y} cx="168" cy={y} r="1.25" fill="#1c1917" />
      ))}
      <AppScreen title={title} top={32} />
    </>
  );
}

/** The app itself from `top` down: its band with the icon and the title, and the lines of the expenses. */
export function AppScreen({ title, top }: { readonly title: string; readonly top: number }): ReactNode {
  return (
    <>
      <rect y={top} width={screen.width} height="30" fill="#f3d9a4" />
      <AppIcon x={8} y={top + 8} size={14} />
      <SceneText x={27} y={top + 15} size={9} weight={700}>
        {title}
      </SceneText>
      {sketchLines.map(([width, color], index) => {
        const y = top + 36 + index * 28;
        return (
          <g key={y}>
            <rect x="8" y={y} width="162" height="24" rx="6" fill="#ffffff" />
            <rect x="14" y={y + 9.5} width={width} height="5" rx="2.5" fill="#d6cbb8" />
            <rect x="146" y={y + 9.5} width="18" height="5" rx="2.5" fill={color} />
          </g>
        );
      })}
    </>
  );
}

/** Android's window to install an app, over a darkened screen, its « Installer » pressed unless the window `appear`s. */
export function AndroidInstallWindow({
  host,
  label,
  cancel,
  install,
  appear = false,
}: {
  readonly host: string;
  readonly label: string;
  readonly cancel: string;
  readonly install: string;
  /** Whether the window appears once the tap before it lands, rather than being there. */
  readonly appear?: boolean;
}): ReactNode {
  return (
    <>
      <rect className={appear ? styles.dim : undefined} width={screen.width} height={screen.height} fill="rgb(0 0 0 / 45%)" />
      <g className={appear ? styles.reveal : undefined}>
        <rect x="12" y="116" width="154" height="84" rx="14" fill="#ffffff" />
        <SceneText x={24} y={133} size={9.5} weight={700}>
          {label}
        </SceneText>
        <AppIcon x={24} y={143} size={24} round />
        <SceneText x={55} y={150} size={8.5} weight={600}>
          La Pince
        </SceneText>
        <SceneText x={55} y={161} size={7} color="#57534e">
          {host}
        </SceneText>
        <SceneText x={88} y={186} size={8.5} weight={600} color="#2a5db0" anchor="middle">
          {cancel}
        </SceneText>
        <g className={appear ? undefined : styles.press}>
          <rect x="111" y="178" width="44" height="16" rx="8" fill="#2a5db0" />
          <SceneText x={133} y={186} size={8.5} weight={600} color="#ffffff" anchor="middle">
            {install}
          </SceneText>
        </g>
      </g>
    </>
  );
}

/** Android's home screen, La Pince's icon popping up among the others, then opening the app from it. */
export function AndroidHomeScreen({ title }: { readonly title: string }): ReactNode {
  const gradient = useId();
  const others = [
    '#7f97a8',
    '#a7b59a',
    '#c9b28f',
    '#b49aa8',
    '#9db0a2',
    '#c4a59a',
    '#8fa3b8',
    '#b8b49a',
    '#a9a0bd',
    '#9ab3b8',
    '#c7a98f',
    '#a7b59a',
  ].map((color, index) => ({ color, cx: 29 + (index % 4) * 42, cy: 49 + Math.floor(index / 4) * 50 }));
  return (
    <>
      <linearGradient id={gradient} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#8fa7a0" />
        <stop offset="1" stopColor="#c9b8a0" />
      </linearGradient>
      <rect width={screen.width} height={screen.height} fill={`url(#${gradient})`} />
      {others.map(({ color, cx, cy }) => (
        <circle key={`${String(cx)}-${String(cy)}`} cx={cx} cy={cy} r="15" fill={color} />
      ))}
      <g className={styles.pop}>
        <AppIcon x={14} y={184} size={30} round />
        <SceneText x={29} y={222} size={6.5} weight={600} color="#ffffff" anchor="middle">
          La Pince
        </SceneText>
      </g>
      {others.slice(0, 4).map(({ color, cx }) => (
        <circle key={cx} cx={cx - 1} cy="342" r="14" fill={color} />
      ))}
      <OpeningApp title={title} top={0} />
    </>
  );
}

/** The app growing from its icon on the home screen, then open, its band `top` down from the screen's edge. */
function OpeningApp({ title, top }: { readonly title: string; readonly top: number }): ReactNode {
  return (
    <g className={styles.openApp}>
      <rect width={screen.width} height={screen.height} fill="#faefd8" />
      <rect width={screen.width} height={top} fill="#f3d9a4" />
      <AppScreen title={title} top={top} />
    </g>
  );
}

/** The app's own sheet offering to install, darkening the screen, its « Installer » pressed. */
export function AppInstallSheet({ title, install }: { readonly title: string; readonly install: string }): ReactNode {
  return (
    <>
      <rect width={screen.width} height={screen.height} fill="rgb(28 25 23 / 35%)" />
      <rect y="230" width={screen.width} height="160" rx="14" fill="#faefd8" />
      <image href="/logo.svg" x="67" y="234" width="44" height="44" />
      <SceneText x={89} y={283} size={10} weight={800} anchor="middle">
        {title}
      </SceneText>
      <g className={styles.press}>
        <rect x="16" y="292" width="146" height="26" rx="8" fill="#2f6b4f" />
        <SceneText x={89} y={305} size={9} weight={700} color="#ffffff" anchor="middle">
          {install}
        </SceneText>
      </g>
    </>
  );
}

/** Chrome's ⋮ menu, open, its `item` among lines sketched. */
export function ChromeMenu({ item }: { readonly item: string }): ReactNode {
  const sketched: readonly (readonly [number, number])[] = [
    [0, 70],
    [1, 54],
    [2, 80],
    [4, 62],
  ];
  return (
    <>
      <rect x="24" y="6" width="150" height="136" rx="10" fill="#ffffff" stroke="#e3ddd5" />
      {sketched.map(([row, width]) => (
        <rect key={row} x="33" y={19.5 + row * 26} width={width} height="5" rx="2.5" fill="#e3ddd5" />
      ))}
      <g transform="translate(31 94.5) scale(0.46)" fill="none" stroke="#1c1917" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="2" width="12" height="20" rx="3" />
        <path d="M12 8v6M9 11h6" />
      </g>
      <SceneText x={45} y={100} size={8} weight={600}>
        {item}
      </SceneText>
    </>
  );
}

// Glyphs of iOS drawn on a grid of 24, as the icons of the app.
const glyphs = {
  back: <path d="M15 5l-7 7 7 7" />,
  forward: <path d="M9 5l7 7-7 7" />,
  share: <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />,
  bookmarks: <path d="M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z" />,
  tabs: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 012-2h10" />
    </>
  ),
  addSquare: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
};

/** A glyph of `glyphs` centered on a point of the screen. */
function Glyph({
  name,
  x,
  y,
  size,
  color = '#1c1917',
  weight = 2.4,
}: {
  readonly name: keyof typeof glyphs;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color?: string;
  readonly weight?: number;
}): ReactNode {
  return (
    <g
      transform={`translate(${String(x - size / 2)} ${String(y - size / 2)}) scale(${String(size / 24)})`}
      fill="none"
      stroke={color}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[name]}
    </g>
  );
}

const iosBlue = '#0a5fc8';

/** The five buttons of Safari's bottom bar, centered on `y`: back, forward (greyed), Share, bookmarks, tabs. */
function SafariButtons({ y, color }: { readonly y: number; readonly color: string }): ReactNode {
  const names = ['back', 'forward', 'share', 'bookmarks', 'tabs'] as const;
  return names.map((name, index) => (
    <Glyph
      key={name}
      name={name}
      x={(screen.width / names.length) * (index + 0.5)}
      y={y}
      size={name === 'share' ? 13 : 12}
      color={name === 'forward' ? '#c7c7cc' : color}
    />
  ));
}

/**
 * The bars Safari shows on an iPhone: `classic` before its version 26, the address over a bar of buttons with Share; from 26, `compact`, a floating
 * address between back and « … », the default, or `bar`, the address over a bar of buttons, whether the address sits at the bottom or the top.
 */
export type SafariBar = 'classic' | 'compact' | 'bar';

/** Points of the screen La Pince taps in Safari: Share in its bar, and « … » in its compact bar. */
export const safariPoints = {
  share: (bar: SafariBar): ScenePoint => ({ x: 89, y: bar === 'classic' ? 356 : 353 }),
  more: { x: 155, y: 349 },
};

/** The group open in Safari on an iPhone, under its `bar`. */
export function SafariBrowser({ host, title, bar }: { readonly host: string; readonly title: string; readonly bar: SafariBar }): ReactNode {
  const fade = useId();
  return (
    <>
      {/* The page goes under the status bar, the band of the app with it. */}
      <rect width={screen.width} height="10" fill="#f3d9a4" />
      <AppScreen title={title} top={10} />
      {bar === 'classic' ? (
        <>
          <rect y="306" width={screen.width} height="66" fill="rgb(246 246 248 / 97%)" />
          <path d="M0 306.5H178" stroke="#dcdce2" />
          <rect x="8" y="312" width="162" height="24" rx="8" fill="#e4e4ea" />
          <SceneText x={89} y={324} size={8} anchor="middle">
            {host}
          </SceneText>
          <SafariButtons y={356} color={iosBlue} />
        </>
      ) : null}
      {bar === 'compact' ? (
        <>
          {[8, 44, 140].map((x) => (
            <rect key={x} x={x} y="335" width={x === 44 ? 90 : 30} height="30" rx="15" fill="rgb(0 0 0 / 8%)" />
          ))}
          {[8, 44, 140].map((x) => (
            <rect key={x} x={x} y="334" width={x === 44 ? 90 : 30} height="30" rx="15" fill="#ffffff" />
          ))}
          <Glyph name="back" x={23} y={349} size={10} weight={3} />
          <SceneText x={89} y={349} size={8} anchor="middle">
            {host}
          </SceneText>
          {[150, 155, 160].map((x) => (
            <circle key={x} cx={x} cy="349" r="1.5" fill="#1c1917" />
          ))}
        </>
      ) : null}
      {bar === 'bar' ? (
        <>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#faefd8" stopOpacity="0" />
            <stop offset="0.4" stopColor="#faefd8" stopOpacity="0.95" />
          </linearGradient>
          <rect y="298" width={screen.width} height="74" fill={`url(#${fade})`} />
          <rect x="8" y="309" width="162" height="26" rx="13" fill="rgb(0 0 0 / 8%)" />
          <rect x="8" y="308" width="162" height="26" rx="13" fill="#ffffff" />
          <SceneText x={89} y={321} size={8} anchor="middle">
            {host}
          </SceneText>
          <SafariButtons y={353} color="#1c1917" />
        </>
      ) : null}
    </>
  );
}

/** The menu Safari's « … » opens from its compact bar, Share first; it appears once tapped, or its Share `flash`es. */
export function SafariMenu({ share, flash = false }: { readonly share: string; readonly flash?: boolean }): ReactNode {
  return (
    <g className={flash ? undefined : styles.menuReveal}>
      <rect x="58" y="224" width="112" height="110" rx="12" fill="rgb(0 0 0 / 10%)" />
      <rect x="58" y="222" width="112" height="110" rx="12" fill="#ffffff" />
      <rect className={flash ? styles.flash : undefined} x="58" y="225" width="112" height="26" fill="#ffffff" />
      <Glyph name="share" x={72.5} y={238} size={11} />
      <SceneText x={84} y={238} size={9} weight={600}>
        {share}
      </SceneText>
      {[64, 52, 70].map((width, index) => (
        <rect key={width} x="67" y={261.5 + index * 26} width={width} height="5" rx="2.5" fill="#e3ddd5" />
      ))}
    </g>
  );
}

/** Where La Pince taps Share in the menu of « … »: at the end of its line, its word left readable. */
export const safariMenuShare: ScenePoint = { x: 156, y: 238 };

// The Share sheet scrolls by this much to bring its entry to add the app in reach.
const sheetScroll = 110;

/** Points of the Share sheet: its entry to add the app once scrolled, at the end of its line, and where La Pince starts the swipe that scrolls it. */
export const sharePoints = { entry: { x: 156, y: 261 }, swipe: { x: 120, y: 330 } };

/**
 * The Share sheet of iOS over the page, its `entry` to add the app to the home screen down its list: the sheet slides in or grows as it opens
 * (`appear`), its list is scrolled up by a swipe (`moving`) or already (`scrolled`), its entry then flashing as tapped.
 */
export function ShareSheet({
  host,
  copy,
  entry,
  appear,
  scroll = 'top',
}: {
  readonly host: string;
  readonly copy: string;
  readonly entry: string;
  readonly appear?: 'slide' | 'grow' | undefined;
  readonly scroll?: 'top' | 'moving' | 'scrolled';
}): ReactNode {
  const clip = useId();
  const appearing = { slide: styles.sheetIn, grow: styles.reveal };
  return (
    <g className={appear === undefined ? undefined : appearing[appear]}>
      <rect width={screen.width} height={screen.height} fill="rgb(0 0 0 / 25%)" />
      <clipPath id={clip}>
        <rect y="96" width={screen.width} height="290" rx="14" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect y="96" width={screen.width} height="290" fill="#f2f2f7" />
        <g transform={scroll === 'scrolled' ? `translate(0 ${String(-sheetScroll)})` : undefined}>
          <g className={scroll === 'moving' ? styles.scroll : undefined}>
            {[0, 1, 2, 3, 4].map((index) => (
              <circle key={index} cx={23 + index * 34} cy="160" r="13" fill="#d4d4dc" />
            ))}
            <rect x="8" y="192" width="162" height="78" rx="10" fill="#ffffff" />
            <SceneText x={17} y={205} size={8.5} weight={500}>
              {copy}
            </SceneText>
            <rect x="8" y="280" width="162" height="130" rx="10" fill="#ffffff" />
            <rect className={scroll === 'scrolled' ? styles.flash : undefined} x="8" y="358" width="162" height="26" fill="#ffffff" />
            <path d="M8 218.5H170M8 244.5H170M8 306.5H170M8 332.5H170M8 358.5H170M8 384.5H170" stroke="#ececf0" />
            {(
              [
                [228.5, 70],
                [254.5, 58],
                [290.5, 80],
                [316.5, 60],
                [342.5, 74],
                [394.5, 66],
              ] as const
            ).map(([y, width]) => (
              <rect key={y} x="17" y={y} width={width} height="5" rx="2.5" fill="#e3ddd5" />
            ))}
            <Glyph name="addSquare" x={22.5} y={371} size={11} />
            <SceneText x={34} y={371} size={8.5} weight={600}>
              {entry}
            </SceneText>
          </g>
        </g>
        {/* The head of the sheet stays as its list scrolls under it. */}
        <rect y="96" width={screen.width} height="40" fill="#f2f2f7" />
        <AppIcon x={10} y={105} size={22} />
        <SceneText x={38} y={111} size={8} weight={700}>
          La Pince
        </SceneText>
        <SceneText x={38} y={121} size={7} color="#57534e">
          {host}
        </SceneText>
        <circle cx="160" cy="116" r="8" fill="#e3e3e8" />
      </g>
    </g>
  );
}

/** Where La Pince taps « Ajouter » in the window to add to the home screen: on its last letters, the word left readable. */
export const addPoint: ScenePoint = { x: 167, y: 21 };

/** The window of iOS to add the app to the home screen, its « Ajouter » flashing as tapped; under iOS 26, its switch `webApp` on. */
export function AddToHomeScreen({
  host,
  cancel,
  add,
  webApp,
}: {
  readonly host: string;
  readonly cancel: string;
  readonly add: string;
  readonly webApp?: string | undefined;
}): ReactNode {
  const lines = webApp === undefined ? 102 : 138;
  return (
    <>
      <rect width={screen.width} height={screen.height} fill="#f2f2f7" />
      <SceneText x={10} y={18} size={9} color={iosBlue}>
        {cancel}
      </SceneText>
      <rect className={styles.flash} x="133" y="9.5" width="42" height="17" rx="6" fill="#f2f2f7" />
      <SceneText x={154} y={18} size={9} weight={700} color={iosBlue} anchor="middle">
        {add}
      </SceneText>
      <rect x="8" y="44" width="162" height="50" rx="10" fill="#ffffff" />
      <AppIcon x={16} y={52} size={34} />
      <SceneText x={58} y={59} size={9} weight={600}>
        La Pince
      </SceneText>
      <path d="M58 67.5H162" stroke="#ececf0" />
      <SceneText x={58} y={78} size={7} color="#57534e">
        {host}
      </SceneText>
      {webApp === undefined ? null : (
        <>
          <rect x="8" y="102" width="162" height="28" rx="10" fill="#ffffff" />
          <SceneText x={17} y={116} size={8.5} weight={500}>
            {webApp}
          </SceneText>
          <rect x="139" y="109.5" width="22" height="13" rx="6.5" fill="#34c759" />
          <circle cx="155.5" cy="116" r="5" fill="#ffffff" />
        </>
      )}
      <rect x="12" y={lines} width="140" height="4" rx="2" fill="#dcdce2" />
      <rect x="12" y={lines + 8} width="100" height="4" rx="2" fill="#dcdce2" />
    </>
  );
}

/** The iPhone's home screen, La Pince's icon popping up among the others, then opening the app from it. */
export function IosHomeScreen({ title }: { readonly title: string }): ReactNode {
  const gradient = useId();
  const colors = ['#8fa3b8', '#a7b59a', '#c9b28f', '#b49aa8', '#9db0a2', '#c4a59a', '#8fa3b8', '#b8b49a', '#a9a0bd', '#9ab3b8', '#c7a98f', '#a7b59a'];
  return (
    <>
      <linearGradient id={gradient} x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#9fb3c8" />
        <stop offset="1" stopColor="#d9b9a3" />
      </linearGradient>
      <rect width={screen.width} height={screen.height} fill={`url(#${gradient})`} />
      {colors.map((color, index) => {
        const x = 14 + (index % 4) * 42;
        const y = 34 + Math.floor(index / 4) * 50;
        return <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width="30" height="30" rx="8" fill={color} />;
      })}
      <g className={styles.pop}>
        <AppIcon x={14} y={184} size={30} />
        <SceneText x={29} y={220} size={6.5} weight={600} color="#ffffff" anchor="middle">
          La Pince
        </SceneText>
      </g>
      <rect x="8" y="320" width="162" height="44" rx="16" fill="rgb(255 255 255 / 35%)" />
      {colors.slice(0, 4).map((color, index) => {
        const x = 14.25 + index * 40.5;
        return <rect key={x} x={x} y="328" width="28" height="28" rx="8" fill={color} />;
      })}
      <OpeningApp title={title} top={10} />
    </>
  );
}

/** Where La Pince taps Share in Chrome on an iPhone, at the end of its address. */
export const chromeShare: ScenePoint = { x: 158, y: 17 };

/** The group open in Chrome on an iPhone: Share at the end of the address, and Chrome's bar of buttons at the bottom. */
export function ChromeIosBrowser({ host, title }: { readonly host: string; readonly title: string }): ReactNode {
  return (
    <>
      <rect width={screen.width} height="34" fill="#ffffff" />
      <rect x="8" y="5" width="162" height="24" rx="12" fill="#eef0f2" />
      <SceneText x={83} y={17} size={7.5} anchor="middle">
        {host}
      </SceneText>
      <Glyph name="share" x={chromeShare.x} y={chromeShare.y} size={11} />
      <AppScreen title={title} top={34} />
      <rect y="340" width={screen.width} height="32" fill="#ffffff" />
      <path d="M0 340.5H178" stroke="#e4e4e7" />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect key={index} x={12.8 + index * 35.6} y="351" width="10" height="10" rx="3" fill="#d4d4d8" />
      ))}
    </>
  );
}

/** The bottom of a page in Safari 26 or later, drawn small, under its compact bar or its bar of buttons, the way to Share outlined. */
function BarPicture({ bar }: { readonly bar: 'compact' | 'bar' }): ReactNode {
  const ring = '#2f6b4f';
  return (
    // Cropped from the top to fill its box, the bar at the bottom always shown.
    <svg viewBox="0 0 140 230" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect width="140" height="230" fill="#faefd8" />
      {[8, 35, 62].map((y) => (
        <rect key={y} x="8" y={y} width="124" height="22" rx="6" fill="#ffffff" />
      ))}
      {bar === 'compact' ? (
        <>
          {[10, 96].map((x) => (
            <circle key={x} cx={x + 17} cy="201" r="17" fill="#ffffff" />
          ))}
          <rect x="50" y="184" width="40" height="34" rx="17" fill="#ffffff" />
          <circle cx="113" cy="201" r="17" fill="none" stroke={ring} strokeWidth="2.5" />
          <g transform="translate(21 195) scale(0.5)" fill="none" stroke="#1c1917" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {glyphs.back}
          </g>
          {[106, 113, 120].map((x) => (
            <circle key={x} cx={x} cy="201" r="2" fill="#1c1917" />
          ))}
        </>
      ) : (
        <>
          {(['back', 'forward', 'share', 'bookmarks', 'tabs'] as const).map((name, index) => (
            <Glyph key={name} name={name} x={17.2 + index * 26.4} y={206} size={15} color={name === 'forward' ? '#c7c7cc' : '#1c1917'} />
          ))}
          <circle cx="70" cy="206" r="12" fill="none" stroke={ring} strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}

/**
 * The first step of Safari 26 or later: which bar Safari shows, which its settings choose and its user agent does not tell. Two pictures of the
 * bottom of the screen, the compact bar, Safari's default, chosen first.
 */
export function SafariBarChoice({
  value,
  onChange,
  labels,
}: {
  readonly value: 'compact' | 'bar';
  readonly onChange: (bar: 'compact' | 'bar') => void;
  readonly labels: { readonly group: string; readonly compact: string; readonly bar: string };
}): ReactNode {
  return (
    <div className={styles.choice} role="group" aria-label={labels.group}>
      <span className={styles.choiceLabel} aria-hidden="true">
        {labels.group}
      </span>
      <div className={styles.choiceOptions}>
        {(['compact', 'bar'] as const).map((bar) => (
          <button
            key={bar}
            className={styles.option}
            type="button"
            aria-pressed={value === bar}
            onClick={() => {
              onChange(bar);
            }}
          >
            <BarPicture bar={bar} />
            {labels[bar]}
            {value === bar ? (
              <svg className={styles.check} viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="13" />
                <path d="M7.5 13l3.5 3.5 7-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
