import { jpegSize } from '@la-pince/core';
import { expect, type Page, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl, openAs, wake } from './app.ts';

// Four quadrants of flat colors in a square, between two black bands that a centered square leaves out (decision « Édition du groupe et avatar »,
// point o: generated pictures, never a photo of a person).
const RED = [220, 40, 40];
const GREEN = [40, 180, 60];
const BLUE = [40, 60, 220];
const YELLOW = [240, 200, 40];

/** A picture of 1200 × 800 drawn by the page's canvas: black bands of 200 px on each side, the four quadrants between them; PNG, or JPEG with an EXIF orientation of 6 (to turn a quarter clockwise) when `turned`. */
async function picture(page: Page, turned: boolean): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ colors, jpeg }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('no 2d context');
      }
      context.fillStyle = '#000';
      context.fillRect(0, 0, 1200, 800);
      colors.forEach(([r, g, b], index) => {
        context.fillStyle = `rgb(${String(r)} ${String(g)} ${String(b)})`;
        context.fillRect(200 + (index % 2) * 400, Math.floor(index / 2) * 400, 400, 400);
      });
      return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.95).split(',')[1] ?? '';
    },
    { colors: [RED, GREEN, BLUE, YELLOW], jpeg: turned },
  );
  const bytes = Buffer.from(base64, 'base64');
  if (!turned) {
    return bytes;
  }
  // APP1 « Exif », big-endian TIFF, one entry: Orientation (0x0112), a SHORT of 6.
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  return Buffer.concat([bytes.subarray(0, 2), Buffer.from([0xff, 0xe1, 0, exif.length + 2, ...exif]), bytes.subarray(2)]);
}

/** Chooses a picture through the badge of the sheet open, by the phone's chooser, as a person does. */
async function choosePhoto(page: Page, badge: string, file: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: badge }).click();
  await (await chooser).setFiles({ name, mimeType: name.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer: file });
}

/** The photo on the big avatar of the sheet, beside the camera badge. */
const sheetPhoto = (page: Page) =>
  page
    .locator('main div')
    .filter({ has: page.getByRole('button', { name: /^Changer (la|ta) photo/ }) })
    .locator(':scope > span > img');

async function loaded(page: Page): Promise<void> {
  await expect.poll(() => sheetPhoto(page).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
}

/** The colors at the middle of each quadrant of the photo the sheet shows, as the server gives it, with its size as a JPEG. */
async function served(page: Page): Promise<{ size: ReturnType<typeof jpegSize>; type: string | undefined; colors: number[][] }> {
  const src = (await sheetPhoto(page).getAttribute('src')) ?? '';
  const answer = await page.request.get(`${appUrl()}${src}`);
  const colors = await page.evaluate(async (address) => {
    const bitmap = await createImageBitmap(await (await fetch(address)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context?.drawImage(bitmap, 0, 0);
    return [
      [64, 64],
      [192, 64],
      [64, 192],
      [192, 192],
    ].map(([x = 0, y = 0]) => [...(context?.getImageData(x, y, 1, 1).data.slice(0, 3) ?? [])]);
  }, src);
  return { size: jpegSize(new Uint8Array(await answer.body())), type: answer.headers()['content-type'], colors };
}

const near = (expected: readonly number[]) => (actual: readonly number[]) =>
  actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) < 40);

async function openSheet(page: Page, member: string): Promise<void> {
  await page.getByRole('link', { name: /^Tu es / }).click();
  await page.getByRole('link', { name: 'Le groupe', exact: true }).click();
  await page.getByRole('link', { name: member, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: member })).toBeVisible();
}

test('a photo set on a member reaches another browser, shows offline, is taken away and undone, each change undone by its band', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'photos');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Capucine');
  await openAs(page, token, 'Agathe');
  await openSheet(page, 'Basile');

  await choosePhoto(page, 'Changer la photo de Basile', await picture(page, false), 'quadrants.png');
  await expect(page.getByText('Photo de Basile changée')).toBeVisible();
  await loaded(page);
  // The middle square, reduced to a JPEG of 256 px, which the server serves as is.
  const photo = await served(page);
  expect(photo.size).toStrictEqual({ width: 256, height: 256 });
  expect(photo.type).toBe('image/jpeg');
  expect([near(RED), near(GREEN), near(BLUE), near(YELLOW)].map((check, index) => check(photo.colors[index] ?? []))).toStrictEqual([
    true,
    true,
    true,
    true,
  ]);

  await wake(second);
  await openSheet(second, 'Basile');
  await loaded(second);

  await page.getByRole('button', { name: 'Annuler ce changement de photo' }).click();
  await expect(page.getByText('Photo de Basile changée')).toBeHidden();
  await expect(sheetPhoto(page)).toHaveCount(0);
  await wake(second);
  await expect(sheetPhoto(second)).toHaveCount(0);
  await other.close();

  // Set again, then shown after a restart without network: from the copy the service worker keeps.
  await choosePhoto(page, 'Changer la photo de Basile', await picture(page, false), 'quadrants.png');
  await loaded(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Basile' })).toBeVisible();
  await loaded(page);
  // From the service worker's copy, not only from the browser's HTTP cache, which the server's `Cache-Control` also fills.
  const src = (await sheetPhoto(page).getAttribute('src')) ?? '';
  expect(await page.evaluate(async (address) => (await (await caches.open('la-pince-photos')).match(address)) !== undefined, src)).toBe(true);
  await expect(page.getByRole('button', { name: 'Changer la photo de Basile' })).toBeDisabled();
  await context.setOffline(false);
  await wake(page);

  await expect(page.getByRole('button', { name: 'Changer la photo de Basile' })).toBeEnabled();
  await page.getByRole('button', { name: 'Changer la photo de Basile' }).click();
  await page.getByRole('dialog', { name: 'Photo de Basile' }).getByRole('button', { name: 'Retirer la photo' }).click();
  await expect(page.getByText('Photo de Basile retirée')).toBeVisible();
  await expect(sheetPhoto(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Annuler ce changement de photo' }).click();
  await loaded(page);
});

test('a picture turned by its EXIF orientation is set upright', async ({ page }, info) => {
  const token = tokenFor(info.project.name, 'photos');
  await openAs(page, token, 'Agathe');
  await openSheet(page, 'Capucine');
  await choosePhoto(page, 'Changer la photo de Capucine', await picture(page, true), 'tournee.jpg');
  await expect(page.getByText('Photo de Capucine changée')).toBeVisible();
  await loaded(page);
  // Turned a quarter clockwise: blue at the top left, red at the top right, yellow at the bottom left, green at the bottom right.
  const { colors } = await served(page);
  expect([near(BLUE), near(RED), near(YELLOW), near(GREEN)].map((check, index) => check(colors[index] ?? []))).toStrictEqual([
    true,
    true,
    true,
    true,
  ]);
});
