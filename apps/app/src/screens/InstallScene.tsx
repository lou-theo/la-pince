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
  /** Where La Pince taps, claw first, coming from below on the left as the logo faces. */
  readonly tap?: ScenePoint;
  /** Ripple of the tap: light over a dark screen, green over a light one. */
  readonly ripple?: 'light' | 'green' | undefined;
}

/**
 * A phone drawn on a sand card, with La Pince (`public/logo.svg` as it is) tapping where the step says, again and again: the guide's way of showing
 * each gesture. The animations stop where the system asks for reduced motion, La Pince then resting on the point.
 */
export function InstallScene({ children, tap, ripple = 'light' }: InstallSceneProps): ReactNode {
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
            <circle className={`${styles.ripple ?? ''} ${ripple === 'green' ? (styles.rippleGreen ?? '') : ''}`} r="14" />
            <g className={styles.tap}>
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
      <g className={styles.openApp}>
        <rect width={screen.width} height={screen.height} fill="#faefd8" />
        <AppScreen title={title} top={0} />
      </g>
    </>
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
