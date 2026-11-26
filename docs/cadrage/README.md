# Alternative à Tricount : La Pince

**Conclusion** : aucune app existante ne convenait ; le groupe développe la sienne, **La Pince**, une PWA open source sans compte, que chaque groupe héberge gratuitement sur son compte Cloudflare (Workers et D1). Avancement par étape dans la section Plan, seule à changer à chaque PR.

Contexte : le mainteneur utilise Tricount depuis longtemps avec un groupe d'amis, frustré par « des fonctionnalités basiques que nous trouvons manquantes, des lenteurs, une app qui ne fonctionne pas super bien » (dit par le mainteneur). Déclencheur : un bug Tricount, en cours le 16/11 (date de début non précisée), empêche les apps du groupe de se synchroniser (dit par le mainteneur).

Impact : non estimable en euros (usage entre amis, gratuit). L'enjeu est la friction du partage des dépenses de 13 personnes (236 dépenses et 14 remboursements du 25/11/2025 au 16/11/2026, 9 609,80 € de dépenses) ; coût d'hébergement visé : 0 €.

## Besoin

Dit par le mainteneur le 16/11 :

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

- Workers : fonctions serverless de Cloudflare ; D1 : leur base SQLite gérée ; Time Travel : restauration de D1 à la minute près, 7 jours en offre gratuite ; workers.dev : sous-domaine gratuit fourni par Cloudflare ; KV : stockage clé-valeur de Cloudflare ; R2 : son stockage d'objets ; Images : son service de stockage et de retouche d'images.
- Web Push : notifications envoyées par le serveur au navigateur, signées par une paire de clés VAPID ; Hono et Drizzle : routeur HTTP et couche d'accès SQL en TypeScript.

## Ce qu'on sait

