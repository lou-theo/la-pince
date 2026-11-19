import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** The file a request path names inside the build, or `index.html` for a route of the app. */
export function fileFor(dist: string, path: string): string {
  // Normalized from the root, a path cannot climb out of the build.
  const relative = normalize(`/${decodeURIComponent(path.split('?', 1)[0] ?? '')}`);
  return join(dist, extname(relative) === '' ? 'index.html' : relative);
}

/**
 * Serves the built app as the host will, files read from disk at each request (a test changes the service worker under a running server), and
 * passes `/api` to the Worker. Gives the address it listens on.
 */
export async function serveApp(dist: string, apiUrl: string): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? '/';
      if (path.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(chunk as Buffer);
        }
        const answer = await fetch(new URL(path, apiUrl), {
          method: request.method ?? 'GET',
          headers: { 'Content-Type': request.headers['content-type'] ?? 'application/json' },
          ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
        });
        response.writeHead(answer.status, { 'Content-Type': answer.headers.get('content-type') ?? 'application/json' });
        response.end(Buffer.from(await answer.arrayBuffer()));
        return;
      }
      const file = fileFor(dist, path);
      if (
        !(await stat(file).then(
          (info) => info.isFile(),
          () => false,
        ))
      ) {
        response.writeHead(404).end();
        return;
      }
      // Revalidated at each request, as a host serves a new build.
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(await readFile(file));
    })().catch((error: unknown) => {
      response.writeHead(502).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The app server did not say where it listens');
  }
  return {
    // `localhost`, a secure context where the service worker registers.
    url: `http://localhost:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        }),
      ),
  };
}
