import type { ReactNode } from 'react';

// Drawings of the balances' decor, decorative only: the words and amounts beside them say the same. Colors from `global.css`, light and dark.

/** A bag of coins, for a member the group owes. */
export function Bag({ size, className }: { readonly size: number; readonly className?: string | undefined }): ReactNode {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7 2h6l-2 3.5c5 2 7 6 7 9 0 3-3 4.5-8 4.5s-8-1.5-8-4.5c0-3 2-7 7-9z"
        fill="var(--decor-bag)"
        stroke="var(--decor-bag-line)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M7.5 5.5h5" stroke="var(--decor-bag-line)" strokeWidth="1.4" />
      <text x="10" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--decor-bag-coin)">
        €
      </text>
    </svg>
  );
}

/** A ball and its chain, for a member who owes the group. */
export function Ball({ size, className }: { readonly size: number; readonly className?: string | undefined }): ReactNode {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M0 2l4 3 2 3" fill="none" stroke="var(--decor-chain)" strokeWidth="1.6" strokeDasharray="2 1.2" />
      <circle cx="12" cy="12" r="7.5" fill="var(--decor-ball)" />
      <circle cx="9.5" cy="9.5" r="2" fill="var(--decor-ball-shine)" />
    </svg>
  );
}
