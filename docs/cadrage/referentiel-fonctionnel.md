# Référentiel fonctionnel (16/11/2026)

Statut : inventaire par un sous-agent le 16/11/2026 (code décompilé de Tricount 14.8.2, code de Spliit et SplitPro, sites et fiches stores), non contre-vérifié ; mesure d'usage sur l'export du groupe faite le 16/11 par un script de la session, non contre-vérifiée. [L] lu dans la source, [NL] résumé ou tiers, [D] déduit ; « ? » = non trouvé, pas « non ».

## En bref

- La parité avec Tricount est un périmètre réduit : payeur unique, répartition par parts ou par montants, remboursements, soldes simplifiés, catégories, pièces jointes, devises, stats moi contre groupe, import Splitwise. Tricount n'a ni historique des modifications, ni récurrence, ni filtre « me concerne », ni étiquettes de membres, ni vue desktop.
- Aucune app lue ne cumule filtre « me concerne », notifications ciblées et recherche correcte ; aucune ne cible les notifications sans compte. Le cœur de notre différence est à construire.
- L'usage réel du groupe (ci-dessous) place la sélection des participants au centre : aucune dépense ne concerne les 13 membres, la médiane est de 3 concernés.

## Usage réel du groupe (export Tricount, 25/11/2025 au 16/11/2026, 250 opérations)

Script exécuté le 16/11 sur l'export JSON produit par `export/lire_tricount.py` (gardé hors de tout repo : noms du groupe), non contre-vérifié.

- Concernés par dépense (236 dépenses) : 1 concerné pour 49, 2 pour 38, 3 pour 47, 4 pour 41, 5 pour 28, 6 pour 19, 7 pour 9, 8 pour 4, 9 pour 1 ; jamais plus de 9, jamais les 13 ; médiane 3. Les 49 dépenses à un seul concerné sont toutes payées par quelqu'un d'autre (avance pour un ami).
- Dépenses où chaque membre est concerné, triées : 152, 127, 89, 87, 83, 81, 75, 44, 21, 16, 10, 2, 1. Trois à cinq membres annexes.
- Répartition des 236 dépenses : 146 à parts égales, 7 à parts inégales, 55 mêlant parts et montants fixés, 28 entièrement en montants exacts (recalcul du 16/11 par un vérificateur).
- Peu ou pas utilisés : catégories (241 opérations sur 250 sans catégorie), pièces jointes (0), devises (tout en euros).
- 14 remboursements enregistrés.

## Ce que fait Tricount (APK 14.8.2 décompilée par jadx, chemins relatifs à la décompilation, non versionnée)

- Répartition : allocation `AMOUNT` ou `RATIO` avec `share_ratio` (`src3/sources/com/bunq/android/model/tricount/registry/AllocationItem.java:23-61`) [L] ; un seul payeur par dépense [D].
- Types d'opération : `NORMAL`, `BALANCE` (remboursement), `INCOME` [L].
- 10 catégories et une personnalisée ; types de groupe [L].
- Devises : montant, montant local, taux par dépense [L]. Pièce jointe par dépense et galerie par groupe [L].
- Membres avec ou sans compte, écran « qui êtes-vous », invitation par lien et QR code [L].
- Remboursements : règlement suggéré et enregistré, demandes de paiement bunq [L].
- Stats moi, groupe, tous, par mois ou année, par catégorie [L].
- Divers : import Splitwise, groupes archivés, mode sombre, compteur d'entrées non vues [L].

## Tableau par fonction

