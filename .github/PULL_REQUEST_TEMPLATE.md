## Pourquoi

<!-- Le besoin ou le problème, pour qui ; lien vers l'issue ou la décision du cadrage. -->

## Ce que ça change

<!-- Ce que l'utilisateur voit ou ce que le code fait de différent, en quelques lignes. -->

## Impact

<!-- Pour chaque ligne, « aucun » ou ce qui change et comment c'est couvert. -->

- Calcul des parts et des soldes :
- Schéma D1 (migration) :
- Contrat de synchronisation (API, format des opérations) :
- Données gardées sur le téléphone (IndexedDB, file d'envoi) :

## Vérification

<!-- Tests ajoutés, parcours rejoué à la main ; captures avant / après en format téléphone et ordinateur pour un changement visible. -->

## Checklist

- [ ] `pnpm verifier` passe
- [ ] Aucune donnée identifiable, ni dans le diff ni dans les commits de la branche (noms, pseudos, lien ou jeton de tricount, export) ; captures sur un groupe de démo
- [ ] Montants en centimes entiers, testés au centime si le calcul change
- [ ] `CONTEXT.md`, `docs/architecture.md` et `docs/cadrage/README.md` à jour si le changement les touche
