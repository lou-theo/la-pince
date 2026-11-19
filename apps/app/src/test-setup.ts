import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';

// A new, empty IndexedDB for each test: what one test keeps on the phone never leaks into the next.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
