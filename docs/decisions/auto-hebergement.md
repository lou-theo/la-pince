# Instance privée et auto-hébergement

19/11/2026, dit par le mainteneur : « ma config perso cloudflare ne doit de toute façon pas être indiquée », « charge à chaque personne souhaitant s'en servir de l'auto héberger, il faudra faire un guide de setup », « mon instance ne doit pas être publiée » ; mécanisme proposé par l'assistant, accepté.

- (a) La Pince est un outil open source que chaque groupe héberge sur son propre compte Cloudflare ; l'instance du mainteneur n'apparaît nulle part dans le repo (ni adresse, ni sous-domaine, ni identifiant de compte ou de base)
- (b) Config de déploiement : modèle committé `apps/server/wrangler.production.example.jsonc`, copie `wrangler.production.jsonc` ignorée par git qui porte l'identifiant de la base ; `wrangler.jsonc` reste la config du local et des tests
- (c) Le Worker sert aussi l'app construite (assets de Workers, `/api/*` au Worker, autre chemin à l'app) : une adresse et un déploiement par instance, l'app appelant `/api` sur sa propre origine comme en développement ; alternative écartée : Cloudflare Pages pour l'app, deux déploiements et deux adresses à relier
- (d) Guide `docs/auto-hebergement.md`, en version 1, écrit en déployant l'instance du mainteneur sur le groupe de démo le 19/11 : chaque commande y a tourné, sauf `wrangler login` (jeton d'API à la place) et `d1 time-travel restore` (base en service), `d1 create` hors terminal interactif (la question d'écrire `wrangler.jsonc`, coupée dans le guide par `--update-config=false`, lue dans le code de Wrangler 4.164).

Coût si faux : un guide qui dérive du code ; à rejouer à chaque changement du déploiement.
