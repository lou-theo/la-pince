---
name: captures
description: Captures des écrans de La Pince pour une PR, sur le groupe de démo (planche avant/après en format téléphone et ordinateur, GIF d'un parcours). À utiliser pour toute PR qui touche un écran, un style ou un texte de l'app, et pour voir l'app sans la lancer à la main. Triggers : « captures », « planche », « avant/après », « GIF du parcours », « montre l'écran », PR qui modifie `apps/app`.
---

# Captures

`pnpm captures` (outil `tools/captures`) démarre son propre serveur (Worker dans workerd sur une D1 locale neuve), y importe le corpus de démo par `tools/import-tricount`, lance l'app par Vite, puis photographie chaque écran de `tools/captures/src/screens.ts` en iPhone (390 × 844) et en ordinateur (1280 × 800), compose les planches en HTML et les capture, et filme le parcours de `journey` en GIF (ffmpeg). Il n'utilise jamais l'export réel de `temp/` : seulement le corpus anonymisé.

## Quand

- Toute PR qui change ce qu'un écran montre (composant, style, texte, nouvel écran) porte la planche avant/après dans sa section Vérification, et le GIF quand elle change un parcours.
- Un nouvel écran s'ajoute à `screens` (et au parcours s'il en fait partie) dans la même PR, sans s'appuyer sur les textes de l'interface, pour que la version d'avant se photographie aussi.

## Comment

1. `pnpm captures --avant origin/main` depuis la copie de travail de la branche (worktree compris). La version d'avant est extraite dans un worktree temporaire, installée, photographiée, puis retirée ; un écran qu'elle n'a pas est marqué « absent ».
2. Sorties dans `temp/captures/<branche>/` de la copie principale (survit au worktree), ou dans `--sortie <dossier>` : `planche-telephone.png`, `planche-ordinateur.png`, `parcours.gif`, et les captures unitaires dans `avant/` et `apres/`.
3. Relire les planches avant de les joindre : un écran absent ou vide côté « après » est un bug de l'écran ou de son entrée dans `screens`.
4. Joindre les images à la PR : écrire la description avec `![planche téléphone](./planche-telephone.png)` dans un fichier du dossier des sorties, puis `gh pr edit <numéro> --body-file <fichier> --attach <image>` pour chaque image (`--attach` répétable) : gh téléverse chaque image et réécrit la référence vers l'image en ligne. Les images d'une PR publique sont publiques : groupe de démo seulement.

Prérequis : Chromium de Playwright (`pnpm --filter @la-pince/captures exec playwright install chromium`, une fois par version de Playwright) et ffmpeg sur la machine. La CI ne lance pas les captures.
