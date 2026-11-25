# Hébergement et stack

16/11/2026, dit par le mainteneur.

Cloudflare Workers et D1 en juridiction UE, offre gratuite ; perte de la gratuité ou dépassement jugés peu probables, « on cherchera autre chose » ; pas de matériel à la maison, serveur loué « beaucoup trop cher ». Stack : TypeScript, PWA React avec Vite, IndexedDB et file d'envoi côté téléphone (identifiant unique créé sur le téléphone, envoi rejouable sans doublon), Hono et Drizzle côté serveur, SQLite (D1), Vitest et Playwright. Code portable vers un serveur Node si besoin.
