# Vocabulaire

Chaque terme du domaine est défini une fois ici ; les docs et l'interface l'emploient dans ce sens, le code sous le nom anglais donné entre parenthèses (le code est en anglais, la doc en français).

- **Groupe** (`Group`) : ensemble de personnes qui partagent des dépenses, accessible par un lien, sans compte.
- **Jeton du lien** (`token`) : secret contenu dans le lien d'un groupe ; qui l'a lit et écrit le groupe, le serveur n'en garde qu'un haché.
- **Membre** (`Member`) : personne d'un groupe, qu'elle ait l'app ou non ; quelqu'un d'autre peut saisir pour elle.
- **Qui je suis** (`currentMember`) : le membre qu'une personne déclare être sur son téléphone ; il détermine « ma part » et les notifications reçues.
- **Opération** (`Operation`) : ce qu'on enregistre dans un groupe, dépense ou remboursement ; seul objet de la synchronisation.
- **Nature** (`kind`) : dépense (`expense`) ou remboursement (`reimbursement`) ; sert à l'affichage et, par l'effet, à dire si l'opération compte dans le total dépensé, jamais au calcul des parts, et ne se déduit pas de la forme (une avance pour un ami a la forme d'un remboursement).
- **Saisie** (`Entry`) : ce que la personne a entré pour répartir une opération (payeur, montants, répartition) ; forme libre et versionnée, appelée à évoluer.
- **Ligne de saisie** (`EntryLine`) : dans la saisie actuelle, la ligne d'un membre de la répartition, avec soit un montant fixe, soit un poids ; une ligne à poids peut donner une part nulle, et son membre n'est alors pas concerné.
- **Poids** (`weight`) : nombre entier positif d'une ligne de saisie ; ce qui reste du total après les montants fixes se répartit entre les lignes au prorata de leur poids (parts égales : même poids pour tous).
- **Effet** (`Effect`) : ce qu'une opération change aux comptes, calculé depuis sa saisie : le payeur, la part de chaque membre et s'il compte dans le total dépensé (`countsAsSpending`, décidé par chaque version de saisie : faux pour un remboursement) ; forme fixe, seule lue par les soldes, le filtre, les notifications et les statistiques.
- **Payeur** (`payer`) : membre qui a avancé l'argent d'une opération.
- **Part** (`share`) : somme qu'une opération met à la charge d'un membre ; la somme des parts égale le montant payé.
- **Concerné** (`involved`) : membre qui a une part non nulle dans une opération.
- **Ma part** (`myShare`) : la part du membre « qui je suis » dans une opération.
- **Solde** (`balance`) : ce qu'un membre a payé moins la somme de ses parts, sur tout le groupe ; positif, le groupe lui doit de l'argent.
- **Remboursement suggéré** (`SuggestedTransfer`) : virement proposé entre deux membres pour ramener les soldes à zéro ; pas une opération tant qu'il n'est pas enregistré.
- **Centimes** (`Cents`) : unité de tous les montants, en entiers ; un montant saisi en euros est converti à l'entrée et jamais arrondi.
- **File d'envoi** (`outbox`) : opérations saisies sur le téléphone en attente d'envoi au serveur, rejouables sans doublon.
- **Version** d'une opération (`revision`) : chaque état envoyé d'une opération, gardé par le serveur ; la dernière arrivée au serveur fait foi ; le contrat de synchronisation la nomme `Operation` (`operationSchema`), seule forme sous laquelle une opération circule.
- **Auteur** d'une version (`author`) : le membre « qui je suis » du téléphone qui l'a envoyée, quand il est connu ; il doit être membre du groupe.
- **Opération supprimée** (`deleted`) : version qui marque l'opération comme supprimée au lieu de l'effacer, pour que la suppression atteigne les autres téléphones ; elle n'a plus d'effet.
- **Curseur** (`cursor`) : position d'un téléphone dans l'historique des changements du serveur, la valeur du compteur (`seq`) du dernier changement reçu ; il ne fait que croître.
- **Changement** (`Change`) : version courante d'une opération telle que la lecture la rend, avec son `seq`, la valeur du compteur du serveur quand il l'a écrite.
