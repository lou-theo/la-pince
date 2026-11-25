# Conflits et refus hors ligne

19/11/2026, deux réponses du mainteneur pendant la file d'envoi (PR #13).

- **Modification hors ligne qui écrase celle d'un autre** : « pour [le] moment ça écrase en silence, la 1ere chose qui viendra sera un historique des modifs et on verra plus tard si on fait quelque chose par rapport à ça » ; aucun avis ni détection de conflit, l'historique des modifications en tête de la suite (décision [Version 1](version-1.md)).
- **Saisie hors ligne refusée au retour du réseau** : « dans un premier temps on ne gère pas mais à termes je pense qu'il va falloir un systeme de notif intégré qui liste les actions à trancher : conflit de modif, ajout échoué, dépense à compléter, etc / mais on repousse à plus tard » ; la version refusée sort de la file sans avis et l'opération revient à la copie du serveur ; plus tard, une liste intégrée d'actions à trancher, sans version fixée.

Alternatives écartées : avis à l'auteur de la modification écrasante (reco de l'assistant) ; la suppression l'emporte (rouvrait les décisions [Version 1](version-1.md) et [Synchronisation hors ligne](synchronisation-hors-ligne.md)) ; bandeau des saisies refusées avec « ressaisir » et « ignorer » (reco de l'assistant).

Coût si faux : une saisie hors ligne écrasée ou refusée disparaît sans avis, jusqu'à l'historique des modifications.
