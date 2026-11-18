# La Pince

PWA open source de partage de dépenses pour un groupe d'amis. État, décisions et plan : `docs/cadrage/README.md`, seule source de statut, à tenir à jour à chaque avancée.

## Règles

- **Répartition du travail** : Claude code l'essentiel, l'utilisateur relit. Code propre, testé à plusieurs niveaux (unitaires, intégration, bout en bout).
- **Criticité** : le calcul des parts et des soldes (argent) ; testé au centime, import contrôlé contre les totaux et les soldes de Tricount.
- **Aucune donnée identifiable dans le repo** (public depuis le 16/11/2026, dit par l'utilisateur : « ne commit aucune donnée identifiable ») : ni noms, ni pseudos, ni export Tricount, ni lien ou jeton de tricount (il donne l'accès en écriture au groupe), ni mention de l'employeur de l'utilisateur, de ses repos ou outils internes (une inspiration se décrit sans sa source, et aucun code n'en est repris). Export brut et clés dans `temp/` (ignoré). Seule exception : le corpus de test anonymisé (dit par l'utilisateur : noms des membres remplacés, titres inventés, dates, montants et répartitions gardés ; identifiants Tricount retirés en plus). Captures de PR sur des groupes de démo seulement.
- **Aucune écriture dans Tricount** : l'export n'appelle jamais `registry-synchronization`.
- **Livraison par PR** (repo à vocation open source, dit par l'utilisateur) : jamais de push sur `main`, imposé par la règle de branche GitHub `main protégée` ; toute modification passe par une branche et une PR, fusionnée par squash.
- **Retours du groupe** : des hypothèses, pas des commandes ; chacun se confronte à l'usage mesuré (`docs/cadrage/referentiel-fonctionnel.md`) avant d'entrer au périmètre.