- **Alternatives** (`alternatives.md`, sous-agent, non contre-vérifié) : aucune app ne coche les contraintes ; aucune ne cible les notifications sans compte (`referentiel-fonctionnel.md`).
- **Usage réel du groupe** (`referentiel-fonctionnel.md`, script du 16/11 sur l'export, non contre-vérifié) : aucune dépense ne concerne les 13 membres, médiane 3 concernés, 49 dépenses ne concernant qu'une personne, payées par une autre ; 3 à 5 membres annexes ; 146 dépenses sur 236 à parts égales ; catégories, pièces jointes et devises quasi inutilisées.
- **Export Tricount** (vérifié le 16/11) : `export/lire_tricount.py` lit un groupe par le jeton de son lien, sans rattachement à un membre, par l'API non officielle de l'app Android. Le 16/11 le serveur refusait les anciennes versions d'app (HTTP 422 avec 7.0.7, version des exporteurs open source lus, et avec 14.6.1 ; signalé dans https://github.com/elrandar/tricount-api/issues/2) ; l'identifiant de la version 14.8.2, relu dans l'APK (classe UserAgentInterceptor), passe. Export en une page, le serveur ne signalant aucune page suivante (champ `Pagination` vide) : total des 236 dépenses 9 609,80 €, identique à l'app (confirmé par le mainteneur) ; total des 14 remboursements (1 024,16 €) non recoupé ; sur l'export du 19/11, soldes et total des dépenses comparés à l'app, celui des remboursements recoupé indirectement (PR #26, #28 et #29). L'export brut, avec les noms du groupe, reste hors de tout repo ; il se régénère avec le script et le jeton du lien. Fragile pour une synchronisation continue, suffisant pour migrer.
- **Bases open source** (`bases-open-source.md`) : Spliit (MIT, sans compte, sans notifications) et SplitPro (MIT, comptes, notifications ciblées) évalués ; page blanche retenue, Spliit sert de référence pour le calcul.
- **Notifications** : vérifiées sur téléphone, sauf une dépense saisie par un autre membre (étape 10 du plan) ; envoi par une file, le chiffrement dépassant la limite de CPU de l'offre gratuite (décision [Notifications](../decisions/notifications.md)) ; essais d'origine dans `essais/`.
- **Hébergement** (`hebergement.md`, chiffres clés relus le 16/11) : Cloudflare D1 en juridiction UE garde ses réplicas dans l'UE ; Time Travel gratuit 7 jours ; offre gratuite : 100 000 requêtes par jour, 10 ms de CPU par requête, base de 500 Mo, 5 tâches planifiées, 50 requêtes SQL par invocation ; pas de gel des quotas garanti.
- **Stockage des photos** (lu le 25/11) : offre gratuite de KV, 1 000 écritures par jour, 1 GB stocké, une valeur jusqu'à 25 MiB (https://developers.cloudflare.com/kv/platform/limits/) ; l'API de KV répond sans activation préalable sur le compte du mainteneur (liste des espaces lue vide le 25/11, création d'un espace non testée) ; R2 exige un moyen de paiement à son activation (parcours suivi par le mainteneur le 25/11) ; Images ne stocke qu'en offre payante. Une écriture de KV peut n'être visible ailleurs qu'au bout de 60 s ou plus, et une clé lue absente reste un moment absente en cache (https://developers.cloudflare.com/kv/concepts/how-kv-works/, lu le 25/11).
- **Nom** : repo GitHub `lou-theo/la-pince` créé et public (16/11) ; domaines lapince et la-pince en .fr, .com, .app, .eu pris ; adresse gratuite en sous-domaine workers.dev.

## Décisions

Les 52 décisions numérotées d'avant cette organisation, citées par les PR #1 à #41, se lisent à `git show b5092b6:docs/cadrage/README.md`. Une décision par fichier dans [`docs/decisions/`](../decisions/), nommé par son sujet : ce qui contraint toute PR à venir ou un choix produit du mainteneur, avec ses raisons, ses alternatives écartées et son coût si elle est fausse. Les choix d'implémentation d'une PR vivent dans sa description, et ce qui en reste vrai dans `docs/architecture.md` (règle « Où écrire » d'`AGENTS.md`).

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
8. **Mise en ligne**, point d'arrêt pour les données réelles : instance du mainteneur déployée avec le groupe de démo, guide d'auto-hébergement, déploiement à chaque fusion, partage du lien, copie quotidienne chiffrée (PR #16, #20, #21, #24 et #25) ; soldes et totaux du groupe de démo contrôlés contre l'app Tricount (PR #26, #28 et #29) ; corpus régénéré sur les exports du 19/11 et du 25/11 (PR #19 et #41). Reste l'import des vraies données, quand le mainteneur le demandera (« je ne veux pas les vraies données pour le moment », 19/11) : dans son instance, rien ne partant sans son accord, contrôlé en comparant les soldes importés à ceux de l'app Tricount au même instant ; le lien du tricount donne l'accès en écriture au groupe et n'entre jamais dans un fichier versionné.
9. **Vérification de bout en bout** : critère de fin de la section Besoin. À faire.
10. **Notifications (version 2)** : serveur et file (PR #27), app (PR #31 et #32), petite icône de la barre d'état (PR #34) ; vérifiées par le mainteneur sur Android dans Chrome et Firefox, et sur un iPhone sous iOS 18.7 par le bouton d'essai (24/11). Reste une dépense saisie par un autre membre qui concerne le mainteneur.
11. **Refonte des écrans** : liste, ajout et répartition, soldes, remboursement (PR #33, #36, #37 et #38), première version. Reste l'itération avec le mainteneur sur l'app déployée.
12. **Logs du serveur** : Workers Logs, activé sur l'instance du mainteneur le 24/11. Fait (PR #35).
13. **Édition du groupe et avatar** (décision [Édition du groupe et avatar](../decisions/edition-du-groupe.md)), une PR au moins par point, dans l'ordre, fusionnées en autonomie une fois le point a fusionné, jusqu'à l'arrêt du point e : (a) **entrée au plan** : décision [Édition du groupe et avatar](../decisions/edition-du-groupe.md) et amendement de la route d'administration (PR #7) et de la décision [Plusieurs groupes par téléphone](../decisions/plusieurs-groupes.md). Fait ; (b) **serveur et contrat** : schémas dans `packages/core`, routes sous le jeton du lien (titre du groupe, nom d'un membre, ajout d'un membre), tests de l'API dans workerd ; réponse du groupe tolérante à un champ inconnu, identifiant du nouveau membre tiré par le téléphone, nom en double refusé (décision [Édition du groupe : serveur et contrat](../decisions/edition-du-groupe-contrat.md)) ; comment l'app apprend qu'une instance a KV, reporté au point d. Fait ; (c) **écrans** : `/moi` en deux onglets, fiche unique ouverte depuis les soldes ou Le groupe avec retour à l'écran d'origine, feuille d'ajout, message hors ligne, avatar sur la sous-ligne de la liste, pastille appareil photo masquée jusqu'au point d ; thème sombre non maquetté, décliné des couleurs sombres existantes ; à trancher à la préparation : mécanisme du retour à l'écran d'origine, menu du bas (`BottomNav.tsx`) à adapter ; tests d'écran, bout en bout et captures ; avatar sur la sous-ligne de la liste (PR #46) et écrans d'édition (PR #47), écarts à la maquette dans leur description. Fait ; (d) **photo** : liaison KV facultative ; route d'envoi (JPEG vérifié par sa signature, 256 px et 200 Ko au plus) ; route d'annulation qui remet la version précédente ou retire la photo, les anciennes clés gardées tant que l'annulation est possible ; lecture par adresse versionnée en cache longue durée, une 404 jamais mise en cache (Worker et service worker), repli sur l'initiale puis nouvel essai ; champ photo du membre dans la réponse du groupe, absent de la route d'administration ; photo gardée hors ligne par le service worker ; guide d'auto-hébergement (créer l'espace KV) ; en deux PR : serveur et contrat (décision [Photos des membres : stockage et contrat](../decisions/photos-stockage.md), retrait d'une photo compris, annulation rendue par le serveur dans la réponse du changement), fait ; app (envoi, annulation, retrait, avatar en photo, cache du service worker), fait ; (e) **mise en service** : arrêt pour le go du mainteneur avant de créer l'espace KV sur son compte Cloudflare et de reposer la config de l'instance dans le secret de la CI ; puis critère de fin de la décision [Édition du groupe et avatar](../decisions/edition-du-groupe.md), point a. Espace KV créé sans carte et config de l'instance reposée le 26/11 sur go du mainteneur ; photo posée depuis un Android, relue sur le serveur (JPEG sans EXIF, à l'endroit). Reste à constater : photo et membre ajouté vus sur un autre téléphone, encodage JPEG par Safari sur un iPhone réel (supposé bon par le mainteneur le 26/11). En cours.
14. **Onboarding d'installation sur téléphone** (noté par le mainteneur le 24/11) : inciter à installer l'app, passer par Chrome, l'abonnement de chaque groupe restant à part (décisions [Plusieurs groupes par téléphone](../decisions/plusieurs-groupes.md) et [Installation sur téléphone](../decisions/installation.md), l'autorisation des notifications restant hors du guide) ; partie téléphone en cinq PR : (1) détection du contexte, proposition à la première arrivée, guide Android par le bouton et par le menu de Chrome, fait ; (2) iPhone, Safari et Chrome, fait ; (3) Firefox sur Android et navigateur qui ne sait pas installer, fait ; (4) navigateur intégré, bandeau qui copie le lien, fait ; (5) entrée du profil et relance sans groupe, fait. Partie groupe à cadrer. En cours.
15. **Logs et observabilité côté app** (noté le 24/11, ordre à fixer). À faire.
16. **Filtres de la liste des dépenses** (décision [Filtres de la liste](../decisions/filtres-de-la-liste.md)) : pastilles « Me concerne » et « Payé par moi », feuille de filtres (recherche, type, payé par, concernés, montant, dates), choix des personnes en grille, résumé en étiquettes sous l'en-tête et en-tête du résultat ; état propre à chaque groupe, gardé en mémoire de l'app ; tests d'écran, bout en bout et captures. Fait (PR #50).

## Carte du dossier

- `README.md` : ce fichier, besoin, périmètre et plan ; les décisions sont dans `../decisions/`.
- `alternatives.md` : panorama des apps de partage de dépenses (16/11).
- `bases-open-source.md` : Spliit et SplitPro évalués comme base (16/11).
- `referentiel-fonctionnel.md` : fonctions des apps et usage réel du groupe (16/11).
- `hebergement.md` : options d'hébergement, piste Cloudflare approfondie (16/11).
- `sources/cloudflare-doc-codex-2026-11-16.md` : recherche documentaire Cloudflare de Codex.
- `export/lire_tricount.py` : export d'un tricount par son jeton.
- `essais/push-demo-server.mjs`, `essais/android-notification-recue.png` : essai Web Push sur Android.
- `retours-du-groupe.md` : retours des amis, triés contre l'usage mesuré (16 et 17/11).
- `essais/cloudflare/` : essai Worker Hono et D1 avec notifications ciblées, et mesure CPU ; traces non rejouables telles quelles (ni `package.json`, ni schéma de la table, ni clés VAPID ; `wrangler.jsonc` attend `src/index.ts`).
