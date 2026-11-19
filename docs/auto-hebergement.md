# Héberger sa propre instance

La Pince n'est pas un service en ligne : chaque groupe héberge sa propre instance, sur son propre compte Cloudflare, dans l'offre gratuite. Ce guide mène d'un compte vide à une adresse à partager au groupe.

Une instance, c'est un Worker Cloudflare (le serveur, qui sert aussi l'app) et une base D1 (SQLite gérée par Cloudflare), gardée dans l'Union européenne. L'offre gratuite donne notamment 100 000 requêtes par jour et une base de 500 Mo, très au-delà de ce qu'un groupe d'amis consomme ; ces limites évoluent, les pages de Cloudflare font foi : https://developers.cloudflare.com/workers/platform/limits/ et https://developers.cloudflare.com/d1/platform/limits/.

## Ce qu'il faut

- Git, Node à la version de `.node-version` (installable avec un gestionnaire de versions comme fnm ou nvm) et pnpm (https://pnpm.io/installation), sur macOS ou Linux.
- Un compte Cloudflare, créé sur https://dash.cloudflare.com/sign-up, offre gratuite. Activer la double authentification (Profile, Authentication) : le compte gardera les dépenses du groupe.
- Un sous-domaine `workers.dev`, choisi dans le tableau de bord : Compute, Workers & Pages, encadré Account details, ligne Subdomain. L'app sera servie à `https://la-pince.<sous-domaine>.workers.dev`.
- Un export du groupe Tricount à reprendre : la version 1 ne crée un groupe que par import (étape 6).

## 1. Récupérer le code

```sh
git clone https://github.com/lou-theo/la-pince.git
cd la-pince
pnpm install
```

Toutes les commandes qui suivent se lancent depuis ce dossier.

## 2. Relier sa machine à son compte

```sh
pnpm --filter @la-pince/server exec wrangler login
```

La commande ouvre le navigateur pour autoriser Wrangler, l'outil en ligne de commande de Cloudflare. Sur une machine sans navigateur, un jeton d'API fait la même chose :

1. My Profile, API Tokens, Create Token, modèle « Edit Cloudflare Workers ».
2. Dans la carte Account policy, qui porte déjà le compte, ajouter D1 et Queues en cochant Edit pour chacun.
3. Le récapitulatif doit montrer « D1: Edit », « Queues: Edit » et « Workers Scripts: Edit ».
4. Donner le jeton à Wrangler par les variables d'environnement `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` (l'identifiant du compte s'affiche dans Workers & Pages, Account details), ou par un fichier qui les contient, passé à chaque commande `wrangler` par `--env-file <fichier>`.

## 3. Créer la base et la file

```sh
pnpm --filter @la-pince/server exec wrangler d1 create la-pince --jurisdiction eu --update-config=false
pnpm --filter @la-pince/server exec wrangler queues create la-pince-notifications
cp apps/server/wrangler.production.example.jsonc apps/server/wrangler.production.jsonc
```

`--jurisdiction eu` garde les données et leurs copies dans l'Union européenne ; ce choix ne se change plus après la création. `--update-config=false` empêche Wrangler d'écrire la base dans `wrangler.jsonc`, qui reste la config du développement local et des tests. La commande affiche un extrait de config : n'en prendre que l'identifiant de la base (`database_id`) et le coller dans `apps/server/wrangler.production.jsonc` à la place de `<database id>`. Ce fichier est propre à l'instance et ignoré par git : il ne se publie pas. La file `la-pince-notifications` porte les notifications d'une dépense vers les téléphones (section 5) ; le déploiement échoue tant qu'elle n'existe pas.

## 4. Déployer

```sh
pnpm --filter @la-pince/server run deploy
```

`run` est nécessaire : `pnpm deploy` est une autre commande, propre à pnpm. Le script construit l'app, applique à la base les migrations qu'elle n'a pas encore, puis publie le Worker, et affiche l'adresse de l'instance. Au tout premier déploiement, l'adresse peut répondre « 404 Not Found » pendant une minute ou deux, le temps que Cloudflare la propage.

Pour mettre à jour l'instance : `git pull`, `pnpm install`, puis comparer sa config au modèle, qui a pu changer (`diff apps/server/wrangler.production.example.jsonc apps/server/wrangler.production.jsonc` ne doit montrer que l'identifiant de la base), reporter les changements, et relancer le déploiement. Une instance installée avant les notifications voit apparaître le bloc `queues` : avant de le reporter, ajouter « Queues: Edit » au jeton du déploiement (section 2, celui de la CI compris), créer la file (section 3), puis poser les clés (section 5, « Clés des notifications ») ; sans le bloc, l'instance continue de tourner, sans notifications.

