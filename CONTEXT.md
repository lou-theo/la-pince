# Vocabulaire

Chaque terme du domaine est défini une fois ici ; le code, les docs et l'interface l'emploient dans ce sens.

- **Groupe** : ensemble de personnes qui partagent des dépenses, accessible par un lien, sans compte.
- **Membre** : personne d'un groupe, qu'elle ait l'app ou non ; quelqu'un d'autre peut saisir pour elle.
- **Qui je suis** : le membre qu'une personne déclare être sur son téléphone ; il détermine « ma part » et les notifications reçues.
- **Opération** : ce qu'on enregistre dans un groupe, dépense ou remboursement ; seul objet de la synchronisation.
- **Nature** : dépense ou remboursement ; sert à l'affichage et aux statistiques, jamais au calcul, et ne se déduit pas de la forme (une avance pour un ami a la forme d'un remboursement).
- **Saisie** : ce que la personne a entré pour une opération (montants, répartition, titre) ; forme libre et versionnée, appelée à évoluer.
- **Effet** : ce qu'une opération change aux comptes, calculé depuis sa saisie : le payeur et la part de chaque membre ; forme fixe, seule lue par les soldes, le filtre, les notifications et les statistiques.
- **Payeur** : membre qui a avancé l'argent d'une opération.
- **Part** : somme qu'une opération met à la charge d'un membre ; la somme des parts égale le montant payé.
- **Concerné** : membre qui a une part non nulle dans une opération.
- **Ma part** : la part du membre « qui je suis » dans une opération.
- **Solde** : ce qu'un membre a payé moins la somme de ses parts, sur tout le groupe ; positif, le groupe lui doit de l'argent.
- **Remboursement suggéré** : virement proposé entre deux membres pour ramener les soldes à zéro ; pas une opération tant qu'il n'est pas enregistré.
- **Centimes** : unité de tous les montants, en entiers ; un montant saisi en euros est converti à l'entrée et jamais arrondi.
- **File d'envoi** : opérations saisies sur le téléphone en attente d'envoi au serveur, rejouables sans doublon.
- **Version** (d'une opération) : chaque état envoyé d'une opération, gardé par le serveur ; la dernière arrivée au serveur fait foi.
