export interface Board {
  readonly title: string;
  /** Label of each version, in order (before, after). */
  readonly versions: readonly string[];
  /** Each screen with the path of its image in each version, relative to the board; undefined when the screen is absent from that version. */
  readonly screens: readonly { readonly label: string; readonly images: readonly (string | undefined)[] }[];
  /** Width of each image on the board, in CSS pixels. */
  readonly imageWidth: number;
  /** `across`: one column per screen and one row per version, compact for narrow phone screenshots; `down`: one row per screen. */
  readonly screensGo: 'across' | 'down';
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Board of screenshots, each screen in each version, as an HTML page to capture. */
export function boardHtml({ title, versions, screens, imageWidth, screensGo }: Board): string {
  const cell = (label: string, image: string | undefined) =>
    image === undefined
      ? '<td class="absent">absent</td>'
      : `<td><img src="${escapeHtml(image)}" width="${String(imageWidth)}" alt="${escapeHtml(label)}"></td>`;
  const header = (labels: readonly string[]) => `<tr><th></th>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr>`;
  const row = (label: string, cells: readonly string[]) => `<tr><th scope="row">${escapeHtml(label)}</th>${cells.join('')}</tr>`;
  const [head, body] =
    screensGo === 'across'
      ? [
          header(screens.map((screen) => screen.label)),
          versions.map((version, index) =>
            row(
              version,
              screens.map((screen) => cell(screen.label, screen.images[index])),
            ),
          ),
        ]
      : [
          header(versions),
          screens.map((screen) =>
            row(
              screen.label,
              versions.map((_, index) => cell(screen.label, screen.images[index])),
            ),
          ),
        ];
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 24px; font: 15px system-ui, sans-serif; background: #f5f5f4; color: #1c1917; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  table { border-collapse: separate; border-spacing: 16px 12px; }
  th { text-align: left; vertical-align: top; font-weight: 600; }
  img { display: block; border: 1px solid #d6d3d1; border-radius: 8px; background: #fff; }
  .absent { width: ${String(imageWidth)}px; height: 120px; text-align: center; color: #78716c; border: 1px dashed #a8a29e; border-radius: 8px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<table>
<thead>${head}</thead>
<tbody>
${body.join('\n')}
</tbody>
</table>
</body>
</html>
`;
}