### Déployer à chaque fusion sur `main` (facultatif)

Sur un repo GitHub à soi (un fork, par exemple, dont les workflows sont à activer d'abord dans l'onglet Actions), la CI peut déployer l'instance après chaque arrivée sur `main`, une fois les tests et les tests de bout en bout passés : c'est le job `deployer` de `.github/workflows/verifier.yml`. Il lit trois secrets de l'environnement GitHub `production` et ne fait rien tant qu'ils manquent. Aucune validation n'est demandée : ce qui arrive sur `main` est en ligne quelques minutes après, migrations de la base comprises ; en cas de problème, la base se restaure par la section Sauvegarde.

1. Créer l'environnement `production`, réservé à `main` pour qu'aucune autre branche ne lise ses secrets (Settings, Environments, New environment, puis Deployment branches and tags, Selected branches and tags, `main`), ou en ligne de commande, `<compte>/<repo>` étant le repo GitHub :

   ```sh
   gh api -X PUT repos/<compte>/<repo>/environments/production -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/<compte>/<repo>/environments/production/deployment-branch-policies -f name=main
   ```

2. Y poser les secrets : le jeton d'API de la section 2 (« D1: Edit », « Queues: Edit » et « Workers Scripts: Edit »), l'identifiant du compte, et le contenu de `apps/server/wrangler.production.jsonc` encodé en base64, sur une seule ligne, pour que GitHub ne masque pas chacune de ses lignes dans les journaux. `gh secret set` sans valeur demande de la coller, sans l'afficher :

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --env production -R <compte>/<repo>
   gh secret set CLOUDFLARE_ACCOUNT_ID --env production -R <compte>/<repo>
   base64 < apps/server/wrangler.production.jsonc | gh secret set WRANGLER_PRODUCTION_JSONC_BASE64 --env production -R <compte>/<repo>
   ```

Le déploiement suivant part à la prochaine arrivée sur `main`. Son résultat est dans l'onglet Actions du repo, sans la sortie de Wrangler : les journaux d'un repo public sont publics, et elle contient l'adresse de l'instance ; en cas d'échec, elle s'affiche sans adresses ni identifiants. Un déploiement ne part que si son commit est encore le dernier de `main`, pour qu'un ancien passage relancé ne remette pas un code plus ancien sur une base déjà migrée. Quand le modèle de config change (comparaison ci-dessus), reposer `WRANGLER_PRODUCTION_JSONC_BASE64` avec la config à jour, après avoir donné au jeton les droits que le changement demande. Si les migrations passent mais que la publication du Worker échoue, l'ancien code tourne sur la nouvelle base jusqu'au déploiement suivant : relancer le job `deployer` du dernier passage sur `main`.

## 5. Poser le secret d'administration

La route d'administration, qui crée et remplace un groupe à l'import, refuse tout tant que son secret n'est pas posé. Le générer, le garder dans un gestionnaire de mots de passe, puis le donner à Cloudflare :

```sh
openssl rand -base64 32
pnpm --filter @la-pince/server exec wrangler secret put ADMIN_TOKEN --config wrangler.production.jsonc
```

La seconde commande demande la valeur sans l'afficher.

### Clés des notifications

Les notifications partent du Worker vers le service de notifications de chaque téléphone (Google, Apple, Mozilla, Microsoft), signées par une paire de clés VAPID propre à l'instance. Les créer et les donner à Cloudflare sans qu'elles s'écrivent dans un fichier ni s'affichent :

```sh
keys=$(node apps/server/scripts/vapid-keys.ts)
printf '%s' "${keys%% *}" | pnpm --filter @la-pince/server exec wrangler secret put VAPID_PUBLIC_KEY --config wrangler.production.jsonc
printf '%s' "${keys##* }" | pnpm --filter @la-pince/server exec wrangler secret put VAPID_PRIVATE_KEY --config wrangler.production.jsonc
unset keys
```

Une seule fois par instance : changer de clés désabonne tous les téléphones, qui doivent réactiver les notifications. Sans ces deux secrets, ou sans la file, l'instance tourne sans notifications et l'app ne les propose pas.

## 6. Créer le groupe

Un groupe se crée en important un export Tricount avec `tools/import-tricount` ; `docs/cadrage/export/lire_tricount.py` lit un groupe Tricount par le lien de partage, au moyen de l'API non officielle de l'app. Pour essayer l'instance avant, le corpus de démonstration du repo, anonymisé, fait un groupe complet :

```sh
read -rs ADMIN_TOKEN && export ADMIN_TOKEN
export LA_PINCE_URL=https://la-pince.<sous-domaine>.workers.dev
export LA_PINCE_APP_URL=$LA_PINCE_URL
LA_PINCE_NEW_LINK=1 pnpm --filter @la-pince/import-tricount start "$PWD/packages/core/fixtures/tricount-demo.json"
```

`read -rs` attend le secret d'administration, collé sans qu'il s'affiche ni reste dans l'historique du shell. L'import affiche le lien du groupe : c'est lui qu'on partage, et quiconque l'a peut lire et écrire dans le groupe. Il s'affiche une seule fois et n'est écrit nulle part ; le garder dans le gestionnaire de mots de passe. Pour réimporter le même groupe en gardant ce lien, donner son jeton (la fin du lien, après `/g/`) de la même façon, `read -rs LA_PINCE_GROUP_TOKEN && export LA_PINCE_GROUP_TOKEN`, puis relancer la dernière commande sans `LA_PINCE_NEW_LINK=1` ; dans un nouveau terminal, redonner d'abord `ADMIN_TOKEN`, `LA_PINCE_URL` et `LA_PINCE_APP_URL` comme ci-dessus. Un lien perdu se redemande à un membre du groupe, qui le partage depuis l'app (« Partager le lien du groupe ») ; si plus personne ne l'a, un import avec `LA_PINCE_NEW_LINK=1` en donne un nouveau, à renvoyer à tous.

## Sauvegarde

D1 garde de quoi restaurer la base à la minute près sur les 7 derniers jours (Time Travel, inclus dans l'offre gratuite) :

```sh
pnpm --filter @la-pince/server exec wrangler d1 time-travel info la-pince --config wrangler.production.jsonc
pnpm --filter @la-pince/server exec wrangler d1 time-travel restore la-pince --timestamp=<date ISO 8601> --config wrangler.production.jsonc
```

Après une fusion qui a abîmé la base, avec le déploiement automatique : annuler d'abord la PR fautive sur `main` (revert), puis restaurer, sans relancer entre-temps de passage qui contient encore la migration : la restauration efface aussi la trace de son passage, et tout déploiement de ce code la rejouerait.

### Copie quotidienne, au-delà de 7 jours

Au-delà de 7 jours, Cloudflare ne garde rien, et une copie qui protège aussi de la perte du compte doit vivre ailleurs. `tools/sauvegarde/sauvegarde.yml` est une tâche planifiée GitHub qui exporte la base chaque nuit et commite une copie dans un repo privé, seulement si la base a changé : l'historique du repo donne la base à toute date passée. Le fichier est compressé puis chiffré avec age (https://age-encryption.org) vers une clé publique : la tâche et le repo ne peuvent pas le relire, seule la clé privée, gardée dans un gestionnaire de mots de passe, l'ouvre. Cette clé perdue, aucune copie ne se restaure plus. À côté de la copie, la tâche commite la clé publique utilisée et l'empreinte SHA-256 de l'export en clair, qui lui sert à voir si la base a changé ; cette empreinte ne permet que de confirmer qu'une base entière qu'on détient déjà est celle de la copie. Elle tient dans les minutes gratuites de GitHub Actions pour un repo privé ; l'export bloque la base le temps qu'il tourne, quelques secondes pour un groupe.

1. Créer un jeton d'API réservé à la sauvegarde, pour que GitHub ne garde pas celui du déploiement : My Profile, API Tokens, Create Token, Custom token, permission Account, D1, Edit (l'export est refusé en lecture seule) ; le récapitulatif doit montrer « D1: Edit » seul.
2. Créer le repo privé à côté du dossier du code, pas dedans, et y mettre la tâche (`<compte>` étant son compte GitHub) :

   ```sh
   cd ..
   gh repo create <compte>/la-pince-sauvegardes --private --clone
   mkdir -p la-pince-sauvegardes/.github/workflows
   cp la-pince/tools/sauvegarde/sauvegarde.yml la-pince-sauvegardes/.github/workflows/
   git -C la-pince-sauvegardes add .github && git -C la-pince-sauvegardes commit -m "Tâche de sauvegarde" && git -C la-pince-sauvegardes push -u origin HEAD
   cd la-pince
   ```

3. Y poser le jeton et l'identifiant du compte (section 2) ; une base qui ne s'appelle pas `la-pince` se nomme en plus par la variable `D1_DATABASE` (dernière commande) :

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN -R <compte>/la-pince-sauvegardes
   gh secret set CLOUDFLARE_ACCOUNT_ID -R <compte>/la-pince-sauvegardes
   gh variable set D1_DATABASE --body <nom de la base> -R <compte>/la-pince-sauvegardes
   ```

