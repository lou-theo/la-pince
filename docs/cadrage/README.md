# Alternative à Tricount : La Pince

**Conclusion (16/11/2026)** : aucune app existante ne convient ; le groupe développe la sienne, **La Pince**, une PWA open source sans compte, hébergée gratuitement sur Cloudflare (Workers et D1). Besoin, stack, hébergement et nom tranchés ; périmètre de la première version à redécouper en versions plus petites (décision ouverte 3). Repo `~/Perso/la-pince` créé le 16/11 ; prochaine étape : découpage en versions, architecture et stratégie de tests.

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

- **Première version** : groupe sans compte (membres avec ou sans l'app, « qui je suis », invitation par lien) ; saisie rapide (un payeur, sélection accélérée des participants : dernière sélection, membres fréquents en tête, tout cocher ou décocher ; répartition égale, par parts, en montants exacts ; remboursements) ; saisie hors ligne avec file d'envoi ; ma part sur chaque ligne, filtre « me concerne », recherche par texte, payeur, participant, montant et date ; notifications aux seuls concernés, auteur exclu ; soldes, remboursements suggérés, vue par membre (moi contre le groupe) ; import Tricount, export complet ; PWA utilisable sur ordinateur, guide d'installation iPhone.
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
- **Export Tricount** (vérifié le 16/11) : `export/lire_tricount.py` lit un groupe par le jeton de son lien, sans rattachement à un membre, par l'API non officielle de l'app Android. Le 16/11 le serveur refusait les anciennes versions d'app (HTTP 422 avec 7.0.7, version des exporteurs open source lus, et avec 14.6.1 ; signalé dans https://github.com/elrandar/tricount-api/issues/2) ; l'identifiant de la version 14.8.2, relu dans l'APK (classe UserAgentInterceptor), passe. Export en une page, le serveur ne signalant aucune page suivante (champ `Pagination` vide) : total des 236 dépenses 9 609,80 €, identique à l'app (confirmé par l'utilisateur) ; total des 14 remboursements (1 024,16 €) non recoupé, à contrôler par les soldes à l'étape 4. L'export brut, avec les noms du groupe, reste hors de tout repo ; il se régénère avec le script et le jeton du lien. Fragile pour une synchronisation continue, suffisant pour migrer.
- **Bases open source** (`bases-open-source.md`) : Spliit (MIT, sans compte, sans notifications) et SplitPro (MIT, comptes, notifications ciblées) évalués ; page blanche retenue, Spliit sert de référence pour le calcul.
- **Notifications** (vérifié le 16/11) : reçues dans Chrome sur un émulateur Android 15 avec Google Play, pas encore sur un vrai téléphone (`essais/android-notification-recue.png`, `essais/push-demo-server.mjs`) ; ciblage par « qui je suis » validé avec un Worker Cloudflare local et D1 (`essais/cloudflare/`), 0,56 ms de CPU par chiffrement de notification sous Node, hors envoi et D1, soit environ 5 ms pour les 9 destinataires au plus d'une dépense contre une limite de 10 ms par requête (calcul : 9 × 0,56), à mesurer sur Workers. Simulateur iOS : abonnement refusé, non concluant pour les vrais iPhone ; la doc Apple annonce le Web Push pour les apps web de l'écran d'accueil depuis iOS 16.4.
- **Hébergement** (`hebergement.md`, chiffres clés relus le 16/11) : Cloudflare D1 en juridiction UE garde ses réplicas dans l'UE ; Time Travel gratuit 7 jours ; offre gratuite : 100 000 requêtes par jour, 10 ms de CPU par requête, base de 500 Mo, 5 tâches planifiées, 50 requêtes SQL par invocation ; pas de gel des quotas garanti.
- **Nom** : repo `lou-theo/la-pince` libre sur GitHub (16/11) ; domaines lapince et la-pince en .fr, .com, .app, .eu pris ; adresse gratuite en sous-domaine workers.dev.

## Décisions

### Tranchées
1. **PWA** (16/11, dit par l'utilisateur) : installable, pas d'app native, « plus léger à développer et à gérer, surtout pour ceux sous iOS ».
2. **Sans compte** (16/11, dit par l'utilisateur) : chacun choisit qui il est ; certains membres n'ont pas le lien et d'autres saisissent pour eux en confiance. Coût si faux : quiconque a le lien peut se déclarer quelqu'un d'autre, comme dans Tricount.
3. **iPhone sur la foi de la doc Apple** (16/11, dit par l'utilisateur : « si c'est le cas faisons confiance ») : pas de test sur un vrai iPhone avant la mise en service.
4. **Répartition du travail** (16/11, dit par l'utilisateur) : « tu codes l'essentiel et je relis » ; architecture propre, tests à plusieurs niveaux.
5. **Page blanche plutôt que fork de Spliit** (16/11, dit par l'utilisateur) : Spliit fait environ 17 000 lignes hors tests et 58 dépendances, pour 527 lignes de cœur de calcul (commit `f293974`) ; algorithmes et cas de test repris sous licence MIT, cités. Références fonctionnelles multiples : Tricount pour la base, Sesterce, Spliit, toute autre app. Coût si faux : quelques jours d'interface (au jugé).
6. **Périmètre** (16/11) : section Périmètre ; hors ligne en première version, catégories en « plus tard », commande groupée au lot 2 (dit par l'utilisateur).
7. **Hébergement et stack** (16/11, dit par l'utilisateur) : Cloudflare Workers et D1 en juridiction UE, offre gratuite ; perte de la gratuité ou dépassement jugés peu probables, « on cherchera autre chose » ; pas de matériel à la maison, serveur loué « beaucoup trop cher ». Stack : TypeScript, PWA React avec Vite, IndexedDB et file d'envoi côté téléphone (identifiant unique créé sur le téléphone, envoi rejouable sans doublon), Hono et Drizzle côté serveur, SQLite (D1), Vitest et Playwright. Code portable vers un serveur Node si besoin.
8. **Nom** (16/11, dit par l'utilisateur) : « La Pince », surnom du groupe pour les radins ; slogan possible « Qui sera la plus grosse pince ? ».
9. **Saisie par montants en première version** (16/11, dit par l'utilisateur, retour du groupe) : saisir le montant de chacun sans total, le total se calcule ; total saisi qui ne correspond pas à la somme : enregistrement refusé. Les trois autres ajouts proposés (bascule « ma part / total », barre de répartition, emoji automatique) n'y entrent pas (« pas tout en 1ere version non ») ; ce que le périmètre prévoyait déjà (ma part sur chaque ligne, soldes) reste à redécouper (décision ouverte 3).

### Ouvertes
1. **Sauvegarde au-delà de 7 jours** (16/11, présentée le 16/11) : « on trouvera une solution » (dit par l'utilisateur) ; piste : export hebdomadaire automatique vers un repo GitHub privé (déduit, non vérifié).
2. **Manques de Sesterce** (16/11, présentée le 16/11) : ce qui manque à Sesterce pour le groupe, demandé à l'utilisateur, sans réponse ; non bloquant.
3. **Découpage en versions** (16/11, présentée le 16/11) : « la 1ere version aura probablement beaucoup moins de choses (on sera à beaucoup plus que 3 ou 4 versions) » (dit par l'utilisateur) ; le périmètre « Première version » ci-dessus est à redécouper en versions successives plus petites, à l'étape 3 (moment déduit) ; les retours du groupe (`retours-du-groupe.md`) s'y répartissent, hors saisie par montants (décision 9).

## Plan (validé le 16/11)

1. **Référentiel fonctionnel** : Fait (`referentiel-fonctionnel.md`).
2. **Hébergement et stack** : Fait (`hebergement.md`).
3. **Repo du projet** : `~/Perso/la-pince` créé, cadrage migré dans `docs/cadrage/` (16/11) ; reste l'architecture et la stratégie de tests (unitaires, intégration, bout en bout), cœur de calcul repris de Spliit avec ses cas de test. En cours.
4. **Import Tricount** : membres, dépenses, répartitions et remboursements depuis l'export JSON ; tests, puis contrôle sur les vraies données (total 9 609,80 € et soldes identiques à Tricount). À faire.
5. **Première version** : périmètre redécoupé à l'étape 3 (décision ouverte 3). À faire.
6. **Mise en ligne** sur Cloudflare avec sauvegarde et export. À faire.
7. **Vérification de bout en bout** : critère de fin de la section Besoin. À faire.

## Par où reprendre

Étape 3, dans une session ouverte depuis `~/Perso/la-pince` : trancher le découpage en versions (décision ouverte 3) en y répartissant les retours du groupe (`retours-du-groupe.md`), puis proposer l'architecture et la stratégie de tests avant le premier code. Le repo GitHub `lou-theo/la-pince` reste à créer par l'utilisateur (le `gh` de la machine n'est connecté qu'au compte pro) ; remote déjà posé : `git@github.com-perso:lou-theo/la-pince.git`. Export brut, clés et APK décompilée : `temp/tricount/` du repo (ignoré). Pour l'étape 4, demander à l'utilisateur le lien du tricount (son jeton donne l'accès en écriture au groupe : jamais dans un fichier versionné) et générer `pub.pem` selon l'en-tête de `export/lire_tricount.py`.

## Carte du dossier

- `README.md` : ce fichier, état du sujet.
- `alternatives.md` : panorama des apps de partage de dépenses (16/11).
- `bases-open-source.md` : Spliit et SplitPro évalués comme base (16/11).
- `referentiel-fonctionnel.md` : fonctions des apps et usage réel du groupe (16/11).
- `hebergement.md` : options d'hébergement, piste Cloudflare approfondie (16/11).
- `sources/cloudflare-doc-codex-2026-11-16.md` : recherche documentaire Cloudflare de Codex.
- `export/lire_tricount.py` : export d'un tricount par son jeton.
- `essais/push-demo-server.mjs`, `essais/android-notification-recue.png` : essai Web Push sur Android.
- `retours-du-groupe.md` : premiers retours des amis, triés contre l'usage mesuré (16/11).
- `essais/cloudflare/` : essai Worker Hono et D1 avec notifications ciblées, et mesure CPU ; traces non rejouables telles quelles (ni `package.json`, ni schéma de la table, ni clés VAPID ; `wrangler.jsonc` attend `src/index.ts`).
