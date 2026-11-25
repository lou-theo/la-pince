# Synchronisation hors ligne

18/11/2026, proposée par l'assistant, acceptée par l'utilisateur.

Chaque téléphone garde tout le groupe en local (environ 75 Ko par an, au jugé) et calcule tout ; saisies envoyées par une file rejouable, identifiant créé sur le téléphone ; le serveur recalcule l'effet avec le même cœur de calcul et refuse l'incohérent ; lecture incrémentale par un compteur croissant du serveur ; le serveur garde toutes les versions de chaque opération, la dernière arrivée gagne (jamais l'horloge du téléphone), l'historique permet de rattraper ; suppression par marquage. Modifications concurrentes d'une même dépense rares, l'usage étant des ajouts décorrélés (dit par l'utilisateur). Bibliothèques de fusion automatique (CRDT) écartées, non évaluées en détail.