4. Installer age (`brew install age` sur macOS, le paquet `age` de la distribution sur Linux), puis créer la paire de clés sans que la clé privée s'écrive dans un fichier ni s'affiche : la clé publique part en secret `AGE_RECIPIENT` du repo, la clé privée dans le presse-papiers (`pbcopy` sur macOS ; sur Linux, `wl-copy` ou `xclip -selection clipboard`). Un historique du presse-papiers (celui de Spotlight sur macOS, Raycast, Maccy, Klipper sous KDE) garderait la clé : le mettre en pause avant, ou y effacer l'entrée après.

   ```sh
   cle=$(age-keygen) && printf '%s\n' "$cle" | pbcopy && printf '%s\n' "$cle" | age-keygen -y | gh secret set AGE_RECIPIENT -R <compte>/la-pince-sauvegardes
   unset cle
   ```

   `age-keygen` affiche la clé publique, qui n'a rien de secret. Coller aussitôt le presse-papiers dans une entrée du gestionnaire de mots de passe (par exemple dans ses notes : trois lignes, dont celle qui commence par `AGE-SECRET-KEY-`), l'enregistrer, puis vider le presse-papiers en y copiant autre chose. C'est le seul exemplaire de la clé : sans elle, les copies sont illisibles. Une clé changée plus tard (même commandes) rechiffre la copie au passage suivant ; les copies plus anciennes ne s'ouvrent qu'avec l'ancienne clé, à garder.

