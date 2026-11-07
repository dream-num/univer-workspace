import { compile } from 'sass';

/** Let esbuild own CSS-module identity; the Host lifecycle owns the stylesheet. */
export function markdownStyles() {
  return { name: 'shared-markdown-styles', setup(build) {
    build.onLoad({ filter: /\.module\.scss$/ }, args => ({
      contents: compile(args.path, { style: 'compressed' }).css,
      loader: 'local-css',
    }));
  } };
}

export const markdownCssPlaceholder = '__SPACE_MARKDOWN_CSS_BUNDLED_BY_BUILD__';

export async function writeClientBundle(result, writeFile) {
  const css = result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  for (const file of result.outputFiles.filter(file => !file.path.endsWith('.css'))) {
    const marker = JSON.stringify(markdownCssPlaceholder);
    if (!file.text.includes(marker)) throw new Error('Client stylesheet lifecycle placeholder is missing.');
    await writeFile(file.path, file.text.replaceAll(marker, JSON.stringify(css)));
  }
}
