# Héberger sa propre instance

La Pince n'est pas un service en ligne : chaque groupe héberge sa propre instance, sur son propre compte Cloudflare, dans l'offre gratuite. Ce guide mène d'un compte vide à une adresse à partager au groupe, en une demi-heure environ.

Une instance, c'est un Worker Cloudflare (le serveur, qui sert aussi l'app) et une base D1 (SQLite gérée par Cloudflare), gardée dans l'Union européenne. L'offre gratuite donne 100 000 requêtes par jour et une base de 500 Mo, très au-delà de ce qu'un groupe d'amis consomme.

## Ce qu'il faut

- Node à la version de `.node-version` et pnpm (version fixée par le champ `packageManager` de `package.json`).
- Un compte Cloudflare, créé sur https://dash.cloudflare.com/sign-up, offre gratuite, sans carte bancaire. Activer la double authentification (Profile, Authentication) : le compte gardera les dépenses du groupe.
- Un sous-domaine `workers.dev`, choisi dans le tableau de bord : Compute, Workers & Pages, encadré Account details, ligne Subdomain. L'app sera servie à `https://la-pince.<sous-domaine>.workers.dev`.

## 1. Récupérer le code

```sh
git clone https://github.com/lou-theo/la-pince.git
cd la-pince
pnpm install
```

## 2. Relier sa machine à son compte

```sh
pnpm --filter @la-pince/server exec wrangler login
```

La commande ouvre le navigateur pour autoriser Wrangler, l'outil en ligne de commande de Cloudflare. Sur une machine sans navigateur, un jeton d'API fait la même chose : My Profile, API Tokens, Create Token, modèle « Edit Cloudflare Workers » ; dans la carte Account policy (qui porte déjà le compte), ajouter D1 en cochant Edit ; le récapitulatif doit montrer « D1: Edit » et « Workers Scripts: Edit ». Le jeton se donne ensuite à Wrangler par les variables d'environnement `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` (l'identifiant du compte s'affiche dans Workers & Pages, Account details), ou par un fichier qui les contient, passé à chaque commande `wrangler` par `--env-file <fichier>`.

## 3. Créer la base

```sh
pnpm --filter @la-pince/server exec wrangler d1 create la-pince --jurisdiction eu
cp apps/server/wrangler.production.example.jsonc apps/server/wrangler.production.jsonc
```

`--jurisdiction eu` garde les données et leurs copies dans l'Union européenne ; ce choix ne se change plus après la création. La commande affiche un extrait de config : n'en prendre que l'identifiant de la base (`database_id`), le nom de liaison qu'elle propose n'étant pas celui de La Pince (`DB`), et le coller dans `apps/server/wrangler.production.jsonc` à la place de `<database id>`. Ce fichier est propre à l'instance et ignoré par git : il ne se publie pas.

## 4. Déployer

```sh
pnpm --filter @la-pince/server run deploy
```

La commande construit l'app, applique à la base les migrations qu'elle n'a pas encore, puis publie le Worker, et affiche l'adresse de l'instance. Au tout premier déploiement, l'adresse peut répondre « 404 Not Found » pendant une minute ou deux, le temps que Cloudflare la propage. La même commande sert à chaque mise à jour, après avoir récupéré la dernière version du code (`git pull`, puis `pnpm install`).

## 5. Poser le secret d'administration

La route d'administration, qui crée et remplace un groupe à l'import, refuse tout tant que son secret n'est pas posé. Le générer, le garder dans un gestionnaire de mots de passe, puis le donner à Cloudflare :

```sh
openssl rand -base64 32
pnpm --filter @la-pince/server exec wrangler secret put ADMIN_TOKEN --config wrangler.production.jsonc
```

La seconde commande demande la valeur sans l'afficher.

## 6. Créer le groupe

Un groupe se crée en important un export Tricount (voir `tools/import-tricount`). Pour essayer l'instance avant, le corpus de démonstration du repo, anonymisé, fait un groupe complet :

```sh
read -rs ADMIN_TOKEN && export ADMIN_TOKEN
export LA_PINCE_URL=https://la-pince.<sous-domaine>.workers.dev
export LA_PINCE_APP_URL=$LA_PINCE_URL
LA_PINCE_NEW_LINK=1 pnpm --filter @la-pince/import-tricount start "$PWD/packages/core/fixtures/tricount-demo.json"
```

L'import affiche le lien du groupe : c'est lui qu'on partage, et quiconque l'a peut lire et écrire dans le groupe. Il s'affiche une seule fois et n'est écrit nulle part ; le garder dans le gestionnaire de mots de passe. Pour réimporter le même groupe en gardant ce lien, remplacer `LA_PINCE_NEW_LINK=1` par `LA_PINCE_GROUP_TOKEN=<jeton du lien>`.

## Sauvegarde

D1 garde de quoi restaurer la base à la minute près sur les 7 derniers jours (Time Travel, inclus dans l'offre gratuite) :

```sh
pnpm --filter @la-pince/server exec wrangler d1 time-travel info la-pince --config wrangler.production.jsonc
pnpm --filter @la-pince/server exec wrangler d1 time-travel restore la-pince --timestamp=<date ISO 8601> --config wrangler.production.jsonc
```

Au-delà de 7 jours, rien n'est gardé : exporter la base de temps en temps (`wrangler d1 export la-pince --remote --output=<fichier>.sql --config wrangler.production.jsonc`) et garder le fichier hors de Cloudflare.
