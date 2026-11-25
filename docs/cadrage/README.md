# Alternative à Tricount : La Pince

**État (25/11/2026)** : aucune app existante ne convenait ; le groupe développe la sienne, **La Pince**, une PWA open source sans compte, que chaque groupe héberge gratuitement sur son compte Cloudflare (Workers et D1). Version 1 livrée en démo sur l'instance du mainteneur, avec le groupe de démo tiré du corpus anonymisé (étapes 1 à 7), déployée à chaque fusion sur `main`, sauvegardée chaque nuit ; notifications aux seuls concernés livrées et vérifiées sur Android et iPhone ; refonte des écrans livrée en première version, à itérer avec le mainteneur. L'import des vraies données attend que le mainteneur le demande.

Contexte : l'utilisateur utilise Tricount depuis longtemps avec un groupe d'amis, frustré par « des fonctionnalités basiques que nous trouvons manquantes, des lenteurs, une app qui ne fonctionne pas super bien » (dit par l'utilisateur). Déclencheur : un bug Tricount, en cours le 16/11 (date de début non précisée), empêche les apps du groupe de se synchroniser (dit par l'utilisateur).

Impact : non estimable en euros (usage entre amis, gratuit). L'enjeu est la friction du partage des dépenses de 13 personnes (236 dépenses et 14 remboursements du 25/11/2025 au 16/11/2026, 9 609,80 € de dépenses) ; coût d'hébergement visé : 0 €.

## Besoin

Dit par l'utilisateur le 16/11 :

