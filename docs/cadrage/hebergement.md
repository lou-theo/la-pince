# Hébergement et stack (relevé du 16/11/2026)

**Retenu le 16/11/2026 : Cloudflare Workers et D1, juridiction UE, offre gratuite (README, décision 7).** Les autres options restent documentées ici comme alternatives écartées.

Statut : recherche d'un sous-agent le 16/11/2026, non contre-vérifiée ; chiffres clés relus dans leur page le 16/11 (sections suivantes). [L] lu dans la page de l'éditeur (par un modèle de résumé, pas un relevé brut), [NL] non lu dans la source, [D] déduit.

## En bref

- Trois combinaisons tiennent pour 13 personnes : un petit serveur loué en UE (environ 86 à 104 € TTC par an), Cloudflare Workers et D1 (0 €), Neon et Vercel Hobby (0 €). Les deux gratuites demandent d'écrire soi-même une sauvegarde hors site, la rétention native étant courte (7 jours et 6 heures).
- Écartés : Render free (base supprimée après 30 jours), Supabase free (pause après une semaine d'inactivité), Oracle Always Free (instances inactives récupérées, ce qui correspond à notre usage), Fly.io (plus d'offre gratuite).
- Stack la plus portable : un serveur Node unique (Hono, ou SvelteKit ou React Router v7 en mode Node) avec SQLite ou Postgres, en image Docker ; Next.js est plus lié à Vercel.

## Chiffres relus le 16/11/2026

- Hetzner : CX23 (2 vCPU, 4 Go, 40 Go NVMe) à 5,99 € HT par mois, relu sur https://www.hetzner.com/cloud/cost-optimized/ ; la page affiche « not available » sur toutes les offres (statique ou par région, non établi) : disponibilité à vérifier à la commande. Coût annuel avec la sauvegarde Hetzner (20 % du prix) : 86,26 € HT, 103,51 € TTC à 20 % ; sans : 71,88 € HT, 86,26 € TTC (calcul exécuté le 16/11 ; TVA française supposée pour un particulier).
- Cloudflare D1 gratuit : 100 000 lignes écrites par jour, 500 Mo par base et 5 Go par compte, relu sur https://developers.cloudflare.com/d1/platform/pricing/.
- Neon gratuit : 100 CU-heures et 1 Go par projet, calcul éteint après 5 minutes d'inactivité, historique de 6 heures ou 1 Go de changements, relu sur https://neon.com/pricing.

## Piste Cloudflare approfondie (16/11)

Recherche documentaire par Codex (`sources/cloudflare-doc-codex-2026-11-16.md`), passages clés relus par la session principale le 16/11 (marqués « relu »), et essai local (`essais/cloudflare/`).

