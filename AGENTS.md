# La Pince

PWA open source de partage de dépenses pour un groupe d'amis, que chaque groupe héberge sur son propre compte Cloudflare (Workers et D1), pas à pas dans `docs/auto-hebergement.md`. État, décisions et plan : `docs/cadrage/README.md`, seule source de statut, à tenir à jour à chaque avancée. Architecture et raisons : `docs/architecture.md`. Vocabulaire du domaine : `CONTEXT.md`, avec le nom anglais de chaque terme dans le code.

## Règles

- **Répartition du travail** : l'agent code l'essentiel, le mainteneur relit : avant fusion, sauf pour les PR de la règle « Fusion en autonomie », qu'il relit quand il veut après fusion. Code propre, testé à plusieurs niveaux (unitaires, intégration, bout en bout).
- **Criticité** : le calcul des parts et des soldes (argent) ; montants en centimes entiers, jamais de nombre à virgule ; testé au centime, import contrôlé contre les totaux et les soldes de Tricount.
- **Aucune donnée identifiable dans le repo** (repo public) : ni noms, ni pseudos, ni export Tricount, ni lien ou jeton de tricount (il donne l'accès en écriture au groupe), ni mention de l'employeur du mainteneur, de ses repos ou outils internes (une inspiration venue de là se décrit sans sa source, et aucun code n'en est repris ; un cas de test repris d'une app open source sous licence compatible, lui, cite sa source). Export brut et clés dans `temp/`, dossier local ignoré par git. Seule exception : le corpus de test anonymisé (noms des membres remplacés, titres inventés, dates, montants et répartitions gardés ; identifiants Tricount retirés en plus). Captures de PR sur des groupes de démo seulement. Une PR publie chacun de ses commits : un contenu interdit retiré en cours de route se retire aussi de l'historique de la branche avant le push.
- **Aucune écriture dans Tricount** : l'export n'appelle jamais `registry-synchronization`.
- **Livraison par PR** (repo à vocation open source) : jamais de push sur `main`, imposé par la règle de branche GitHub `main protégée`, qui exige aussi le job de CI `verifier` ; toute modification passe par une branche et une PR, fusionnée par squash, avec le template `.github/PULL_REQUEST_TEMPLATE.md`.
- **Fusion en autonomie** (proposée par l'agent, acceptée par le mainteneur, décision 23) : l'agent fusionne lui-même ses PR qui avancent le plan de `docs/cadrage/README.md` (correctifs et outillage qu'il demande compris ; toute autre PR attend le mainteneur), CI verte et revue adversariale du diff faite, plus poussée dès que le calcul des parts ou des soldes est touché ; ses choix techniques et les choix d'interface de la démo sont consignés en décisions. Les points à trancher se posent au mainteneur de préférence avant le code de l'étape, et l'agent attend la réponse avant de coder ce qui en dépend. Arrêt pour lui demander : compte ou accès extérieur (Cloudflare, lien du tricount) ; envoi de données réelles hors de la machine (le corpus anonymisé excepté), import des vraies données compris ; le code, lui, se déploie seul à chaque fusion sur `main` (décision 43) ; décision produit qui change le périmètre, ou retour du groupe à intégrer ; décision déjà prise à rouvrir.
- **Retours du groupe** : des hypothèses, pas des commandes ; chacun se confronte à l'usage mesuré (`docs/cadrage/referentiel-fonctionnel.md`) avant d'entrer au périmètre.

## Carte du repo

- `packages/core` : calcul, types, validation (schémas zod de toute donnée entrante), contrat de synchronisation, conversion Tricount ; ne dépend d'aucun autre paquet du repo. `fixtures/tricount-demo.json` : corpus anonymisé, seule donnée issue du vrai groupe admise dans le repo.
- `packages/config` : configs partagées (tsconfig de base, ESLint, Prettier, preset Vitest).
- `apps/app` : PWA React (Vite, routeur wouter) ; `src/model/` fonctions pures (couverture 100 %), `src/sync/` client de l'API et magasin du groupe, `src/storage/` ce que le téléphone retient, `src/screens/` écrans et leurs CSS modules, `src/testing/` faux serveur des tests, `src/i18n/` textes (messages dans `messages/fr.json`, compilés par Paraglide dans `src/i18n/paraglide/`, ignoré par git).
- `apps/server` : Worker Hono, D1 par Drizzle ; schéma dans `src/schema.ts`, migrations générées dans `drizzle/` (jamais écrites à la main), tests de l'API dans workerd ; `wrangler.jsonc` est la config du local et des tests, `wrangler.production.example.jsonc` le modèle de la config d'une instance déployée, copié dans `wrangler.production.jsonc`, ignoré par git et jamais committé.
- `tools/import-tricount` : script local qui importe un export Tricount dans un serveur par son API et relit les soldes ; lancé sous Node, sans étape de build.
- `tools/captures` : captures des écrans sur le groupe de démo (planches avant/après, GIF d'un parcours), mode d'emploi dans le skill `.claude/skills/captures`.
- `tools/sauvegarde` : modèle de la tâche planifiée GitHub qui copie la base chaque nuit dans un repo privé à soi (`docs/auto-hebergement.md`, section Sauvegarde).
- `tools/e2e` : tests de bout en bout (Playwright, Chromium et WebKit) et budgets de performance, sur l'app construite et le Worker local, groupes de démo tirés du corpus.
- `docs/cadrage/` : cadrage du projet (besoin, décisions, plan) ; `docs/cadrage/essais/` garde des essais jetables, hors lint et format.

Un paquet n'importe que ce qu'il déclare dans son `package.json` (règle ESLint `import-x/no-extraneous-dependencies`) : app, server et import dépendent de core, jamais l'un de l'autre ; l'outil de captures et les tests de bout en bout utilisent aussi l'import.

## Commandes

- `pnpm install` : installe, compile les textes de l'app (`pnpm generate`) et pose le hook git avant push (lefthook) ; à lancer dans chaque copie de travail, worktree compris, sans quoi le hook peut laisser passer le push sans rien vérifier.
- `pnpm verifier` : textes compilés (`pnpm generate`), format, lint, typecheck et tests de tous les paquets ; lancé avant chaque push et rejoué par la CI.
- `pnpm format` : reformate tout le repo (Prettier, largeur 150).
- `pnpm --filter @la-pince/core test` : tests d'un seul paquet, avec couverture.
- `pnpm --filter @la-pince/server migrations:generate` : écrit la migration d'un changement de `apps/server/src/schema.ts`, à committer avec lui.
- `pnpm --filter @la-pince/server dev` : serveur local sur une D1 locale (`wrangler dev`), le secret d'administration dans `apps/server/.dev.vars` (`ADMIN_TOKEN=…`, ignoré par git) ; migrations appliquées par `wrangler d1 migrations apply la-pince --local`.
- `pnpm --filter @la-pince/server run deploy` : construit l'app, applique les migrations à la base distante et publie le Worker avec `apps/server/wrangler.production.jsonc` ; la CI le lance elle-même après chaque fusion sur `main` quand les secrets de l'environnement `production` sont posés (décision 43), à la main seulement pour une instance sans eux ; `run` obligatoire, `pnpm deploy` étant une commande de pnpm.
- `pnpm --filter @la-pince/app dev` : app sur http://localhost:5173, l'API passée au serveur local (port 8787) par le proxy de Vite.
- `pnpm e2e` : tests de bout en bout et budgets (`tools/e2e`), rejoués par la CI après `pnpm verifier` mais hors du hook avant push ; navigateurs à installer une fois par version de Playwright (`pnpm --filter @la-pince/e2e exec playwright install chromium webkit`) ; à lancer pour toute PR qui touche l'app, le serveur ou le contrat.
- `pnpm captures --avant origin/main` : planches et GIF de toute PR qui touche un écran, à joindre à sa description (skill `captures`).
- `pnpm --filter @la-pince/import-tricount start <chemin absolu de l'export>` : importe un export dans le serveur local (`LA_PINCE_URL` pour un autre) et affiche le lien du groupe dans l'app (`LA_PINCE_APP_URL`, par défaut celle de `pnpm --filter @la-pince/app dev`), avec `ADMIN_TOKEN` et soit `LA_PINCE_GROUP_TOKEN` (jeton du lien d'un import précédent, gardé), soit `LA_PINCE_NEW_LINK=1` (nouveau lien, l'ancien cesse de marcher) ; secrets saisis sans écho (`read -rs ADMIN_TOKEN && export ADMIN_TOKEN`) plutôt que tapés dans la commande, que l'historique du shell garde ; le jeton du lien s'affiche dans le terminal avant tout appel, jamais dans un fichier. Jamais l'export réel de `temp/` avant l'étape 8.

## Code

- TypeScript strict avec `noUncheckedIndexedAccess` et `exactOptionalPropertyTypes` ; aucun `any`, aucune désactivation de règle ESLint sans commentaire qui dit pourquoi.
- Une condition ne teste jamais un nombre ou une chaîne par sa valeur de vérité (`if (amount)` confond 0 centime et absence) : comparaison explicite.
- Tests à côté du code (`src/**/*.test.ts`, `.test.tsx` pour un écran), par l'interface publique ; simulations seulement hors de notre code. Le cœur est couvert à 100 % ; cas tirés d'une autre app sous licence compatible cités avec leur source.
- Code en anglais (noms, commentaires, intitulés de tests), termes du domaine sous le nom donné par `CONTEXT.md` ; docs, messages de commit et descriptions de PR en français, un identifiant du code cité entre accents graves.
- Commentaires : seulement le « pourquoi » non évident, jamais une paraphrase du code.
- Versions des dépendances dans le catalogue de `pnpm-workspace.yaml`, référencées par `catalog:`.
