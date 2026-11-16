# La Pince

PWA open source de partage de dépenses pour un groupe d'amis. État, décisions et plan : `docs/cadrage/README.md`, seule source de statut, à tenir à jour à chaque avancée.

## Règles

- **Répartition du travail** : Claude code l'essentiel, l'utilisateur relit. Code propre, testé à plusieurs niveaux (unitaires, intégration, bout en bout).
- **Criticité** : le calcul des parts et des soldes (argent) ; testé au centime, import contrôlé contre les totaux et les soldes de Tricount.
- **Aucune donnée réelle du groupe dans le repo** (public à terme) : ni noms, ni pseudos, ni export Tricount, ni lien ou jeton de tricount (il donne l'accès en écriture au groupe). Export brut et clés dans `temp/` (ignoré).
- **Aucune écriture dans Tricount** : l'export n'appelle jamais `registry-synchronization`.
- **Retours du groupe** : des hypothèses, pas des commandes ; chacun se confronte à l'usage mesuré (`docs/cadrage/referentiel-fonctionnel.md`) avant d'entrer au périmètre.
