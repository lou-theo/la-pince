# Remboursements suggérés

18/11/2026, proposé par l'assistant, accepté par l'utilisateur.

Algorithme glouton de Spliit (créanciers puis débiteurs, dans un ordre fixe par identifiant), stable : un virement suggéré une fois fait laisse les suivants inchangés, quel que soit l'ordre dans lequel les membres remboursent. Sur les soldes de l'export du 16/11 (13 membres à solde non nul, dans l'ordre des identifiants Tricount ; le nombre dépend de cet ordre ; l'import garde les identifiants de Tricount, le corpus de démo en a d'autres, PR #5), 12 virements contre 11 pour le plus gros créancier contre le plus gros débiteur d'abord et pour le minimum exact (script local du 18/11, non contre-vérifié), deux alternatives écartées pour leur instabilité.

Coût si faux : un virement de plus que le minimum, algorithme isolé et remplaçable.
