# Architecture

État de l'architecture et raisons de chaque choix. Les décisions et leur historique vivent dans `docs/cadrage/README.md` ; ce document décrit ce qui tient aujourd'hui.

## Vue d'ensemble

La Pince est une PWA installable (iPhone, Android, ordinateur), sans compte, utilisable hors ligne. Un Worker Cloudflare sert l'API de synchronisation et envoie les notifications ; D1 (SQLite géré, juridiction UE) garde les données. Le tout tient dans l'offre gratuite de Cloudflare et reste portable vers un serveur Node.

| Paquet                  | Rôle                                                                                                                                                      | Dépend de    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `packages/core`         | calcul des effets et des soldes, types, schémas zod, contrat de synchronisation, conversion Tricount                                                      | aucun paquet |
| `packages/config`       | configs partagées : TypeScript, ESLint, Prettier, Vitest                                                                                                  | aucun paquet |
| `apps/app`              | PWA React et Vite : groupe par son lien et « qui je suis » ; à venir : liste, soldes, saisie, cache local IndexedDB, file d'envoi                         | core         |
| `apps/server`           | Worker Hono, accès D1 par Drizzle, API de synchronisation et route d'administration ; Web Push à venir                                                    | core         |
| `tools/import-tricount` | script local : convertit un export Tricount, écrase le groupe par la route d'administration et l'API de synchronisation, puis relit ses soldes au centime | core         |
| `tools/captures`        | script local : captures des écrans sur le groupe de démo, planches avant/après et GIF d'un parcours, pour les PR                                          | core, import |

Le même cœur de calcul tourne sur le téléphone et sur le serveur : le téléphone calcule tout pour afficher hors ligne, le serveur valide chaque saisie par les mêmes schémas pour refuser une saisie incohérente. Les frontières tiennent par les dépendances déclarées : ESLint refuse l'import d'un paquet absent du `package.json` le plus proche (pnpm ne suffit pas, Node trouvant les outils installés à la racine). Un paquet n'est créé qu'avec son premier code.

## Modèle de données

