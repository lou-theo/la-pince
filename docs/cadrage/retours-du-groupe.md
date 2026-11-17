# Retours du groupe (16 et 17/11/2026)

Retours des amis sur la discussion du groupe, le 16/11/2026 au soir (deux captures) et le 17/11 après-midi (trois captures), transmis par l'utilisateur. Ce sont des hypothèses : chacune est rapprochée de l'usage mesuré (`referentiel-fonctionnel.md`, export Tricount du 25/11/2025 au 16/11/2026) avant toute entrée au périmètre. Les auteurs ne sont pas nommés (repo public). Tri proposé par l'assistant ; tranché par l'utilisateur le 16/11 : la saisie par montants entre en première version, la bascule « ma part / total », la barre de répartition et l'emoji automatique n'y entrent pas ; la version de chaque retour se fixe au découpage en versions.

## En bref

- 17/11, non tranché : « les membres fréquents en tête » se heurte à une objection (l'ordre bouge) que la mesure confirme ; des raccourcis vers les dernières sélections servent plus souvent qu'un top 4 et laissent la liste immobile (section Retours du 17/11).

- Seule la saisie par montants est ajoutée à la première version (décision de l'utilisateur, 16/11) ; les autres ajouts proposés n'y entrent pas, leur version reste à fixer.
- L'emoji automatique est la seule piste trouvée pour que les catégories servent un jour : il rend la catégorie implicite, sans effort de saisie.
- Les blagues (remboursement obligatoire, wizz) cachent un vrai besoin, la relance des remboursements, peu coûteux une fois les notifications en place.

## Tri des retours du 16/11

| Retour | Besoin dessous | Ce que dit l'usage mesuré | Proposition |
|---|---|---|---|
| Saisir les montants de chacun sans total : le total se calcule ; total saisi et somme différente : refuser l'enregistrement | saisie d'une addition détaillée sans calcul de tête | 83 dépenses sur 236 portent au moins un montant fixé (55 mêlées à des parts, 28 entièrement en montants) | première version, dans la saisie rapide (retenu le 16/11) |
| Afficher seulement sa part, « combien elle vaut pour toi » | lecture personnelle de la liste | déjà prévu (ma part sur chaque ligne) | après la première version, version à fixer : bascule « ma part / total » (ma part sur chaque ligne reste au périmètre actuel, à redécouper) |
| Graphique de répartition sur chaque dépense, comprendre pourquoi les totaux diffèrent entre personnes | expliquer une répartition inégale | 90 dépenses sur 236 hors parts égales (calcul : 7 + 55 + 28) | après la première version, version à fixer : simple barre par personne dans le détail ; graphique riche plus tard |
| Emoji choisi automatiquement (« Bières » donne 🍺) ; Tricount le fait, mieux sur iPhone que sur Android (rapporté) | repérer une dépense d'un coup d'œil | l'export n'a aucun champ emoji par dépense (vérifié : seul le groupe en porte un) : chez Tricount il se déduit à l'affichage | après la première version, version à fixer : dictionnaire de mots-clés local, gratuit, corrigeable à la main ; la correction alimente le dictionnaire |
| Catégories automatiques pour les stats (« dans quoi on dépense ») | stats par type de dépense | 241 opérations sur 250 sans catégorie ; noms souvent fantaisistes (dit par l'utilisateur) | lot 2 : catégorie dérivée de l'emoji, sans saisie ; reste « plus tard » si l'emoji ne prend pas |
| Stats plus poussées : par mois, à qui on doit le plus, qui paie le plus | vue d'ensemble | « à qui on doit » = soldes, déjà en première version | lot 2 (statistiques dans le temps, déjà prévu) |
| Dépenses programmées, visibles avant d'être faites | anticiper une dépense connue (vacances) | aucune dépense datée après sa création dans l'export (vérifié) : la date future de Tricount n'est pas utilisée | lot 2, à rapprocher de la commande groupée complétée plus tard (même idée de dépense « en attente ») |
| Remboursement obligatoire au-delà de -50 € ; wizz pour réclamer (blagues) | relancer les remboursements | 14 remboursements en un an pour 9 609,80 € de dépenses | lot 2 : relance par notification depuis la vue des soldes, seuil réglable |
| Rembourser par Wero | payer sans quitter l'app | non vérifié : Wero n'a pas d'API publique de paiement entre particuliers connue (supposé) | plus tard, au mieux un lien ou un montant à copier ; à vérifier avant |
| IA qui lit des captures de commandes ou factures et répartit | saisie des grosses commandes | déjà en « plus tard » (lecture des tickets) ; gratuit difficile (dit par l'utilisateur) | inchangé : plus tard |

« Lot 2 » et « plus tard » : repères du périmètre actuel, à redécouper en versions.

## Retours du 17/11

Non tranchés. Mesures du 17/11 par un script de la session sur le même export, non contre-vérifiées.

| Retour | Besoin dessous | Ce que dit l'usage mesuré | Proposition |
|---|---|---|---|
| Membres les plus « courants » en tête quand on coche un par un, pour ne pas faire défiler une dizaine de membres annexes ; objection d'un autre membre : l'ordre changerait au fur et à mesure ; réponse : préférence entre ordre alphabétique et ordre par fréquence | retrouver vite les concernés habituels | « toujours les 4 mêmes » ne tient pas : les 4 membres les plus fréquents couvrent tous les concernés de 57 dépenses sur 236, les 7 plus fréquents de 156 sur 236. L'objection tient : après la 50e dépense, les 4 premiers d'un ordre par fréquence changent 10 fois en 186 dépenses. Les sélections se répètent : 92 sélections distinctes ; une dépense reprend la sélection d'une des 5 précédentes 70 fois sur 235 et une sélection déjà vue 144 fois sur 235 ; la plus courante (un trio) revient 22 fois | première version, en remplacement de « membres fréquents en tête » : liste en ordre alphabétique stable, et au-dessus les 5 dernières sélections distinctes, chacune en un geste (au moins 70 dépenses sur 235 servies) ; ordre par fréquence en préférence plus tard si le besoin reste ; sélections nommées avec les sous-groupes du lot 2 |
| Trier les soldes par montant | voir d'un coup d'œil qui doit le plus | soldes déjà en première version | première version : soldes triés par montant, coût faible (au jugé) |
| Classement de ceux qui paient ou dépensent le plus | vue d'ensemble, jeu | rejoint l'idée « qui sera la plus grosse pince ? » et les statistiques du lot 2 | lot 2, avec les statistiques |
| Commande groupée complétée par chacun, avec rappel et dépense « incomplète » bien visible ; objection : une livraison a des frais fixes à répartir ensuite ; réponse : frais répartis automatiquement en plus du montant de chacun (aujourd'hui chacun ajoute quelques dizaines de centimes à la main, rapporté) | saisir une commande où chacun a son montant, plus des frais communs | rien ne mesure les frais ajoutés à la main ; les 55 dépenses mêlant montants fixés et parts ne ressemblent pas à des frais communs : le reste en parts va à une seule personne 33 fois, il fait 10 € ou moins 12 fois | frais à répartir : un champ de la saisie par montants, réparti à parts égales entre ceux qui ont un montant, arrondi au centime testé ; version à fixer (pas tout en première version, décision du 16/11). Commande complétée par chacun et rappel : lot 2, inchangé |
| Wizz pour réclamer un remboursement, son choisi par l'envoyeur | relancer les remboursements | rejoint la relance du lot 2 (14 remboursements en un an) | lot 2, relance par notification ; son personnalisé non garanti par les notifications web (supposé, à vérifier) |
| Widget iPhone avec son solde sur l'écran d'accueil | voir son solde sans ouvrir l'app | une PWA ne fournit pas de widget iPhone (supposé, à vérifier) ; un widget demande une app native, hors périmètre | hors périmètre ; piste à vérifier : pastille sur l'icône (un nombre, par exemple les dépenses non vues, pas un montant) |
| Photo de profil, en gif, qui change selon le solde (avatar « clochard » en négatif, filtre IA) | jeu | aucun avatar dans l'export | plus tard ; avatar choisi parmi quelques images selon le signe du solde, sans IA ni envoi de photo, si le groupe y tient |
| Mandat de prélèvement sur le compte des mauvais payeurs (blague) | relancer les remboursements | demande un prestataire de paiement et un identifiant de créancier SEPA (supposé) | hors périmètre ; besoin couvert par la relance du lot 2 |

## Réponses déjà faites dans la discussion

- Appli privée ? Code open source sur GitHub, serveur réservé au groupe et à qui reçoit le lien (dit par l'utilisateur dans la discussion).
