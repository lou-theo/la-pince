# Panorama des alternatives à Tricount (16/11/2026)

Statut : recherche documentaire faite par un sous-agent le 16/11/2026, non contre-vérifiée. [L] = lu dans la source citée, [NL] = connu par un résumé de moteur ou une page tierce, [D] = déduit. Une case « ? » veut dire information absente des pages lues, pas « non ».

Décision du 16/11/2026 (README, décisions 5 et 7) : aucune app ne convient, le groupe développe La Pince ; ce panorama sert de référence fonctionnelle.

## En bref

- Aucune app ne coche à coup sûr les quatre contraintes (natif iOS et Android, web desktop, push par dépense, visualisation simple) ; les push et la visualisation sont les trous les plus fréquents dans les pages lues.
- Seule Settle Up affiche explicitement une alerte à chaque dépense [L App Store], mais son web se limite à une vue par lien de groupe et la visualisation n'est pas documentée ; Premium à 3,99 $/mois ou 19,99 $/an.
- Sesterce (éditeur Naiane, France) : propriétaire, gratuit avec achats intégrés, iOS, Android et web (app.sesterce.io) ; push non mentionnés sur le site.
- Les open source proches sont web ou PWA d'abord : Spliit (MIT, 3 069 étoiles) sans app Android officielle ni push dans le dépôt principal (issue #149 ouverte depuis 05/2024) ; SplitPro (MIT, 1 494 étoiles) en PWA avec Web Push à configurer côté instance (clés VAPID).
- Tricount a arrêté son app web en janvier 2024 (tweet de Tricount connu par un résultat de recherche [NL]) et a retiré avec la fin du Premium tri, export, stats et répartitions perso, en partie revenus [L help.tricount.com].

## Tableau

| App | Natif iOS / Android / PWA | Web desktop | Push par dépense | Visualisation | Hors ligne | Multi-devises | Récurrentes | Répartition inégale | Import Tricount | Open source | Auto-héberg. | Modèle / limites | Notes stores |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Tricount](https://www.tricount.com) (bunq) | iOS / Android / non | Non (web arrêté 01/2024) | ? (plaintes de retards [NL]) | Stats retirées puis en partie restaurées | Oui | Oui 100+ | ? | Contradictoire (FAQ : « planned », App Store : oui) | n/a | Non | Non | Gratuit, Premium abandonné | iOS 4,9 / 8,6 K (CA) |
| Splitwise | iOS / Android / non | Oui (non relu) | ? | Graphiques et catégories en Pro [L] | ? | Conversion en Pro | Oui [L] | ? | Non | Non | Non | Pro payant ; plafond d'entrées quotidien en gratuit, 2 à 5 selon les sources [NL] | iOS DK 3,3 / 121 |
| [Settle Up](https://settleup.io) | iOS / Android / ? | Vue par lien de groupe [L] | Oui [L App Store] | ? | Oui | Oui | Premium | ? | ? | Non | Non | 3,99 $/mois, 19,99 $/an ; Groupe 39,99 $/an [L] | iOS 4,8 / 1,8 K |
| [Spliit](https://github.com/spliit-app/spliit) | iOS en réécriture SwiftUI, non publiée / Android non officiel (Spliit2Go, test fermé) / PWA | Oui | Non (issue #149) ; fork spliit-cloud annonce push [non vérifié] | Soldes oui, stats ? | PR #689 ouverte | Oui | Oui dans le code (README la dit en roadmap) | Oui | Non | MIT, 3 069 ét., dernier push 14/11/2026 | Oui (Docker) | Gratuit | n/a |
| [SplitPro](https://github.com/oss-apps/split-pro) | Non / PWA recommandée | Oui | Oui, Web Push, clés VAPID requises | ? | ? | Oui | Oui (pg_cron) | Oui | Non (Splitwise : amis et groupes seulement) | MIT, 1 494 ét., commit 15/11/2026 | Oui (Docker) | Gratuit | n/a |
| Cospend (Nextcloud) | Cowspent (Android), PayForMe iOS en dev | Oui (dans Nextcloud) | « Notifications » listées, détail ? | Stats, soldes, plan de règlement | ? | Oui | Oui | Oui | CSV IHateMoney/Splitwise | AGPL-3.0, 329 ét. | Oui (exige Nextcloud) | Gratuit | n/a |
| IHateMoney | Non (web) | Oui | ? | ? | Non | Oui | ? | Oui | ? | Beerware dérivée, 1 397 ét. | Oui | Gratuit | n/a |
| Kittysplit | iOS / Android optionnels | Oui, complet | ? | Qui doit à qui | ? | Payant | ? | ? | Non | Non | Non | Gratuit jusqu'à 9 personnes, ~3 € par groupe au-delà [L page concurrente] | ? |
| Splid | iOS / Android / non | ? | ? | Total, export PDF | Oui | Oui 150+ | Non mentionné | Oui | ? | Non | Non | Plus 3,99 € [L] | iOS 4,9 / 40 K |
| Splittr | iOS seulement | ? | ? | Stats, catégories | Oui | Oui | Oui | Oui | ? | Non | Non | 3,49 $/an, 10,99 $ à vie [L] | iOS 4,8 / 621 |
| [Sesterce](https://sesterce.io) | iOS / Android / web | Oui (app.sesterce.io) | ? (non mentionné) | Stats par catégorie | Oui | Oui | ? | Oui (parts) | CSV annoncé [NL] | Non | Non | Gratuit + Premium (contenu non publié) | Android 4,82 / 2,3 K |
| Abrechnung | Non / PWA | Oui | Non mentionné | Graphiques de soldes | Partiel | Oui | ? | Oui | ? | AGPL-3.0, 207 ét. | Oui | Gratuit | n/a |
| Quits | Android (F-Droid) / pas d'iOS / PWA | Oui | Non mentionné | Stats | Oui | ? | ? | Oui | JSON | AGPL-3.0, 28 ét. | Relais | Gratuit | n/a |

Étoiles, licences et commits : `gh api repos/<repo>` le 16/11/2026 [L].

## Trous

- Push de Sesterce, Splitwise, Splid, Kittysplit : non documentés, à tester dans l'app.
- Limites du gratuit Splitwise : seulement par des blogs concurrents.
- Avis Reddit et Play Store (Tricount, Sesterce) : non lus (pages bloquées ou dynamiques).
