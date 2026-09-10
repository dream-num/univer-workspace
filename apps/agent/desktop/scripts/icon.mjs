import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
export async function renderIcon({ executablePath, source, output }) {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    await page.setContent(
      `<style>body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${await readFile(source, "utf8")}`,
    );
    await page.screenshot({ path: output, omitBackground: true });
  } finally {
    await browser.close();
  }
}
