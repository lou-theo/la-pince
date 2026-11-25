# Détection d'une base restaurée

19/11/2026, mécanisme proposé par l'assistant et validé par le mainteneur, « ok c'est bien comme ça go ». Mise en œuvre dans le serveur, l'app et l'outil d'import, test de bout en bout et limites connues : `docs/architecture.md`, Synchronisation hors ligne.

- (a) au-delà de 0, le téléphone envoie avec son curseur l'identifiant de la version reçue sous ce `seq` ; le serveur répond `409 unknown_cursor` quand le groupe n'a plus cette version sous ce `seq`, ce qui arrive après une restauration de la base à un instant antérieur, son compteur revenant en arrière avec elle
- (b) le téléphone efface sa copie et relit depuis 0, sa file d'envoi gardée : une opération perdue par la restauration disparaît aussi des téléphones (dit par le mainteneur : « ok c'est bien comme ça »)
- (c) la révision du curseur se tire de la copie (le changement dont le `seq` égale le curseur, toujours présent puisque la copie garde la version la plus récente de chaque opération) plutôt que d'être enregistrée à part ; une copie qui ne l'a pas relit depuis 0
- (d) les limites connues, déduites du code et non mesurées, sont jugées négligeables, une restauration étant un geste manuel.

Alternatives écartées : un numéro de génération de la base changé à la main après chaque restauration (une étape oubliée fait revenir le problème) ; renvoyer au serveur ce qu'il a perdu (annulerait une restauration faite pour effacer une erreur).

Coût si faux : un aller-retour de plus par lecture, et une relecture complète de trop si une copie perdait le changement de son curseur.
