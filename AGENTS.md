# La Pince

PWA open source de partage de dépenses pour un groupe d'amis, hébergée sur Cloudflare Workers et D1. État, décisions et plan : `docs/cadrage/README.md`, seule source de statut, à tenir à jour à chaque avancée. Architecture et raisons : `docs/architecture.md`. Vocabulaire du domaine : `CONTEXT.md`, à suivre dans le code comme dans les docs.

## Règles

- **Répartition du travail** : l'agent code l'essentiel, le mainteneur relit. Code propre, testé à plusieurs niveaux (unitaires, intégration, bout en bout).
- **Criticité** : le calcul des parts et des soldes (argent) ; montants en centimes entiers, jamais de nombre à virgule ; testé au centime, import contrôlé contre les totaux et les soldes de Tricount.
- **Aucune donnée identifiable dans le repo** (repo public) : ni noms, ni pseudos, ni export Tricount, ni lien ou jeton de tricount (il donne l'accès en écriture au groupe), ni mention de l'employeur du mainteneur, de ses repos ou outils internes (une inspiration venue de là se décrit sans sa source, et aucun code n'en est repris ; un cas de test repris d'une app open source sous licence compatible, lui, cite sa source). Export brut et clés dans `temp/`, dossier local ignoré par git. Seule exception : le corpus de test anonymisé (noms des membres remplacés, titres inventés, dates, montants et répartitions gardés ; identifiants Tricount retirés en plus). Captures de PR sur des groupes de démo seulement. Une PR publie chacun de ses commits : un contenu interdit retiré en cours de route se retire aussi de l'historique de la branche avant le push.
- **Aucune écriture dans Tricount** : l'export n'appelle jamais `registry-synchronization`.
- **Livraison par PR** (repo à vocation open source) : jamais de push sur `main`, imposé par la règle de branche GitHub `main protégée`, qui exige aussi le job de CI `verifier` ; toute modification passe par une branche et une PR, fusionnée par squash, avec le template `.github/PULL_REQUEST_TEMPLATE.md`.
- **Retours du groupe** : des hypothèses, pas des commandes ; chacun se confronte à l'usage mesuré (`docs/cadrage/referentiel-fonctionnel.md`) avant d'entrer au périmètre.

## Carte du repo

- `packages/core` : calcul, types, validation (schémas zod de toute donnée entrante), conversion Tricount ; ne dépend d'aucun autre paquet du repo.
- `packages/config` : configs partagées (tsconfig de base, ESLint, Prettier, preset Vitest).
- `docs/cadrage/` : cadrage du projet (besoin, décisions, plan) ; `docs/cadrage/essais/` garde des essais jetables, hors lint et format.
- À venir, créés avec leur premier code : `apps/app` (PWA React), `apps/server` (Worker Hono et Drizzle), `tools/import-tricount` (script local d'import).

Un paquet n'importe que ce qu'il déclare dans son `package.json` (règle ESLint `import-x/no-extraneous-dependencies`) : app et server dépendent de core, jamais l'un de l'autre.

## Commandes

- `pnpm install` : installe et pose le hook git avant push (lefthook) ; à lancer dans chaque copie de travail, worktree compris, sans quoi le hook ne vérifie rien.
- `pnpm verifier` : format, lint, typecheck et tests de tous les paquets ; lancé avant chaque push et rejoué par la CI.
- `pnpm format` : reformate tout le repo (Prettier, largeur 150).
- `pnpm --filter @la-pince/core test` : tests d'un seul paquet, avec couverture.

## Code

- TypeScript strict avec `noUncheckedIndexedAccess` et `exactOptionalPropertyTypes` ; aucun `any`, aucune désactivation de règle ESLint sans commentaire qui dit pourquoi.
- Une condition ne teste jamais un nombre ou une chaîne par sa valeur de vérité (`if (montant)` confond 0 centime et absence) : comparaison explicite.
- Tests à côté du code (`src/**/*.test.ts`), par l'interface publique ; simulations seulement hors de notre code. Le cœur est couvert à 100 % ; cas tirés d'une autre app sous licence compatible cités avec leur source.
- Nommage en français pour le domaine (`CONTEXT.md`), en anglais pour ce qui vient des outils.
- Commentaires : seulement le « pourquoi » non évident, jamais une paraphrase du code.
- Versions des dépendances dans le catalogue de `pnpm-workspace.yaml`, référencées par `catalog:`.
