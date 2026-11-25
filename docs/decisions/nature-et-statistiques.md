# Nature et statistiques

18/11/2026, proposé par le mainteneur pendant la revue.

L'effet porte un booléen `countsAsSpending` (compte dans le total dépensé), décidé par chaque version de saisie (version 1 : vrai pour une dépense, faux pour un remboursement) ; la nature reste dans la saisie, pour l'affichage. Les statistiques ne lisent ainsi que l'effet, et une forme de saisie future (avance, correction) peut se sortir des statistiques sans toucher à leur code.

Alternatives écartées : nature portée par l'opération, hors saisie (règle d'exclusion dans le code des statistiques) ; nature recopiée dans l'effet (donnée d'affichage mêlée aux comptes).

Coût si faux : un seul booléen pour toutes les statistiques ; un autre découpage demandera un champ de plus dans l'effet.
