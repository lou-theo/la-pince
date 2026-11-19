import { createHash } from 'node:crypto';

import { computeBalances, computeEffect, convertTricount } from '@la-pince/core';
import corpus from '@la-pince/core/fixtures/tricount-demo.json' with { type: 'json' };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// A UUID drawn from a seed, the same for the same seed.
function uuidFrom(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const remap = <T>(value: T, salt: string): T => JSON.parse(JSON.stringify(value).replace(UUID, (uuid) => uuidFrom(`${salt}:${uuid}`))) as T;

/**
 * The demo corpus as a group of its own: every identifier (group, members, operations) drawn again from `salt`, since the server knows operations
 * and members across groups; with `copies`, each expense and reimbursement repeated that many times under new identifiers, balances multiplied as
 * much, to measure the app on a group bigger than the real one.
 */
export function demoGroup(salt: string, copies = 1): unknown {
  const [response] = corpus.Response;
  if (response === undefined) {
    throw new Error('The demo corpus has no registry');
  }
  const registry = response.Registry;
  // Copies keep the members: only the entry's own identifier is drawn again.
  const entries = Array.from({ length: copies }, (_, copy) =>
    registry.all_registry_entry.map((item) =>
      copy === 0 ? item : { RegistryEntry: { ...item.RegistryEntry, uuid: uuidFrom(`copy-${String(copy)}:${item.RegistryEntry.uuid}`) } },
    ),
  ).flat();
  return remap({ ...corpus, Response: [{ ...response, Registry: { ...registry, all_registry_entry: entries } }] }, salt);
}

/** Balance of each member of an export by name, in cents, computed by the core outside the app: the reference the scenarios check the screens against. */
export function balancesByName(data: unknown): Map<string, number> {
  const group = convertTricount(data);
  const names = new Map(group.members.map((member) => [member.id, member.name]));
  const balances = computeBalances(group.operations.map((operation) => computeEffect(operation.id, operation.entry)));
  return new Map(group.members.map((member) => [names.get(member.id) ?? member.id, balances.get(member.id) ?? 0]));
}