| Fonction                              | Tricount       | Sesterce                           | Spliit                     | SplitPro         | Settle Up | Splid    | Splitwise    |
| ------------------------------------- | -------------- | ---------------------------------- | -------------------------- | ---------------- | --------- | -------- | ------------ |
| Sans compte, « qui je suis »          | oui            | oui (connexions sociales ajoutées) | oui                        | non              | ?         | oui      | non [D]      |
| Membre sans l'app                     | oui            | ?                                  | oui                        | ?                | ?         | ?        | ?            |
| Invitation par lien                   | oui            | oui                                | oui                        | oui              | oui       | ?        | ?            |
| QR code d'invitation                  | oui            | oui                                | ?                          | ?                | ?         | ?        | ?            |
| Rôles, mot de passe de groupe         | ?              | oui                                | non [D]                    | ?                | ?         | ?        | ?            |
| Étiquettes ou sous-groupes de membres | non trouvé     | ?                                  | non                        | non              | ?         | ?        | ?            |
| Archiver un groupe                    | oui            | ?                                  | oui                        | ?                | ?         | ?        | oui          |
| Plusieurs payeurs                     | non [D]        | ?                                  | non                        | ?                | oui       | ?        | oui          |
| Catégories                            | oui            | oui                                | oui                        | oui              | ?         | ?        | ?            |
| Pièces jointes                        | oui            | ?                                  | oui                        | oui              | Premium   | ?        | Pro          |
| Multi-devises                         | oui            | ?                                  | oui                        | oui              | oui       | oui      | Pro          |
| Dépense récurrente                    | ?              | ?                                  | oui (contradiction README) | oui              | Premium   | ?        | oui          |
| Saisie hors ligne                     | oui            | ?                                  | non (PR ouverte)           | non              | oui       | oui      | oui          |
| Notes ou commentaires                 | ?              | ?                                  | notes                      | commentaires     | ?         | ?        | commentaires |
| Répartition égale, par parts          | oui            | oui                                | oui                        | oui              | oui       | ?        | oui          |
| Par montants exacts                   | oui            | ?                                  | oui                        | oui              | ?         | ?        | oui          |
| Par pourcentages                      | ?              | ?                                  | oui                        | oui              | ?         | ?        | oui          |
| Tout cocher ou décocher               | ?              | ?                                  | oui                        | ?                | ?         | ?        | ?            |
| Répartition par défaut mémorisée      | ?              | ?                                  | oui (navigateur)           | oui (en base)    | ?         | ?        | Pro [NL]     |
| Soldes par membre                     | oui            | oui                                | oui                        | oui              | oui       | ?        | oui          |
| Simplification des remboursements     | oui            | ?                                  | oui                        | option           | oui       | ?        | oui          |
| Ma part sur chaque dépense            | ?              | ?                                  | oui                        | PR ouverte       | ?         | ?        | ?            |
| Filtre « me concerne »                | non            | ?                                  | non                        | partiel          | ?         | ?        | ?            |
| Recherche texte                       | basique        | ?                                  | titre et notes             | non (PR ouverte) | ?         | ?        | Pro          |
| Recherche par montant, date, payeur   | ?              | ?                                  | non                        | non              | ?         | ?        | ?            |
| Compteur d'entrées non vues           | oui            | ?                                  | ?                          | ?                | ?         | ?        | ?            |
| Notification push                     | ?              | ?                                  | non                        | oui              | oui       | ?        | oui          |
| Ciblée sur les concernés              | non            | ?                                  | non                        | oui              | ?         | ?        | ?            |
| Rappels automatiques                  | ?              | ?                                  | ?                          | ?                | oui       | ?        | ?            |
| Flux d'activité                       | ?              | ?                                  | oui                        | oui              | ?         | ?        | oui          |
| Vue desktop complète                  | non            | oui                                | oui                        | oui              | ?         | non [NL] | oui          |
| PWA installable                       | non            | ?                                  | oui                        | oui              | ?         | ?        | ?            |
| Export CSV                            | via le support | oui                                | oui                        | ?                | oui       | ?        | oui          |
| Import                                | Splitwise      | CSV                                | non                        | Splitwise        | ?         | ?        | ?            |
| Stats par catégorie, dans le temps    | oui            | par catégorie                      | oui                        | non              | Premium   | ?        | Pro          |
| Historique des modifications          | non trouvé     | ?                                  | partiel                    | non              | ?         | ?        | oui          |
| OCR de ticket                         | ?              | ?                                  | oui (OpenAI)               | non              | ?         | ?        | Pro          |
| Prix enregistrés                      | ?              | ?                                  | non                        | non              | ?         | ?        | ?            |
| Commande groupée complétée plus tard  | ?              | ?                                  | non                        | non              | ?         | ?        | ?            |

Sources principales : code décompilé de Tricount 14.8.2 ; help.tricount.com/articles/tricount-faqs et tricount.com (lus le 16/11) ; clones de Spliit (`f293974`) et SplitPro (`7f48b66`) ; fiches App Store de Sesterce, Settle Up, Splid ; splitwise.com.

## Idées d'ergonomie relevées

- Ma part ou « non impliqué » sur chaque ligne (Spliit, `active-user-balance.tsx:15-47`).
- Répartition par défaut mémorisée par groupe (Spliit dans le navigateur, SplitPro en base) et « tout cocher ou décocher » (Spliit).
- Simplification des remboursements en option par groupe (SplitPro).
- Rappels automatiques des remboursements (Settle Up).
- Rôles lecture et saisie (Sesterce), à confronter au modèle sans compte.

## Pages non lues

Fiche Play Store de Sesterce, FAQ et fiche App Store de Splid, page de prix de Splitwise (404) ; aide de Settle Up (domaine inexistant) ; centres d'aide de Splid, Settle Up et Sesterce et avis Reddit non cherchés : les « ? » de ces colonnes restent ouverts.