- Mobile first, iOS et Android, avec une vue desktop (Tricount n'en a plus).
- Voir facilement les dépenses qui me concernent ; notifications seulement pour celles-là (Tricount notifie tout le monde).
- Recherche correcte ; app rapide et fiable ; visualisation simple de qui dépense quoi.
- Saisie hors ligne indispensable (« ajout différé quasi tout le temps », synchronisation simple).
- Récupérer ses données ; open source.
- Idées : sous-groupes ou labels de membres, historique des modifications, stats d'évolution, prix enregistrés pour achats fréquents, lien vers une dépense, commande groupée complétée plus tard par chacun, OCR de ticket (pas prioritaire).

Critère de fin du chantier : le groupe importé depuis Tricount tourne en ligne, et une dépense ajoutée notifie les concernés (un Android, un iPhone) et pas les autres.

## Périmètre

- **Cible avant le lot 2** (répartie en plusieurs versions ; contenu de la version 1 : décision [Version 1](../decisions/version-1.md)) : groupe sans compte (membres avec ou sans l'app, « qui je suis », invitation par lien) ; saisie rapide (un payeur, sélection accélérée des participants : dernière sélection, membres fréquents en tête, tout cocher ou décocher ; répartition égale, par parts, en montants exacts ; remboursements) ; saisie hors ligne avec file d'envoi ; ma part sur chaque ligne, filtre « me concerne », recherche par texte, payeur, participant, montant et date ; notifications aux seuls concernés, auteur exclu ; soldes, remboursements suggérés, vue par membre (moi contre le groupe) ; import Tricount (export complet reporté, décision [Version 1](../decisions/version-1.md)) ; PWA utilisable sur ordinateur, guide d'installation iPhone.
- **Lot 2** : sous-groupes de membres, commande groupée complétée par chacun, historique des modifications, lien vers une dépense, statistiques dans le temps.
- **Plus tard** : catégories (sauf usage intéressant trouvé), prix enregistrés, lecture des tickets, devises, pièces jointes. Idée de l'assistant, non retenue à ce jour : classement amical « qui sera la plus grosse pince ? » dans les stats.
- **Hors périmètre** : apps natives sur les stores, comptes utilisateurs, usage hors du groupe.
- Criticité : calcul des parts et des soldes (argent) ; import et soldes testés au centime contre Tricount.

## Lexique

- Workers : fonctions serverless de Cloudflare ; D1 : leur base SQLite gérée ; Time Travel : restauration de D1 à la minute près, 7 jours en offre gratuite ; workers.dev : sous-domaine gratuit fourni par Cloudflare.
- Web Push : notifications envoyées par le serveur au navigateur, signées par une paire de clés VAPID ; Hono et Drizzle : routeur HTTP et couche d'accès SQL en TypeScript.

## Ce qu'on sait

- **Alternatives** (`alternatives.md`, sous-agent, non contre-vérifié) : aucune app ne coche les contraintes ; aucune ne cible les notifications sans compte (`referentiel-fonctionnel.md`).
- **Usage réel du groupe** (`referentiel-fonctionnel.md`, script du 16/11 sur l'export, non contre-vérifié) : aucune dépense ne concerne les 13 membres, médiane 3 concernés, 49 dépenses ne concernant qu'une personne, payées par une autre ; 3 à 5 membres annexes ; 146 dépenses sur 236 à parts égales ; catégories, pièces jointes et devises quasi inutilisées.
- **Export Tricount** (vérifié le 16/11) : `export/lire_tricount.py` lit un groupe par le jeton de son lien, sans rattachement à un membre, par l'API non officielle de l'app Android. Le 16/11 le serveur refusait les anciennes versions d'app (HTTP 422 avec 7.0.7, version des exporteurs open source lus, et avec 14.6.1 ; signalé dans https://github.com/elrandar/tricount-api/issues/2) ; l'identifiant de la version 14.8.2, relu dans l'APK (classe UserAgentInterceptor), passe. Export en une page, le serveur ne signalant aucune page suivante (champ `Pagination` vide) : total des 236 dépenses 9 609,80 €, identique à l'app (confirmé par l'utilisateur) ; total des 14 remboursements (1 024,16 €) non recoupé ; sur l'export du 19/11, soldes et total des dépenses comparés à l'app, celui des remboursements recoupé indirectement (PR #26 et #28). L'export brut, avec les noms du groupe, reste hors de tout repo ; il se régénère avec le script et le jeton du lien. Fragile pour une synchronisation continue, suffisant pour migrer.
- **Bases open source** (`bases-open-source.md`) : Spliit (MIT, sans compte, sans notifications) et SplitPro (MIT, comptes, notifications ciblées) évalués ; page blanche retenue, Spliit sert de référence pour le calcul.
- **Notifications** (vérifié le 16/11, mesuré sur Workers le 19/11) : reçues dans Chrome sur un émulateur Android 15 avec Google Play, pas encore sur un vrai téléphone (`essais/android-notification-recue.png`, `essais/push-demo-server.mjs`) ; ciblage par « qui je suis » validé avec un Worker Cloudflare local et D1 (`essais/cloudflare/`). Sur Workers, le chiffrement de 9 notifications en un seul appel prend 10 à 16 ms de CPU, au-delà de la limite de 10 ms de l'offre gratuite, d'où l'envoi par une file (décision [Notifications](../decisions/notifications.md)). Simulateur iOS : abonnement refusé, non concluant pour les vrais iPhone ; la doc Apple annonce le Web Push pour les apps web de l'écran d'accueil depuis iOS 16.4.
- **Hébergement** (`hebergement.md`, chiffres clés relus le 16/11) : Cloudflare D1 en juridiction UE garde ses réplicas dans l'UE ; Time Travel gratuit 7 jours ; offre gratuite : 100 000 requêtes par jour, 10 ms de CPU par requête, base de 500 Mo, 5 tâches planifiées, 50 requêtes SQL par invocation ; pas de gel des quotas garanti.
- **Nom** : repo GitHub `lou-theo/la-pince` créé et public (16/11) ; domaines lapince et la-pince en .fr, .com, .app, .eu pris ; adresse gratuite en sous-domaine workers.dev.

## Décisions

Une décision par fichier dans [`docs/decisions/`](../decisions/), nommé par son sujet : ce qui contraint toute PR à venir ou un choix produit du mainteneur, avec ses raisons, ses alternatives écartées et son coût si elle est fausse. Les choix d'implémentation d'une PR vivent dans sa description, et ce qui en reste vrai dans `docs/architecture.md` (règle « Où écrire » d'`AGENTS.md`).

### Questions ouvertes

1. **Manques de Sesterce** (16/11) : ce qui manque à Sesterce pour le groupe, demandé au mainteneur, sans réponse ; non bloquant.
2. **Découpage au-delà de la version 1** (16/11) : « on sera à beaucoup plus que 3 ou 4 versions » (dit par le mainteneur) ; suite indicative dans la décision [Version 1](../decisions/version-1.md) ; les retours du groupe (`retours-du-groupe.md`) restent à y répartir.
3. **Sélections rapides des membres** (17/11) : « ordre alpha ne me semble pas judicieux, à voir plus tard », « l'idée des sélection rapide me semble bien, surement à combiner à termes avec la catégorie de dépense » (dit par le mainteneur) ; ordre de la liste tranché (décision [Ordre des membres à la sélection](../decisions/ordre-des-membres.md)), restent le mécanisme et la version des sélections rapides. Frais de commande à répartir : « on verra plus tard » (17/11).

## Plan (validé le 16/11, étapes 4 à 8 découpées le 19/11)

1. **Référentiel fonctionnel** : fait (`referentiel-fonctionnel.md`).
2. **Hébergement et stack** : fait (`hebergement.md`).
3. **Repo du projet** : monorepo, outillage, `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`, cœur de calcul couvert à 100 %. Fait (PR #1 à #3).
4. **Conversion Tricount et corpus anonymisé** (`packages/core`) : total retrouvé, parts et soldes contrôlés au centime contre l'export. Fait (PR #5).
5. **Serveur et import en local** : Worker Hono, D1 par Drizzle, API de synchronisation, `tools/import-tricount`. Fait (PR #6 à #8).
6. **App PWA** : groupe par lien et « qui je suis », liste avec ma part, détail, soldes, remboursements suggérés, saisie, modification et suppression, captures. Fait (PR #9 à #11).
7. **Hors ligne et bout en bout** : copie locale, file d'envoi, Playwright et budgets de performance. Fait (PR #12 à #14), détection d'une base restaurée (PR #15).
8. **Mise en ligne**, point d'arrêt pour les données réelles : instance du mainteneur déployée avec le groupe de démo, guide d'auto-hébergement, déploiement à chaque fusion, partage du lien, copie quotidienne chiffrée (PR #16, #20, #21, #24 et #25) ; soldes et totaux du groupe de démo contrôlés contre l'app Tricount (PR #26 et #28) ; corpus régénéré sur les exports du 19/11 et du 25/11 (PR #19 et #41). Reste l'import des vraies données, quand le mainteneur le demandera (« je ne veux pas les vraies données pour le moment », 19/11).
9. **Vérification de bout en bout** : critère de fin de la section Besoin. À faire.
10. **Notifications (version 2)** : serveur et file (PR #27), app (PR #31 et #32), petite icône de la barre d'état (PR #34) ; vérifiées par le mainteneur sur Android dans Chrome et Firefox, et sur un iPhone sous iOS 18.7 par le bouton d'essai (24/11). Reste une dépense saisie par un autre membre qui concerne le mainteneur.
11. **Refonte des écrans** : liste, ajout et répartition, soldes, remboursement (PR #33, #36, #37 et #38), première version. Reste l'itération avec le mainteneur sur l'app déployée.
12. **Logs du serveur** : Workers Logs, activé sur l'instance du mainteneur le 24/11. Fait (PR #35).

## Par où reprendre

Prochaine : itération de la refonte des écrans avec le mainteneur sur l'app déployée (étape 11) ; en parallèle, la dernière vérification des notifications (étape 10). Chantiers notés par le mainteneur le 24/11, sans étape au plan, ordre à fixer avec lui : onboarding d'installation sur téléphone (inciter à installer l'app, passer par Chrome, autoriser les notifications, l'abonnement de chaque groupe restant à part), avatar personnalisable, logs et observabilité côté app ; tous suivent la décision [Plusieurs groupes par téléphone](../decisions/plusieurs-groupes.md). L'import des vraies données (suite de l'étape 8) se ferait dans l'instance du mainteneur, rien ne partant sans son accord, et se contrôle en comparant les soldes importés à ceux de l'app Tricount au même instant ; le lien du tricount donne l'accès en écriture au groupe et n'entre jamais dans un fichier versionné.

## Carte du dossier

- `README.md` : ce fichier, état du sujet.
- `alternatives.md` : panorama des apps de partage de dépenses (16/11).
- `bases-open-source.md` : Spliit et SplitPro évalués comme base (16/11).
- `referentiel-fonctionnel.md` : fonctions des apps et usage réel du groupe (16/11).
- `hebergement.md` : options d'hébergement, piste Cloudflare approfondie (16/11).
- `sources/cloudflare-doc-codex-2026-11-16.md` : recherche documentaire Cloudflare de Codex.
- `export/lire_tricount.py` : export d'un tricount par son jeton.
- `essais/push-demo-server.mjs`, `essais/android-notification-recue.png` : essai Web Push sur Android.
- `retours-du-groupe.md` : retours des amis, triés contre l'usage mesuré (16 et 17/11).
- `essais/cloudflare/` : essai Worker Hono et D1 avec notifications ciblées, et mesure CPU ; traces non rejouables telles quelles (ni `package.json`, ni schéma de la table, ni clés VAPID ; `wrangler.jsonc` attend `src/index.ts`).
