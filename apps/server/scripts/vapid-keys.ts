// Prints a new VAPID key pair on one line, public key first, for the guide to hand each half to `wrangler secret put` without writing it to a file.
import { generateVapidKeys } from '../src/vapid.ts';

const { publicKey, privateKey } = await generateVapidKeys();
// eslint-disable-next-line no-console -- the key pair is what the script prints.
console.log(`${publicKey} ${privateKey}`);
