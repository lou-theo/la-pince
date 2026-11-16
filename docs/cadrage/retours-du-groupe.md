# Retours du groupe (16/11/2026)

Premiers retours des amis sur la discussion du groupe, le 16/11/2026 au soir, lus sur deux captures transmises par l'utilisateur. Ce sont des hypothèses : chacune est rapprochée de l'usage mesuré (`referentiel-fonctionnel.md`, export Tricount du 25/11/2025 au 16/11/2026) avant toute entrée au périmètre. Les auteurs ne sont pas nommés (repo public à terme). Tri proposé par l'assistant ; tranché par l'utilisateur le 16/11 pour la seule saisie par montants (première version), le reste se répartit dans les versions suivantes.

## En bref

- Seule la saisie par montants individuels avec total calculé est ajoutée à la première version (décision de l'utilisateur, 16/11) ; les autres retours vont dans les versions suivantes.
- L'emoji automatique est la seule piste trouvée pour que les catégories servent un jour : il rend la catégorie implicite, sans effort de saisie.
- Les blagues (remboursement obligatoire, wizz) cachent un vrai besoin, la relance des remboursements, peu coûteux une fois les notifications en place.

## Tri

| Retour | Besoin dessous | Ce que dit l'usage mesuré | Proposition |
|---|---|---|---|
| Saisir les montants de chacun sans total : le total se calcule ; total saisi et somme différente : refuser l'enregistrement | saisie d'une addition détaillée sans calcul de tête | 83 dépenses sur 236 portent au moins un montant fixé (55 mêlées à des parts, 28 entièrement en montants) | première version, dans la saisie rapide (retenu le 16/11) |
| Afficher seulement sa part, « combien elle vaut pour toi » | lecture personnelle de la liste | déjà prévu (ma part sur chaque ligne) | version suivante : bascule « ma part / total » (ma part sur chaque ligne reste au périmètre actuel, à redécouper) |
| Graphique de répartition sur chaque dépense, comprendre pourquoi les totaux diffèrent entre personnes | expliquer une répartition inégale | 90 dépenses sur 236 hors parts égales (calcul : 7 + 55 + 28) | version suivante : simple barre par personne dans le détail ; graphique riche plus tard |
| Emoji choisi automatiquement (« Bières » donne 🍺) ; Tricount le fait, mieux sur iPhone que sur Android (rapporté) | repérer une dépense d'un coup d'œil | l'export n'a aucun champ emoji par dépense (vérifié : seul le groupe en porte un) : chez Tricount il se déduit à l'affichage | version suivante : dictionnaire de mots-clés local, gratuit, corrigeable à la main ; la correction alimente le dictionnaire |
| Catégories automatiques pour les stats (« dans quoi on dépense ») | stats par type de dépense | 241 opérations sur 250 sans catégorie ; noms souvent fantaisistes (dit par l'utilisateur) | lot 2 : catégorie dérivée de l'emoji, sans saisie ; reste « plus tard » si l'emoji ne prend pas |
| Stats plus poussées : par mois, à qui on doit le plus, qui paie le plus | vue d'ensemble | « à qui on doit » = soldes, déjà en première version | lot 2 (statistiques dans le temps, déjà prévu) |
| Dépenses programmées, visibles avant d'être faites | anticiper une dépense connue (vacances) | aucune dépense datée après sa création dans l'export (vérifié) : la date future de Tricount n'est pas utilisée | lot 2, à rapprocher de la commande groupée complétée plus tard (même idée de dépense « en attente ») |
| Remboursement obligatoire au-delà de -50 € ; wizz pour réclamer (blagues) | relancer les remboursements | 14 remboursements en un an pour 9 609,80 € de dépenses | lot 2 : relance par notification depuis la vue des soldes, seuil réglable |
| Rembourser par Wero | payer sans quitter l'app | non vérifié : Wero n'a pas d'API publique de paiement entre particuliers connue (supposé) | plus tard, au mieux un lien ou un montant à copier ; à vérifier avant |
| IA qui lit des captures de commandes ou factures et répartit | saisie des grosses commandes | déjà en « plus tard » (lecture des tickets) ; gratuit difficile (dit par l'utilisateur) | inchangé : plus tard |

## Réponses déjà faites dans la discussion

- Appli privée ? Code open source sur GitHub, serveur réservé au groupe et à qui reçoit le lien (dit par l'utilisateur dans la discussion).