5. Lancer une première copie sans attendre la nuit, suivre son passage (`gh run watch` le propose quelques secondes après le lancement, le temps que GitHub le crée), puis vérifier que la copie `la-pince.sql.gz.age` est arrivée dans le repo :

   ```sh
   gh workflow run sauvegarde.yml -R <compte>/la-pince-sauvegardes
   gh run watch -R <compte>/la-pince-sauvegardes
   git -C ../la-pince-sauvegardes pull && git -C ../la-pince-sauvegardes log --oneline -- la-pince.sql.gz.age
   ```

6. Vérifier que la clé gardée ouvre la copie, sans rien écrire en clair : copier la clé depuis le gestionnaire de mots de passe, puis comparer l'empreinte de la copie déchiffrée à celle que la tâche a commitée ; les deux lignes affichées doivent être identiques. Vider ensuite le presse-papiers.

   ```sh
   pbpaste | age -d -i - ../la-pince-sauvegardes/la-pince.sql.gz.age | gunzip | shasum -a 256 | cut -d ' ' -f 1
   cat ../la-pince-sauvegardes/la-pince.sql.sha256
   ```

GitHub prévient par mail d'une copie en échec la personne qui a poussé la tâche, selon ses réglages de notifications. Une tâche planifiée peut partir en retard, ou plus rarement sauter un jour, quand GitHub est chargé.

