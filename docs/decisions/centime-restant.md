# Centime restant et import

18/11/2026, proposé par l'assistant, accepté par l'utilisateur.

Le centime restant d'une répartition suit la règle de Spliit (plus grand reste, égalité départagée par une rotation tirée de l'identifiant de l'opération), seule règle du cœur ; l'import enregistre les parts calculées par Tricount comme une saisie en montants exacts, identiques au centime par construction. Raison : Tricount suit sa propre règle (sur les 250 opérations de l'export, 36 ont un centime restant, donné aux dernières lignes de la liste dans 31 cas, règle non identifiée dans 5 ; script local du 18/11, non contre-vérifié).

Alternatives écartées : saisie en poids avec un champ « centimes restants attribués à » rempli par l'import (garde les dépenses importées modifiables à parts égales, au prix d'un champ de plus à valider) ; imiter la règle de Tricount (cas inexpliqués, calcul dépendant d'un concurrent).

Coût si faux : une dépense importée à parts égales s'ouvre en montants à la modification et se remet à parts égales à la main.
