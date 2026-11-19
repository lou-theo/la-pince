# La Pince

Partage des dépenses d'un groupe d'amis, en alternative à Tricount : PWA installable sur iOS, Android et ordinateur, sans compte, hors ligne, avec des notifications réservées aux personnes concernées par une dépense. Chaque groupe héberge sa propre instance sur Cloudflare Workers et D1, dans l'offre gratuite.

Projet en construction : l'état, les décisions et le plan sont dans [docs/cadrage/README.md](docs/cadrage/README.md), l'architecture dans [docs/architecture.md](docs/architecture.md).

## Développer

Prérequis : Node à la version de `.node-version` et pnpm (version fixée par le champ `packageManager` de `package.json`).

```sh
pnpm install    # installe les dépendances, compile les textes de l'app et pose le hook git avant push
pnpm verifier   # textes compilés, format, lint, typecheck et tests, comme la CI
```

Règles de contribution et carte du repo : [AGENTS.md](AGENTS.md).

## Héberger son instance

Pas à pas, d'un compte Cloudflare vide à l'adresse à partager au groupe : [docs/auto-hebergement.md](docs/auto-hebergement.md).