### Restaurer une copie

Une copie se rejoue dans une base neuve, vers laquelle l'instance bascule ensuite ; l'ancienne reste intacte tant qu'on ne la supprime pas. Les copies sont commitées par GitHub : rapatrier d'abord l'historique, puis choisir `<commit>`, celui de la copie voulue, et copier la clé privée depuis le gestionnaire de mots de passe : `age` la lit dans le presse-papiers (`pbpaste` sur macOS ; sur Linux, `wl-paste` ou `xclip -selection clipboard -o`), sans fichier. Le fichier déchiffré contient tous les groupes en clair : il va dans `temp/`, que git ignore, jamais ailleurs dans le dossier du code. Déchiffrer d'abord, puis vider le presse-papiers en y copiant autre chose :

```sh
git -C ../la-pince-sauvegardes pull && git -C ../la-pince-sauvegardes log --oneline -- la-pince.sql.gz.age
mkdir -p temp && git -C ../la-pince-sauvegardes show <commit>:la-pince.sql.gz.age > "$PWD/temp/la-pince-restauree.sql.gz.age"
pbpaste | age -d -i - "$PWD/temp/la-pince-restauree.sql.gz.age" | gunzip > "$PWD/temp/la-pince-restauree.sql" && test -s "$PWD/temp/la-pince-restauree.sql" && echo "Copie déchiffrée"
```

Ne continuer que si « Copie déchiffrée » s'affiche : une mauvaise clé, un presse-papiers vide ou une copie abîmée laissent un fichier vide ou partiel, qui donnerait une base fausse, et qu'on supprime alors (`rm` de la dernière ligne ci-dessous). Puis rejouer la copie dans une base neuve et supprimer le fichier en clair :

```sh
pnpm --filter @la-pince/server exec wrangler d1 create la-pince-restauree --jurisdiction=eu --update-config=false
pnpm --filter @la-pince/server exec wrangler d1 execute la-pince-restauree --remote --file="$PWD/temp/la-pince-restauree.sql"
rm "$PWD/temp/la-pince-restauree.sql" "$PWD/temp/la-pince-restauree.sql.gz.age"
```

Enfin, dans `apps/server/wrangler.production.jsonc`, remplacer seulement `database_id` par celui de la base neuve (donné par `d1 create`), en gardant `database_name` à `la-pince` : le déploiement et les commandes Time Travel trouvent la base par ce nom dans la config, et viseraient sinon l'ancienne base ou échoueraient ; redéployer (section 4, et reposer `WRANGLER_PRODUCTION_JSONC_BASE64` si la CI déploie), et donner `la-pince-restauree` à la variable `D1_DATABASE` du repo de sauvegarde. Les téléphones voient que la base a changé et relisent leur groupe en entier ; ce qui a été saisi après la copie est perdu, sauf ce qui attendait encore dans la file d'envoi d'un téléphone.
