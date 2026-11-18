**L'offre gratuite paraît adaptée au volume annoncé, mais deux points restent à établir : la localisation précise des sauvegardes Time Travel et le budget CPU des notifications envoyées à plusieurs abonnements.** Cette appréciation est déduite des quotas publiés, sans mesure de votre application. [Sources : limites Workers, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/) et [tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/).

Recherche arrêtée au **16/11/2026**. Les dates indiquées sont celles affichées par les pages. « Sans date affichée » ne désigne pas la date d'indexation du moteur. Les commandes ci-dessous sont des exemples documentaires et n'ont pas été exécutées.

**1. Localisation D1 et juridiction européenne**

**Lu dans la source.** D1 propose bien `jurisdiction: "eu"`. Elle se choisit à la création et ne peut ensuite être ajoutée ou modifiée. Exemple officiel : `npx wrangler@latest d1 create db-with-jurisdiction --jurisdiction=eu`. Les indications `weur` et `eeur` existent aussi, mais ne garantissent pas la localisation. La juridiction prévaut sur une indication géographique. [Documentation « Data location », 02/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/).

Phrase officielle exacte :

> “If a jurisdiction is configured, read replicas are only created within the jurisdiction set on database creation.”

**Lu dans la source.** Les réplicas d'une base créée avec `eu` restent donc dans cette juridiction. Sans juridiction, la réplication peut distribuer les copies mondialement. Le Worker peut néanmoins accéder à la base depuis n'importe où : cette configuration ne garantit pas un traitement intégral de l'application en UE. [Même documentation, 02/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/).

**Déduit.** L'utilisation des juridictions et indications géographiques en offre gratuite paraît permise : aucune restriction de formule n'est annoncée dans leur documentation, et D1 dispose d'une offre gratuite. Je n'ai cependant pas trouvé de phrase officielle disant expressément « EU jurisdictions are available on Free ». [Localisation D1, 02/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/) ; [tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/).

**Déduit, information non établie.** Localisation physique des sauvegardes Time Travel : **?** Les pages consultées n'explicitent pas séparément leur implantation ni leur confinement dans `eu`. La garantie générale de localisation de la base ne suffit pas à documenter ce détail. [Localisation D1, 02/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/) ; [Time Travel, 06/11/2026](https://developers.cloudflare.com/d1/reference/time-travel/).

**2. Sauvegardes, exports et planification**