- **Montants en centimes entiers** : aucun nombre à virgule dans le calcul ; un montant saisi est converti à l'entrée (`enteredAmountSchema`) et refusé s'il est ambigu, jamais arrondi. ESLint interdit `parseFloat` et `toFixed` dans le cœur et dans l'app.
- **Un seul type d'opération** : dépense et remboursement ont la même forme ; la nature sert à l'affichage et, par l'effet, à dire si l'opération compte dans le total dépensé ; elle ne se déduit pas de la forme (une avance pour un ami a la forme d'un remboursement).
- **Saisie séparée de son effet** : la saisie garde ce que la personne a entré, forme libre et versionnée (aujourd'hui une ligne par membre de la répartition ; demain lignes de reçu, frais communs) ; l'effet, calculé depuis la saisie, donne le payeur, la part de chaque membre en centimes et s'il compte dans le total dépensé. Soldes, filtre « me concerne », notifications et statistiques ne lisent que l'effet : une nouvelle forme de saisie ne les touche pas.
- **Soldes recalculés à la volée** depuis les effets, sans total stocké qui pourrait diverger ; la performance est un critère du projet et se mesure par des budgets en échec s'ils sont dépassés.
- **Parts inégales et opérations mêlant parts et montants** portées par le modèle dès la première version (courantes dans l'historique du groupe), même si leur saisie vient plus tard.

## Calcul

Modules purs de `packages/core`, appelés à l'identique par le téléphone et par le serveur :

1. **Saisie** (`entrySchema`) : version 1, un payeur et une ligne par membre de la répartition, chacune à montant fixe ou à poids ; avec des poids, le total est obligatoire et doit laisser quelque chose à répartir ; sans poids, le total est la somme des lignes. Seule une saisie validée par le schéma se calcule (type marqué).
2. **Effet** (`computeEffect`) : les montants fixes sont repris tels quels, le reste du total se répartit au prorata des poids par la méthode du plus grand reste ; à reste égal, le centime restant suit une rotation tirée de l'identifiant de l'opération, pour ne pas toujours tomber sur le même membre tout en restant identique d'un calcul à l'autre (algorithme de Spliit). Les membres sont ordonnés par unités de code (`compareIds`), jamais par `localeCompare`, dont l'ordre varie selon le moteur et la langue : le centime irait à un autre membre sur le serveur que sur le téléphone. Une part nulle ne fait pas d'un membre un concerné. L'effet dit aussi si l'opération compte dans le total dépensé (`countsAsSpending`), décidé par la version de saisie (version 1 : une dépense compte, un remboursement non), pour que les statistiques ne lisent jamais la saisie.
3. **Soldes** (`computeBalances`) : payé moins parts, depuis les seuls effets ; leur somme vaut toujours 0.
4. **Remboursements suggérés** (`suggestTransfers`) : algorithme glouton de Spliit, créanciers puis débiteurs dans un ordre fixe ; un virement suggéré une fois fait laisse les suivants inchangés.
5. **Conversion Tricount** (`convertTricount`) : lit l'export d'un tricount (format de l'API de son app Android, champs utiles seulement, schéma zod) et rend le groupe, ses membres et ses opérations, sous les identifiants de Tricount (celui du groupe compris, jamais son jeton de lien) pour qu'un nouvel import écrase le même groupe. Une dépense (`NORMAL`) ou un remboursement (`BALANCE`, du propriétaire vers le seul autre membre à qui le montant est alloué) devient une saisie en montants fixes égaux aux allocations de Tricount, le total saisi contrôlant leur somme ; la date garde le jour affiché par Tricount. Refusés plutôt qu'approchés : revenu ou part positive, autre devise que l'euro, opération supprimée, membre inconnu du groupe ou en double, opération en double, membre alloué deux fois, allocations qui ne tombent pas juste, remboursement à plusieurs membres ou au payeur, jour inexistant, titre ou nom vide, trop long ou mal formé (bornes du contrat de synchronisation), export qui annonce une autre page ; l'erreur donne le chemin de l'opération en cause.

La règle du centime restant fait partie du contrat de la saisie version 1 : chaque téléphone recalcule les effets depuis les saisies, donc la changer changerait les parts des opérations passées ; une autre règle viendrait avec une nouvelle version de saisie. Les dépenses importées de Tricount entrent en montants fixes égaux aux parts calculées par Tricount, dont la règle du centime restant diffère de la nôtre, une part nulle étant omise (le schéma refuse un montant fixe nul). Plafonds : 99 999 999,99 € par montant et poids de 1 000 au plus gardent le produit d'un montant par un poids en nombre entier exact ; 100 lignes au plus, loin au-delà de la taille d'un groupe.

## Synchronisation hors ligne

Chronologie d'une dépense saisie dans le métro, sans réseau :

1. Le téléphone crée l'opération avec un identifiant tiré sur place, calcule son effet, l'affiche et la range dans la file d'envoi (IndexedDB).
2. Au retour du réseau, la file envoie l'opération ; un envoi rejoué avec le même identifiant ne crée pas de doublon.
3. Le serveur valide chaque version avec les schémas du cœur, refuse l'incohérent version par version, puis enregistre chaque nouvelle version avec la valeur suivante d'un compteur croissant (`seq`) et répond pour chacune.
4. Les autres téléphones demandent ce qui a changé depuis le dernier compteur reçu et mettent leur copie locale à jour.

- Chaque téléphone garde tout le groupe en local (de l'ordre de 75 Ko par an, au jugé) et calcule tout lui-même.
- Le serveur garde toutes les versions de chaque opération ; la dernière arrivée au serveur gagne, jamais l'horloge du téléphone ; l'historique permet de rattraper une modification écrasée.
- Une suppression est un marquage, synchronisé comme une modification.
- Les modifications concurrentes d'une même opération sont rares (usage fait d'ajouts indépendants) : pas de fusion automatique (CRDT), écartée pour sa complexité.

Le contrat vit dans `packages/core`, lu par le téléphone comme par le serveur :

- **Opération envoyée** (`operationSchema`, une version de l'opération) : identifiant de l'opération, identifiant de la version (tiré sur le téléphone à chaque modification), titre, jour (`YYYY-MM-DD`, jamais une heure), auteur facultatif, puis soit la saisie, soit le marquage `deleted: true`. Les identifiants s'écrivent en lettres ASCII, chiffres, `-` et `_` : un caractère qu'UTF-8 ne porte pas reviendrait changé du stockage et déplacerait le centime restant.
- **Envoi** (`operationBatchSchema`, réponse `operationBatchResponseSchema`) : versions écrites dans l'ordre reçu, plafonnées par requête (`MAX_BATCH_REVISIONS`), chacune jugée seule et répondue dans le même ordre : écrite avec son `seq`, renvoi (`duplicate`) d'une version déjà reçue avec le même contenu, ou refusée avec son motif (`rejectionReasonSchema` : saisie hors schéma, membre hors du groupe selon `unknownMembers`, opération d'un autre groupe, identifiant de version déjà reçu avec un autre contenu). La file d'envoi retire la version dans les trois cas : aucune ne bloque les suivantes. Seuls un corps illisible ou une version sans identifiant lisible font refuser le lot entier (`invalid_request`). Une ancienne version qui arrive pour la première fois après une plus récente l'emporte : la file d'envoi l'évite en envoyant ses versions dans l'ordre, une requête à la fois, sans fusionner une version non acquittée. Le téléphone fait le contrôle des membres avant de mettre une opération en file. Il affiche la copie du serveur recouverte des versions encore en file : une version refusée sort de la file et son opération revient à la copie du serveur. Le curseur n'avance que par la lecture des changements, jamais par le `seq` d'une réponse `written`, qui peut suivre des changements pas encore lus.
- **Lecture** (`changesQuerySchema`, `changesResponseSchema`) : la version courante de chaque opération changée depuis le curseur, avec son `seq` et le `createdSeq` de sa première version (ordre de saisie, stable quand l'opération change), par `seq` croissant, plafonnée par page (`MAX_CHANGES`), le curseur suivant et `hasMore` ; `pageFollowsQuery` contrôle qu'une page répond à sa requête (rien au curseur demandé ou avant, même curseur rendu quand rien n'a changé). Des soldes calculés avant d'avoir lu une page à `hasMore: false` oublient des opérations : le téléphone lit jusque-là. Un curseur au-delà du dernier changement du groupe (historique du serveur reconstruit) reçoit `409 cursor_ahead` : le téléphone abandonne sa copie et relit depuis 0.
- **Groupe** (`groupResponseSchema`) : titre et membres dans leur ordre d'ajout ; les opérations arrivent par la lecture des changements. La route d'administration (`PUT /api/admin/groups/:id`, `adminGroupSchema`, sous le secret `ADMIN_TOKEN`) crée ou met à jour le titre, le jeton du lien et les membres, que la synchronisation ne crée pas ; un membre absent du corps est gardé, et un jeton déjà pris par un autre groupe est refusé.
- **Erreurs** d'une requête entière (`apiErrorSchema`) : `invalid_request`, `group_not_found`, `cursor_ahead`, `unauthorized`, `token_in_use`.
- **Effet** (`operationEffect`) : `computeEffect(operation.id, saisie)`, identique au centime d'un appel à l'autre, d'une version à l'autre et après le transit et le stockage en UTF-8 ; aucun pour une opération supprimée.

Le serveur garde dans D1 (`apps/server/src/schema.ts`, migrations dans `apps/server/drizzle/`) :

- `groups` : identifiant, titre et SHA-256 du jeton du lien, pour que la base lue ne donne accès à aucun groupe ;
- `members` : membres de chaque groupe, avec leur ordre d'ajout ;
- `revisions` : chaque version reçue, en JSON aux clés triées, sous un `seq` `AUTOINCREMENT` commun à tous les groupes et jamais réutilisé, et un identifiant de version unique ;
- `operations` : état courant de chaque opération (sa dernière version, son `seq` et son `createdSeq`) ; un identifiant d'opération appartient à un seul groupe.

Une version et l'état courant de son opération s'écrivent dans un seul lot D1, qui est une transaction (`apps/server/src/store.ts`). Les gardes vivent dans les instructions, pas dans la lecture qui les précède : la version n'est insérée que si son identifiant est nouveau et son opération n'appartient pas à un autre groupe, et l'état courant ne bouge que si la version vient d'être insérée (`changes()`). Deux requêtes qui envoient la même version en même temps n'en écrivent qu'une, et un renvoi ne ramène jamais une opération à une version plus ancienne. Une version qu'une requête concurrente a prise entre la lecture et l'écriture est rejugée sur une lecture fraîche : elle reçoit la réponse qu'elle aurait eue en arrivant après.

## Import Tricount

Chronologie d'un import (`tools/import-tricount`, lancé sur la machine du mainteneur) :

1. L'outil lit le fichier d'export et le convertit (`convertTricount`) ; l'identifiant du groupe est celui du tricount, jamais son jeton de lien, qui n'est pas lu.
2. Il crée ou met à jour le groupe par la route d'administration : titre, membres, et jeton du lien de La Pince, redonné à chaque import pour garder le lien ; un nouveau jeton, qui remplace le lien sur-le-champ, n'est tiré que sur demande explicite, et s'affiche avant tout appel au serveur, pour ne pas se perdre si l'import s'arrête.
3. Il lit tous les changements du groupe depuis 0, puis n'envoie que ce qui diffère de l'export, des plus anciennes opérations aux plus récentes pour que `createdSeq` suive l'ordre de saisie : une opération nouvelle, modifiée ou supprimée puis remise reçoit une version, et une opération absente de l'export, créée dans La Pince comprise, est marquée supprimée. L'identifiant de version est le SHA-256 du groupe, du contenu et du `seq` de la version remplacée : un import identique n'envoie rien, et un retour à un état antérieur fait une nouvelle version au lieu d'être pris pour un renvoi.
4. Il relit le groupe et s'arrête en erreur au moindre écart avec l'export : version refusée, opération en trop ou différente, solde d'un membre différent au centime du calcul fait par le cœur depuis l'export.
5. Il affiche les totaux. Le jeton du lien ne s'affiche que dans le terminal : qui l'a peut écrire dans le groupe.

## App

`apps/app` est une PWA React servie par Vite, en français seul, sans dépendance à `apps/server` : elle lit le contrat de synchronisation de `packages/core`.

- **Routes** (wouter) : `/g/:token` ouvre un groupe par le jeton de son lien, contrôlé par `groupTokenSchema` avant tout appel, avec ses routes imbriquées `/` (dépenses), `/operations/:id` (détail), `/operations/:id/modifier`, `/nouvelle-depense`, `/nouveau-remboursement` (prérempli par `?de=&a=&montant=` depuis un remboursement suggéré) et `/soldes` ; `/lien` ouvre un groupe dont on colle le lien, repli d'une app installée qui démarre sans son lien ; `/` revient au dernier groupe ouvert sur le téléphone, ou mène à `/lien`.
- **Lecture** : `src/sync/client.ts` appelle l'API et fait passer chaque réponse par les schémas du cœur ; une réponse hors contrat est une erreur affichée, jamais une donnée lue. Les écrans reçoivent le client par un contexte React, pour que les tests leur donnent un faux transport (`src/testing/fake-server.ts`).
- **Magasin du groupe** (`src/sync/groupStore.ts`) : un par groupe ouvert, en mémoire, lu par `useSyncExternalStore`. Il lit le groupe puis ses changements par pages depuis son curseur, et ne publie qu'une lecture complète : liste et soldes ne montrent jamais un état partiel. Un curseur en avance sur le serveur (base restaurée) relance une fois la lecture depuis zéro. Une relecture qui échoue garde le groupe affiché, l'erreur à côté.
- **Écriture** : en ligne, une version par requête ; le magasin attend la lecture en cours, qui a pu manquer l'écriture, puis relit le groupe. Sans file d'envoi (étape 7), une erreur réseau s'affiche et le formulaire reste rempli ; une écriture faite mais pas relue le dit, formulaire ouvert.
- **Modèle** (`src/model/`, fonctions pures couvertes à 100 %) : opérations vivantes et leur ordre, ma part, soldes triés et remboursements suggérés, tous calculés par le cœur à partir de la saisie ; formulaire d'une opération (`operationForm.ts` : réducteur, lecture en entrée par les schémas du cœur, aperçu des parts par `computeEffect`, version de modification et de suppression) et ordre des membres à choisir (`members.ts`, décision 24) ; montants formatés par `Intl.NumberFormat` sur une chaîne décimale tirée des centimes entiers, jours formatés en UTC pour ne jamais glisser selon le fuseau du téléphone.
- **Ce que le téléphone retient** (`src/storage/`) : « qui je suis » par groupe et le dernier groupe ouvert, dans `localStorage` ; un stockage refusé (navigation privée) fait redemander plutôt qu'échouer, et un membre retenu qui n'est plus dans le groupe est redemandé.
- **Textes** : Paraglide compile `messages/fr.json` en fonctions typées (`pnpm generate`, lancé par `pnpm install` et `pnpm verifier` ; son greffon Vite sert les mêmes fonctions au serveur de développement, au build et aux tests) ; le greffon de format des messages est lu dans `node_modules`, pas sur un CDN, pour que la compilation ne dépende pas du réseau. Chaque code d'erreur passe par une table exhaustive (`src/i18n/errors.ts`).
- **Mise en page** : CSS modules et variables CSS, sans bibliothèque ; une colonne à la largeur d'un téléphone, centrée sur ordinateur ; thème sombre suivi du système.
- **PWA** : manifeste et service worker générés par vite-plugin-pwa (`generateSW`), qui ne met en cache que la coquille de l'app, jamais une réponse de l'API ; `Referrer-Policy: no-referrer` par une balise de la page, le jeton du lien étant dans l'adresse.
- **Développement** : le proxy de Vite passe `/api` au serveur local (`wrangler dev`, port 8787).

## Outillage

- pnpm avec catalogue de versions (une version par dépendance pour tout le repo) ; Node et pnpm épinglés (`.node-version`, `packageManager`) ; pas d'orchestrateur de monorepo tant que `pnpm --recursive` suffit.
- TypeScript strict ; le code se lit en source, sans étape de build entre paquets (Vite et Wrangler compilent à la livraison) ; seuls les textes de l'app sont générés (`pnpm generate`).
- ESLint avec les règles strictes et typées de typescript-eslint, plus des règles choisies pour le projet, et pour l'app les règles strictes et typées d'eslint-plugin-react-x et celles d'eslint-plugin-react-hooks ; Prettier en largeur 150.
- `pnpm verifier` (textes compilés, format, lint, typecheck, tests) tourne avant chaque push par lefthook ; GitHub Actions le rejoue sur chaque PR, et le job `verifier` est requis pour fusionner dans `main`.

## Tests

Tests par l'interface publique ; simulations seulement hors de notre code. Cinq niveaux, chacun créé avec le code qu'il couvre :

1. **Cœur** (Vitest) : cas cités d'une autre app sous licence MIT, tests de propriétés (fast-check), couverture 100 % ; corpus réel anonymisé du groupe (`packages/core/fixtures/tricount-demo.json` : prénoms et titres inventés, identifiants remplacés, dates, montants et répartitions gardés), chaque effet comparé aux allocations de Tricount et les soldes à un calcul fait hors de ce code.
2. **Serveur, base et import** : le Worker tourne dans workerd, le runtime de Cloudflare, sur une D1 locale migrée par les migrations commitées (`createTestHarness` de Wrangler, appelé depuis Vitest) ; chaque `pnpm test` du serveur contrôle par `drizzle-kit generate` qu'aucune migration ne manque au schéma ; en cas d'écart, ce contrôle laisse la migration générée (`schema-drift`), à supprimer avant de générer la vraie ; la couverture mesurée porte sur le code qui tourne sous Node (tri des versions reçues, et écritures en base appelées directement contre la D1 locale, 100 %), les routes étant couvertes par les tests d'API. L'import tourne de bout en bout contre ce serveur sur le corpus de démo : 9 609,80 € de dépenses et 1 024,16 € de remboursements relus, soldes égaux au centime, ré-import identique sans version, opération retirée de l'export marquée supprimée, opération modifiée en une version, arrêt sur un serveur qui refuse, perd un centime ou acquitte sans écrire.
3. **App** (Vitest, happy-dom, Testing Library) : écrans rendus par leurs routes avec un faux transport dont les réponses passent par les schémas du cœur, fonctions pures de `src/model/` couvertes à 100 % ; à venir : file d'envoi, cache, IndexedDB simulée.
4. **Bout en bout** (Playwright, Chromium et WebKit) : saisie hors ligne puis synchronisation vers un second navigateur.
5. **Performance** : budgets en échec s'ils sont dépassés.