- Données en UE : une base D1 créée avec `--jurisdiction=eu` garde ses réplicas dans l'UE (« If a jurisdiction is configured, read replicas are only created within the jurisdiction set on database creation », relu sur https://developers.cloudflare.com/d1/configuration/data-location/) ; à choisir à la création, non modifiable ensuite. Non établi : localisation des sauvegardes Time Travel ; disponibilité de la juridiction en offre gratuite (aucune restriction trouvée).
- Sauvegarde : Time Travel toujours actif, sans coût, restauration à la minute sur 7 jours en gratuit (relu sur https://developers.cloudflare.com/d1/platform/limits/) ; export SQL complet par `wrangler d1 export` ou par l'API REST. Un export planifié vers R2 demande une souscription R2 à part ; un export planifié hors Cloudflare (tâche planifiée GitHub vers un repo privé) éviterait cette souscription (déduit, non vérifié).
- Limites gratuites relues sur https://developers.cloudflare.com/workers/platform/limits/ et https://developers.cloudflare.com/d1/platform/limits/ : 100 000 requêtes par jour, 10 ms de CPU par requête (l'attente réseau ne compte pas), 50 sous-requêtes, 5 tâches planifiées par compte, base D1 de 500 Mo au plus (5 Go par compte), 50 requêtes SQL par invocation. Au dépassement : erreurs jusqu'au lendemain (lu par Codex) ; pas de facturation automatique (déduit par Codex).
- Notifications : essai local concluant, 0,56 ms de CPU par chiffrement de notification sous Node, hors envoi, D1 et runtime Workers (mesure de substitution) ; le plafond de 10 ms vaut par requête, soit environ 5 ms pour les 9 destinataires au plus d'une dépense (calcul : 9 × 0,56), à mesurer sur Workers ; Codex conseille de garder en base les notifications à renvoyer, `waitUntil` étant coupé 30 s après la réponse.
- Conditions : démarrage sans carte bancaire ; Cloudflare peut modifier ou retirer une offre gratuite (lu par Codex dans les conditions générales). Pas de restriction non commerciale trouvée, aucun gel des quotas garanti (déduit par Codex).

## Options

| Critère | Hetzner VPS | Netcup VPS | Cloudflare Workers + D1 | Neon free + Vercel Hobby | Oracle Always Free | Fly.io |
|---|---|---|---|---|---|---|
| Prix | 5,99 € HT/mois, 2 vCPU, 4 Go [L], soit 7,13 à 7,19 € TTC selon la TVA appliquée [D] ; sauvegarde quotidienne × 7 environ 1,20 € HT [D] | 9,50 € TTC/mois, engagement 12 mois [L] | 0 € ; payant dès 5 $/mois [L] | 0 € [L] | 0 € [L] | ~2,34 $ HT/mois [D] |
| Limites qui nous touchent | serveur facturé tant qu'il existe [L] | | 100 000 requêtes/jour, 10 ms CPU par appel, D1 500 Mo par base [L] | Neon : 1 Go, calcul éteint après 5 min, réveil en quelques centaines de ms [L] ; Vercel : cron une fois par jour à ±59 min [L], usage non commercial [NL] | instance récupérée si inactive 7 jours (CPU, réseau, mémoire sous 20 %) [L] | pas d'offre gratuite [L] |
| Sauvegarde native | 7 quotidiennes [L] | snapshots inclus [L] | 7 jours de restauration [L] | 6 heures d'historique [L] | 5 sauvegardes de volume [L] | snapshots 5 jours [L] |
| Sortie des données | dump standard | dump standard | export par API [L] | pg_dump | dump standard | dump standard |
| Données en UE | oui [L] | oui [L] | oui avec `--jurisdiction=eu` [L] | Francfort [L] | selon la région choisie [D] | non lu |
| Web Push et cron | sans limite [D] | sans limite [D] | cron oui, Web Push : essai local concluant | cron limité [L] | sans limite [D] | sans limite [D] |
| Maintenance | à notre charge | à notre charge | aucune | aucune | à notre charge | faible |

Sources : https://www.hetzner.com/cloud/cost-optimized/ ; https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/ ; https://www.netcup.com/en/server/vps ; https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/d1/reference/time-travel/ ; https://neon.com/pricing ; https://neon.com/docs/introduction/regions ; https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/cron-jobs/usage-and-pricing ; https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm ; https://docs.fly.io/about/pricing ; https://render.com/docs/free ; https://supabase.com/pricing ; https://turso.tech/pricing (toutes lues le 16/11/2026 par le sous-agent).

## Combinaisons

1. **Hetzner, Docker, serveur Node, SQLite, Caddy, sauvegarde chiffrée hors site** : (5,99 + 1,198) × 12 = 86,26 € HT par an, 102,65 à 103,51 € TTC ; sans l'option de sauvegarde Hetzner, 71,88 € HT, 85,54 à 86,26 € TTC [D, calcul du sous-agent]. Contrôle total, export en une commande, pas de limite ; maintenance système à notre charge.
2. **Cloudflare Workers, D1, Hono, export planifié vers un stockage à nous** : 0 € sous les quotas gratuits ; aucune maintenance ; retenue (section Piste Cloudflare approfondie).
3. **Neon free à Francfort, serveur Node léger, Postgres standard** : 0 € ; sauvegarde quotidienne à écrire et à lancer hors de Vercel ; clause non commerciale de Vercel Hobby non lue.

## Pages non lues

Scaleway (403) et OVH (page tronquée) : pas de prix d'hébergeur français. Page TVA de Hetzner (404). Limites des Cron Triggers et régions de Cloudflare, conditions de Vercel Hobby, SLA et historiques d'incidents : non lus.
