# Partage du lien du groupe

19/11/2026, demandé par le mainteneur : « pour moi le lien doit facilement pouvoir se retrouver et être accessible de tous », bouton proposé par l'assistant et accepté : « ok ça me va pour le bouton de partage ».

- (a) l'en-tête du groupe porte « Partager le lien du groupe », qui ouvre la feuille de partage du téléphone (`navigator.share`, titre, phrase et lien) ; sans elle, ou si le navigateur la refuse, le lien est copié dans le presse-papiers et l'app le dit ; si la copie échoue aussi, le lien s'affiche dans un champ à copier à la main ; fermer la feuille sans partager ne fait rien d'autre
- (b) le lien est rebâti sur le site ouvert (`groupLink`), pas sur l'adresse de la page, qui peut être une sous-page du groupe
- (c) le jeton reste haché en base (PR #7) : un lien perdu se redemande à un membre, qui le partage depuis son app.

Alternatives écartées : jeton gardé en clair en base pour que l'administrateur le relise (une copie de la base donnerait accès à tous les groupes) ; jeton chiffré par le secret d'administration (une clé de plus pour un risque déjà couvert par le bouton).

Coût si faux : un groupe dont plus aucun membre n'a le lien repasse par un nouvel import (`LA_PINCE_NEW_LINK=1`), le lien renvoyé à tous.
