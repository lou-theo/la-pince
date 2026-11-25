# Détection d'une base restaurée

19/11/2026, mécanisme proposé par l'assistant et validé par le mainteneur, « ok c'est bien comme ça go ». Mise en œuvre dans le serveur, l'app et l'outil d'import, test de bout en bout et limites connues : `docs/architecture.md`, Synchronisation hors ligne.

- (a) le téléphone nomme avec son curseur la version reçue sous ce `seq`, et le serveur répond `409 unknown_cursor` s'il ne l'a plus sous ce `seq` : c'est ainsi qu'une restauration de la base, qui fait revenir son compteur en arrière, se détecte sans geste de l'administrateur
- (b) le téléphone efface sa copie et relit depuis 0, sa file d'envoi gardée : une opération perdue par la restauration disparaît aussi des téléphones (dit par le mainteneur : « ok c'est bien comme ça »)
- (c) la révision du curseur se tire de la copie (le changement dont le `seq` égale le curseur, toujours présent puisque la copie garde la version la plus récente de chaque opération) plutôt que d'être enregistrée à part ; une copie qui ne l'a pas relit depuis 0
- (d) les limites connues, déduites du code et non mesurées, sont jugées négligeables, une restauration étant un geste manuel.

Alternatives écartées : un numéro de génération de la base changé à la main après chaque restauration (une étape oubliée fait revenir le problème) ; renvoyer au serveur ce qu'il a perdu (annulerait une restauration faite pour effacer une erreur).

Coût si faux : un aller-retour de plus par lecture, et une relecture complète de trop si une copie perdait le changement de son curseur.
