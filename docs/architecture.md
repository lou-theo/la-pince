# Architecture

État de l'architecture et raisons de chaque choix. Les décisions et leur historique vivent dans `docs/cadrage/README.md` ; ce document décrit ce qui tient aujourd'hui.

## Vue d'ensemble

La Pince est une PWA installable (iPhone, Android, ordinateur), sans compte, utilisable hors ligne. Un Worker Cloudflare sert l'API de synchronisation et envoie les notifications ; D1 (SQLite géré, juridiction UE) garde les données. Le tout tient dans l'offre gratuite de Cloudflare et reste portable vers un serveur Node.

| Paquet                            | Rôle                                                                                                                            | Dépend de    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `packages/core`                   | calcul des effets et des soldes, types, schémas zod, conversion Tricount                                                        | aucun paquet |
| `packages/config`                 | configs partagées : TypeScript, ESLint, Prettier, Vitest                                                                        | aucun paquet |
| `apps/app` (à venir)              | PWA React et Vite, cache local IndexedDB, file d'envoi                                                                          | core         |
| `apps/server` (à venir)           | Worker Hono, accès D1 par Drizzle, Web Push                                                                                     | core         |
| `tools/import-tricount` (à venir) | script local : lit un export Tricount et l'envoie par l'API de synchronisation, le jeton du tricount ne quittant pas la machine | core         |

Le même cœur de calcul tourne sur le téléphone et sur le serveur : le téléphone calcule tout pour afficher hors ligne, le serveur recalcule pour refuser une saisie incohérente. Les frontières tiennent par les dépendances déclarées : pnpm empêche d'importer un paquet absent du `package.json`. Un paquet n'est créé qu'avec son premier code.

## Modèle de données

- **Montants en centimes entiers** : aucun nombre à virgule dans le calcul ; un montant saisi est converti à l'entrée (`montantSaisiSchema`) et refusé s'il est ambigu, jamais arrondi. ESLint interdit `parseFloat` et `toFixed` dans le cœur.
- **Un seul type d'opération** : dépense et remboursement ont la même forme ; la nature sert à l'affichage et aux statistiques, et ne se déduit pas de la forme (une avance pour un ami a la forme d'un remboursement).
- **Saisie séparée de son effet** : la saisie garde ce que la personne a entré, forme libre et versionnée (aujourd'hui une ligne par concerné ; demain lignes de reçu, frais communs) ; l'effet, calculé depuis la saisie, donne le payeur et la part de chaque membre en centimes. Soldes, filtre « me concerne », notifications et statistiques ne lisent que l'effet : une nouvelle forme de saisie ne les touche pas.
- **Soldes recalculés à la volée** depuis les effets, sans total stocké qui pourrait diverger ; la performance est un critère du projet et se mesure par des budgets en échec s'ils sont dépassés.
- **Parts inégales et opérations mêlant parts et montants** portées par le modèle dès la première version (courantes dans l'historique du groupe), même si leur saisie vient plus tard.

## Synchronisation hors ligne

Chronologie d'une dépense saisie dans le métro, sans réseau :

1. Le téléphone crée l'opération avec un identifiant tiré sur place, calcule son effet, l'affiche et la range dans la file d'envoi (IndexedDB).
2. Au retour du réseau, la file envoie l'opération ; un envoi rejoué avec le même identifiant ne crée pas de doublon.
3. Le serveur valide la saisie, recalcule l'effet avec le même cœur, refuse l'incohérent, puis enregistre une nouvelle version de l'opération avec la valeur suivante d'un compteur croissant.
4. Les autres téléphones demandent ce qui a changé depuis le dernier compteur reçu et mettent leur copie locale à jour.

- Chaque téléphone garde tout le groupe en local (de l'ordre de 75 Ko par an, au jugé) et calcule tout lui-même.
- Le serveur garde toutes les versions de chaque opération ; la dernière arrivée au serveur gagne, jamais l'horloge du téléphone ; l'historique permet de rattraper une modification écrasée.
- Une suppression est un marquage, synchronisé comme une modification.
- Les modifications concurrentes d'une même opération sont rares (usage fait d'ajouts indépendants) : pas de fusion automatique (CRDT), écartée pour sa complexité.

## Outillage

- pnpm avec catalogue de versions (une version par dépendance pour tout le repo) ; Node et pnpm épinglés (`.node-version`, `packageManager`) ; pas d'orchestrateur de monorepo tant que `pnpm --recursive` suffit.
- TypeScript strict ; le code se lit en source, sans étape de build entre paquets (Vite et Wrangler compilent à la livraison).
- ESLint avec les règles strictes et typées de typescript-eslint, plus des règles choisies pour le projet ; Prettier en largeur 150.
- `pnpm verifier` (format, lint, typecheck, tests) tourne avant chaque push par lefthook ; GitHub Actions le rejoue sur chaque PR, et le job `verifier` est requis pour fusionner dans `main`.

## Tests

Tests par l'interface publique ; simulations seulement hors de notre code. Cinq niveaux, chacun créé avec le code qu'il couvre :

1. **Cœur** (Vitest) : cas cités d'une autre app sous licence MIT, tests de propriétés (fast-check), couverture 100 % ; corpus réel anonymisé du groupe, chaque effet recalculé comparé à celui de Tricount.
2. **Serveur et base** : runtime Workers local et vraie D1 ; migrations Drizzle commitées, contrôlées sur le schéma et rejouées sur un jeu de données.
3. **App sans écran** : file d'envoi, cache, IndexedDB simulée.
4. **Bout en bout** (Playwright, Chromium et WebKit) : saisie hors ligne puis synchronisation vers un second navigateur.
5. **Performance** : budgets en échec s'ils sont dépassés.