**Lu dans la source.** Time Travel conserve **7 jours en Free**, contre 30 jours en Paid. La documentation décrit une restauration à la minute ; l'acceptation d'un timestamp en secondes ne constitue pas une promesse de granularité à la seconde. [Limites D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/limits/) ; [Time Travel, 06/11/2026](https://developers.cloudflare.com/d1/reference/time-travel/).

Phrases officielles exactes :

> “You do not need to enable Time Travel. It is always on.”

> “Database history and restoring a database incur no additional costs.”

**Lu dans la source.** Time Travel est automatique, sans supplément pour l'historique ou la restauration. On restaure avec `wrangler d1 time-travel restore BASE --timestamp=UNIX_TIMESTAMP`, ou avec `--bookmark=BOOKMARK`. L'opération remplace la base en place, annule les requêtes en cours et retourne un bookmark permettant de revenir à l'état antérieur. [Time Travel, 06/11/2026](https://developers.cloudflare.com/d1/reference/time-travel/).

**Lu dans la source.** L'export complet du schéma et des données utilise :

```text
npx wrangler d1 export BASE --remote --output=./database.sql
```

La réimportation dans D1 passe par `wrangler d1 execute BASE --remote --file=./database.sql`. Un export en cours bloque les autres requêtes sur cette base. [Import et export D1, 21/04/2026](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

**Lu dans la source.** L'API REST propose `POST /accounts/{account_id}/d1/database/{database_id}/export`. Il faut démarrer avec `output_format: "polling"`, poursuivre les interrogations avec le bookmark retourné, puis télécharger `signed_url`. Le lien est disponible pendant **une heure**. Sans interrogation continue, un export en cours peut être annulé automatiquement. [Référence API d'export, sans date affichée](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/).

**Lu dans les sources.** Les limites à distinguer sont :

| Objet                              | Limite documentée                                           | Source                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Base D1 gratuite                   | 500 MB par base, 5 GB par compte                            | [Limites D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/limits/)                                              |
| Fichier d'import                   | 5 GiB selon le guide d'import                               | [Import et export, 21/04/2026](https://developers.cloudflare.com/d1/best-practices/import-export-data/)                      |
| Résultat d'une requête SQL         | 50 MB depuis le 04/11/2026 ; import et export REST exemptés | [Annonce du 30/10/2026](https://developers.cloudflare.com/changelog/post/2026-10-30-query-result-size-limit/)                |
| Plafond propre au fichier d'export | ? ; aucun chiffre distinct retrouvé                         | [API d'export, sans date affichée](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/) |

**Lu dans la source.** Depuis le **12/11/2026**, les bases comportant des tables virtuelles peuvent être exportées avec `compatibility: "sqlite3_cli_only"`, également disponible dans Wrangler. Ce format vise SQLite et ne peut pas être réimporté dans D1. Cette annonce récente complète le guide d'avril qui indique encore une incompatibilité des exports avec les tables virtuelles. [Annonce du 12/11/2026](https://developers.cloudflare.com/changelog/post/2026-11-12-d1-export-virtual-tables/).

**Lu dans les sources.** La planification est possible : Cloudflare fournit un exemple officiel de Workflow programmé qui déclenche l'export REST, attend sa disponibilité et transfère le SQL vers R2. Workflows est disponible en Free, avec **3 000 étapes par jour**, **1 GB-month de stockage**, **10 ms CPU par invocation** et un quota de requêtes partagé avec Workers. [Exemple officiel, 12/10/2026](https://developers.cloudflare.com/workflows/examples/backup-d1/) ; [tarification Workflows, 04/11/2026](https://developers.cloudflare.com/workflows/reference/pricing/).

**Déduit.** Un Worker déclenché par Cron peut également orchestrer cette API avec `fetch`, sous ses limites CPU et de sous-requêtes. Wrangler n'est pas nécessaire dans le Worker. Pour un export qui demande plusieurs tentatives, l'exemple Workflows documente mieux la gestion des reprises. [Cron Triggers, 12/11/2026](https://developers.cloudflare.com/workers/configuration/cron-triggers/index.md) ; [exemple d'export, 12/10/2026](https://developers.cloudflare.com/workflows/examples/backup-d1/).

**Lu dans les sources.** R2 ajoute une souscription distincte avec passage par le parcours de souscription et facturation à l'usage. Son allocation gratuite Standard comprend **10 GB-month**, **1 million d'opérations A** et **10 millions d'opérations B par mois**. Les buckets peuvent être contraints à `eu`. [Démarrage R2, 12/11/2026](https://developers.cloudflare.com/r2/get-started/) ; [tarification, 30/10/2026](https://developers.cloudflare.com/r2/pricing/) ; [localisation, 19/08/2026](https://developers.cloudflare.com/r2/reference/data-location/).

**Déduit.** Un export vers R2 peut rester gratuit, mais ce montage ne présente pas le même profil financier qu'un compte limité à Workers Free et D1 Free : R2 facture les dépassements de son allocation. [Tarification R2, 30/10/2026](https://developers.cloudflare.com/r2/pricing/).

**3. Limites Workers Free utiles pour cette PWA**

**Lu dans les sources.**

| Ressource              | Offre gratuite                                              | Source et date                                                                                                    |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Requêtes dynamiques    | 100 000 par jour et par compte ; remise à zéro à minuit UTC | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| CPU HTTP               | 10 ms par invocation                                        | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| CPU Cron               | 10 ms par déclenchement                                     | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| Cron Triggers          | 5 par compte                                                | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| Sous-requêtes externes | 50 par invocation ; redirections comptées                   | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| Connexions sortantes   | 6 simultanément en attente des en-têtes                     | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |
| Script                 | 64 MiB non compressés ; ancien plafond compressé supprimé   | [Annonce du 04/09/2026](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/) |
| Assets                 | 20 000 fichiers par version ; 25 MiB par fichier            | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/)                                 |

**Lu dans la source.** L'attente réseau ne consomme pas le budget CPU. Un dépassement CPU entraîne l'erreur **1102** ; le dépassement quotidien des requêtes entraîne **1027**, avec un comportement dépendant du mode de route. [Limites Workers, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/).

Phrase officielle exacte concernant `ctx.waitUntil` :

> “If any Promises have not settled after 30 seconds, they are canceled.”

**Lu dans la source.** Pour une invocation HTTP, `ctx.waitUntil` prolonge le travail jusqu'à **30 secondes après la réponse ou la déconnexion**. Cette durée est commune aux différents appels de la même requête. Elle n'augmente pas l'allocation CPU. [API Context, 12/10/2026](https://developers.cloudflare.com/workers/runtime-apis/context/index.md) ; [limites CPU, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/).

**Lu dans la source.** Le stockage des assets n'ajoute pas de coût et les requêtes servies directement comme assets sont gratuites et illimitées. Avec `run_worker_first`, les chemins concernés invoquent le Worker ; après dépassement du quota gratuit, ils peuvent recevoir **429** au lieu des assets. [Assets, facturation et limites, 12/11/2026](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

**Lu dans les sources.** D1 Free autorise **5 millions de lignes lues et 100 000 lignes écrites par jour**. Les scans et les mises à jour d'index comptent. Au dépassement quotidien, les requêtes échouent jusqu'au renouvellement du quota ; les données stockées sont conservées. [Tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/) ; [annonce du 01/09/2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).

**Déduit.** Pour ces quotas gratuits, le comportement documenté est une erreur ou un refus de service, sans passage automatique au tarif Paid. Aucun blocage automatique du compte pour un simple dépassement n'est annoncé. Les conditions générales conservent toutefois des droits de suspension distincts. [Limites Workers, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/) ; [tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/) ; [conditions générales, 12/09/2025](https://www.cloudflare.com/terms/).

**4. Web Push, bibliothèques et CPU**

La recherche ouverte a porté sur l'annuaire npm, les comparatifs de bibliothèques et les échanges du projet `web-push`. Les statistiques npm n'ont pas pu être ouvertes : **la bibliothèque complémentaire la plus utilisée est ?**, faute de données comparables accessibles. Les pistes supplémentaires identifiées sont présentées ci-dessous sans classement d'usage.

**Lu dans les sources des projets, sans date de page affichée.**

| Bibliothèque absente de la liste initiale | Élément documentaire                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pushforge/builder`                      | Le mainteneur annonce WebCrypto, aucune dépendance et la prise en charge de Workers. [Dépôt](https://github.com/draphy/pushforge)                                          |
| `webpush-webcrypto`                       | Utilise WebCrypto ; l'auteur précise que l'exécution sur Workers est théorique et n'a pas été essayée par lui. [Dépôt](https://github.com/alastaircoote/webpush-webcrypto) |
| `@mmmike/web-push`                        | Le projet documente `fetch`, WebCrypto et un exemple d'envoi depuis un Worker. [Dépôt](https://github.com/MMMikeM/web-push)                                                |
| `@portable/web-push`                      | Documente aes128gcm, VAPID, Workers et un comparatif de performances. [Documentation](https://portablejs.com/packages/web-push/)                                           |

Phrase officielle exacte :

> “The WebCrypto API is also available within Cloudflare Workers.”

**Lu dans la source.** WebCrypto est utilisable sans `nodejs_compat`. La documentation actuelle de `node:crypto` indique une prise en charge complète, sous les exceptions qu'elle énumère. [Documentation Crypto, 17/10/2026](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

**Lu dans les sources.** `https.request` est désormais implémenté. Son activation automatique avec la compatibilité Node date du **15/08/2025**. Pour les dates de compatibilité à partir du **04/08/2026**, la compatibilité Node est activée par défaut ; les configurations antérieures nécessitent les flags appropriés. [HTTPS, 23/04/2026](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/) ; [compatibilité Node, 12/08/2026](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

**Rapporté par des tiers.** Dans l'issue `web-push` consacrée à Workers, un utilisateur rapporte un fonctionnement sur les navigateurs Google et Microsoft le **26/10/2025**. Un autre rapporte un échec sur iPhone le **23/02/2026**. [Issue nº 718, commentaires datés](https://github.com/web-push-libs/web-push/issues/718).

**Déduit.** Il serait donc inexact d'affirmer que `web-push` est nécessairement incompatible avec Workers en novembre 2026. La compatibilité est plausible et partiellement rapportée, mais le flag seul ne prouve pas le fonctionnement de toutes les versions et de tous les services Push. Une bibliothèque WebCrypto constitue un choix documenté, sans être une obligation du runtime. [HTTPS, 23/04/2026](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/) ; [retours de l'issue, 26/10/2025 et 23/02/2026](https://github.com/web-push-libs/web-push/issues/718).

**Lu dans la source du mainteneur.** `@block65/webcrypto-web-push` propose un exemple annoncé comme Hono avec abonnements stockés dans D1. Son README distingue la version 2, avec `aes128gcm` et VAPID actuel, de la version 1 utilisant des formats anciens non acceptés par Apple. Le README et la présentation ont été lus ; le répertoire de l'exemple lui-même n'a pas pu être ouvert. [Présentation, sans date affichée](https://github.com/block65/webcrypto-web-push) ; [README du paquet, sans date affichée](https://github.com/block65/webcrypto-web-push/blob/master/packages/web-push/README.md).

**Lu dans la source du mainteneur.** `web-push-browser` annonce Workers, WebCrypto, VAPID et `aes128gcm`. Son README recommande ce dernier, l'ancien `aesgcm` étant incomplet. [Dépôt, sans date affichée](https://github.com/colecrouter/web-push-browser).

**Déduit, chiffres non établis.**

| Coût CPU sur Workers Free             | Valeur |
| ------------------------------------- | ------ |
| Chiffrement aes128gcm par message     | ?      |
| Signature VAPID                       | ?      |
| Envoi à tous les abonnements des amis | ?      |

Aucun benchmark Workers correspondant n'a été retrouvé. Le comparatif Portable mesure des opérations par seconde sur Node et un processeur identifié ; il ne mesure pas la consommation CPU facturée par Workers. Ces valeurs ne permettent donc pas de garantir le respect des 10 ms. [Comparatif Portable, sans date affichée](https://portablejs.com/packages/web-push/) ; [limites Workers, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/).

**Déduit.** Pour la fiabilité, je retiendrais une bibliothèque WebCrypto actuelle, puis une mesure du CPU avec plusieurs abonnements. Je conserverais aussi en D1 les notifications à reprendre : `waitUntil` peut être interrompu à son échéance et ne constitue pas, seul, un mécanisme durable de livraison. [WebCrypto, 30/09/2026](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/index.md) ; [API Context, 12/10/2026](https://developers.cloudflare.com/workers/runtime-apis/context/index.md).

**5. Conditions et stabilité de la gratuité**

**Lu dans la source.** La page produit Workers annonce un démarrage gratuit sans carte bancaire. Elle n'affiche pas de date de publication ou de mise à jour. [Page officielle Workers, sans date affichée](https://www.cloudflare.com/products/workers/).

**Déduit.** L'absence de carte n'est pas une garantie générale contre toute facturation : d'autres moyens de paiement existent et R2 ajoute sa propre souscription. Pour Workers Free et D1 Free, c'est le régime de quotas avec erreurs au dépassement qui permet de distinguer l'offre gratuite de l'offre facturée. [Profil de facturation, 29/05/2026](https://developers.cloudflare.com/billing/get-started/create-billing-profile/) ; [R2, 12/11/2026](https://developers.cloudflare.com/r2/get-started/) ; [tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/).

**Déduit.** Aucune obligation de réserver Workers Free à un usage non commercial n'a été trouvée dans les conditions générales et les conditions Developer Platform consultées. Cette conclusion repose sur ces textes, sans phrase officielle explicite retrouvée autorisant nominativement « commercial use on Workers Free ». [Conditions générales, 12/09/2025](https://www.cloudflare.com/terms/) ; [conditions Developer Platform, 28/09/2026](https://www.cloudflare.com/service-specific-terms-developer-platform/).

Phrase officielle exacte sur la pérennité d'une offre D1 gratuite :

> “Yes, the Workers Free plan will always include the ability to prototype and experiment with D1 for free.”

**Lu dans la source.** Cette promesse concerne la possibilité de prototyper et expérimenter gratuitement. Elle ne promet pas le maintien des quotas actuels. [Tarification D1, 30/10/2026](https://developers.cloudflare.com/d1/platform/pricing/).

**Lu dans les sources.** L'historique présente plusieurs restrictions ou changements à distinguer d'une baisse chiffrée des quotas :

- Les notes D1 annoncent le **13/01/2025** l'application des limites quotidiennes à partir du **10/02/2025**. Une autre annonce fixe au **01/09/2026** l'échec des requêtes dépassant ces limites. Les deux textes existent ; ils n'expliquent pas cette différence de calendrier. [Notes D1, page du 21/04/2026](https://developers.cloudflare.com/d1/platform/release-notes/index.md) ; [annonce du 01/09/2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).
- D1 applique un maximum de **50 MB par résultat SQL depuis le 04/11/2026**, sauf import et export REST. [Annonce du 30/10/2026](https://developers.cloudflare.com/changelog/post/2026-10-30-query-result-size-limit/).
- Les anciens backups du backend alpha ont été retirés le **01/07/2025** ; il s'agit du retrait d'un ancien service. [Notes D1, page du 21/04/2026](https://developers.cloudflare.com/d1/platform/release-notes/index.md).
- La taille autorisée des scripts Workers a augmenté le **04/09/2026**, avec suppression de l'ancien plafond compressé. [Annonce du 04/09/2026](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).

**Déduit.** Je n'ai pas établi de diminution historique des quotas chiffrés principaux Workers Free ou D1 Free. Les sources prouvent néanmoins des durcissements d'application et des changements de service ; elles ne permettent pas de conclure à une stabilité garantie. [Notes D1, 21/04/2026](https://developers.cloudflare.com/d1/platform/release-notes/index.md) ; [annonce D1, 01/09/2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).

**Lu dans la source.** Les conditions générales permettent à Cloudflare de terminer un service gratuit et de modifier ou retirer des fonctionnalités. **Déduit :** aucun engagement de gel des quotas ou de maintien perpétuel de cette architecture gratuite n'est établi. [Conditions générales, sections 2.6 et 8, 12/09/2025](https://www.cloudflare.com/terms/).

| Question                | Réponse courte et statut                                                                                                   | Source                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Données en UE        | **Lu :** `eu` existe et contraint les réplicas. **Déduit :** Free paraît admis ; localisation Time Travel **?**            | [Localisation, 02/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/) ; [Time Travel, 06/11/2026](https://developers.cloudflare.com/d1/reference/time-travel/)     |
| 2. Sauvegarde et sortie | **Lu :** Time Travel gratuit 7 jours ; export SQL Wrangler ou REST ; exemple planifié Workflows vers R2                    | [Time Travel, 06/11/2026](https://developers.cloudflare.com/d1/reference/time-travel/) ; [exemple, 12/10/2026](https://developers.cloudflare.com/workflows/examples/backup-d1/)            |
| 3. Limites Workers      | **Lu :** 100 000 requêtes/jour, 10 ms CPU, 5 Cron, 50 sous-requêtes externes ; assets directs gratuits                     | [Limites, 13/11/2026](https://developers.cloudflare.com/workers/platform/limits/) ; [assets, 12/11/2026](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| 4. Web Push             | **Déduit :** WebCrypto conseillé ; `web-push` n'est plus exclu par principe. CPU **?**                                     | [Crypto, 17/10/2026](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) ; [retours datés de 2025 et 2026](https://github.com/web-push-libs/web-push/issues/718)        |
| 5. Conditions           | **Lu :** Workers démarre sans carte. **Déduit :** aucune restriction non commerciale trouvée, aucun gel des quotas garanti | [Workers, sans date affichée](https://www.cloudflare.com/products/workers/) ; [conditions, 12/09/2025](https://www.cloudflare.com/terms/)                                                  |

## Pages non lues

- https://developers.cloudflare.com/d1/configuration/read-replication/ : erreur HTTP 404 ; documentation retrouvée à une autre adresse.
- https://github.com/block65/webcrypto-web-push/blob/master/examples/cloudflare-workers : accès refusé par robots.txt.
- https://www.npmjs.com/search?q=web-push : erreur HTTP 403.
- https://api.npmjs.org/downloads/point/2026-11-09:2026-11-15/@pushforge/builder : URL inaccessible avec l'outil web.
- https://api.npmjs.org/downloads/point/2026-11-09:2026-11-15/@mmmike/web-push : URL inaccessible avec l'outil web.
- https://api.npmjs.org/downloads/point/2026-11-09:2026-11-15/webpush-webcrypto : URL inaccessible avec l'outil web.
- https://api.npmjs.org/downloads/point/2026-11-09:2026-11-15/@portable/web-push : URL inaccessible avec l'outil web.
- https://www.npmjs.com/package/@pushforge/builder : erreur HTTP 403.
- https://www.npmjs.com/package/@mmmike/web-push?activeTab=versions : erreur HTTP 403.
- https://www.npmjs.com/package/webpush-webcrypto?activeTab=versions : erreur HTTP 403.
