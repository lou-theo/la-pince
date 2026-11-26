import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { type Browser, type BrowserContextOptions, chromium } from 'playwright';

import { boardHtml } from './board.ts';
import { type Demo, journey, screens } from './screens.ts';
import { startStack } from './stack.ts';

const exec = promisify(execFile);

interface Viewport {
  readonly name: string;
  readonly label: string;
  readonly options: BrowserContextOptions;
  /** Width of a screenshot on the board. */
  readonly boardWidth: number;
  readonly screensGo: 'across' | 'down';
}

const phoneSize = { width: 390, height: 844 };
const phone: Viewport = {
  name: 'telephone',
  label: 'Téléphone (iPhone, 390 × 844)',
  options: { viewport: phoneSize, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  boardWidth: 300,
  screensGo: 'across',
};
const viewports: readonly Viewport[] = [
  phone,
  { name: 'ordinateur', label: 'Ordinateur (1280 × 800)', options: { viewport: { width: 1280, height: 800 } }, boardWidth: 640, screensGo: 'down' },
];

// Marks an output folder as written by this tool, the only kind it empties.
const outputMarker = '.pnpm-captures';

const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();

/** Shoots every screen in every viewport into `<out>/<version>/<viewport>/<screen>.png`; returns the screens found, by viewport. */
async function shoot(browser: Browser, demo: Demo, out: string, print: (line: string) => void): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  for (const viewport of viewports) {
    const names = new Set<string>();
    await mkdir(join(out, viewport.name), { recursive: true });
    for (const screen of screens) {
      // A fresh context per screen: nothing remembered from the screen before.
      const context = await browser.newContext({ ...viewport.options, colorScheme: 'light', locale: 'fr-FR', permissions: ['notifications'] });
      context.setDefaultTimeout(5000);
      const page = await context.newPage();
      try {
        await screen.reach(page, demo);
        await page.screenshot({ path: join(out, viewport.name, `${screen.name}.png`) });
        names.add(screen.name);
      } catch (error) {
        print(`  ${viewport.name}/${screen.name}: absent (${(error as Error).message.split('\n', 1)[0] ?? ''})`);
      } finally {
        await context.close();
      }
    }
    found.set(viewport.name, names);
  }
  return found;
}

/** Films the journey on a phone and turns it into a GIF with ffmpeg. */
async function film(browser: Browser, demo: Demo, out: string): Promise<string> {
  const context = await browser.newContext({
    ...phone.options,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    permissions: ['notifications'],
    recordVideo: { dir: join(out, 'video'), size: phoneSize },
  });
  const page = await context.newPage();
  await journey(page, demo);
  await context.close();
  const video = await page.video()?.path();
  if (video === undefined) {
    throw new Error('no video recorded');
  }
  const gif = join(out, 'parcours.gif');
  const filter = 'fps=10,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer';
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', filter, gif]);
  await rm(join(out, 'video'), { recursive: true, force: true });
  return gif;
}

export interface Options {
  /** Git ref of the version before, for the before and after board. */
  readonly before?: string | undefined;
  /** Output folder; by default `temp/captures/<branch>` of the main checkout, which outlives a worktree. */
  readonly out?: string | undefined;
  readonly print: (line: string) => void;
}

/** Shoots the boards and the GIF; returns false when a screen is missing from the branch, which the board alone would hide. */
export async function captures({ before, out: outOption, print }: Options): Promise<boolean> {
  const root = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  const branch = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const mainCheckout = dirname(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const out = outOption ?? join(mainCheckout, 'temp/captures', branch.replaceAll('/', '-'));
  if (existsSync(out) && (await readdir(out)).length > 0 && !existsSync(join(out, outputMarker))) {
    throw new Error(`${out} is not empty and was not written by pnpm captures: choose a new or empty folder`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, outputMarker), '');

  // The new headless mode: the default headless shell keeps notifications denied, and the screens would show them blocked.
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const versions: { label: string; dir: string; found: Map<string, Set<string>> }[] = [];
    if (before !== undefined) {
      const sha = await git(root, 'rev-parse', '--short', before);
      const checkout = await mkdtemp(join(tmpdir(), `la-pince-captures-${sha}-`));
      print(`version before: ${before} (${sha}), checked out and installed in ${checkout}`);
      // Forgets the worktrees of an interrupted run, whose folders are gone.
      await git(root, 'worktree', 'prune');
      try {
        await git(root, 'worktree', 'add', '--detach', checkout, sha);
        await exec('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: checkout });
        const stack = await startStack(checkout, browser);
        const dir = join(out, 'avant');
        if (stack === undefined) {
          print('  no app in this version: every screen absent');
          versions.push({ label: `Avant (${before})`, dir, found: new Map() });
        } else {
          try {
            versions.push({ label: `Avant (${before})`, dir, found: await shoot(browser, stack.demo, dir, print) });
          } finally {
            await stack.close();
          }
        }
      } finally {
        // Still registered if `worktree add` failed: prune forgets it once its folder is gone.
        await rm(checkout, { recursive: true, force: true });
        await git(root, 'worktree', 'prune');
      }
    }

    print(`version after: ${branch}`);
    const stack = await startStack(root, browser);
    if (stack === undefined) {
      throw new Error('this checkout has no app (apps/app/vite.config.ts)');
    }
    try {
      const dir = join(out, 'apres');
      versions.push({ label: `Après (${branch})`, dir, found: await shoot(browser, stack.demo, dir, print) });
      print(`GIF: ${await film(browser, stack.demo, out)}`);
    } finally {
      await stack.close();
    }

    for (const viewport of viewports) {
      const board = join(out, `planche-${viewport.name}.html`);
      const html = boardHtml({
        title: viewport.label,
        versions: versions.map((version) => version.label),
        screens: screens.map((screen) => ({
          label: screen.label,
          images: versions.map((version) =>
            version.found.get(viewport.name)?.has(screen.name) === true
              ? relative(out, join(version.dir, viewport.name, `${screen.name}.png`))
              : undefined,
          ),
        })),
        imageWidth: viewport.boardWidth,
        screensGo: viewport.screensGo,
      });
      await writeFile(board, html);
      // Twice the pixels, so that the shrunk computer screenshots stay legible.
      const page = await browser.newPage({ deviceScaleFactor: 2 });
      await page.goto(`file://${board}`);
      await page.screenshot({ path: board.replace(/\.html$/, '.png'), fullPage: true });
      await page.close();
      print(`board: ${board.replace(/\.html$/, '.png')}`);
    }
    const after = versions.at(-1)?.found;
    return viewports.every((viewport) => after?.get(viewport.name)?.size === screens.length);
  } finally {
    await browser.close();
  }
}
