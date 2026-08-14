/** 多页总览拼图:纯 canvas 网格合成(白卡 + 页码 caption),对齐旧 contact sheet 语义。 */
import { codedError } from "./support.js";

const CELL_GAP = 12;
const CAPTION_HEIGHT = 24;
const CARD_PADDING = 4;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(codedError("RENDER_INTERNAL", "contact sheet image decode failed"));
    image.src = dataUrl;
  });
}

export async function composeContactSheet(input: {
  images: readonly { page: number; dataUrl: string }[];
  tile?: { columns: number; rows: number };
}): Promise<{ dataUrl: string; width: number; height: number }> {
  if (input.images.length === 0) {
    throw codedError("RENDER_TARGET_INVALID", "contact sheet requires at least one image");
  }
  const images = await Promise.all(
    input.images.map(async (entry) => ({
      page: entry.page,
      image: await loadImage(entry.dataUrl),
    })),
  );
  const columns = input.tile?.columns ?? Math.max(1, Math.ceil(Math.sqrt(images.length)));
  const rows = Math.ceil(images.length / columns);
  // 单元格按首图等比;所有页同尺寸是常态,异形页按首图宽等比缩放。
  const cellImageWidth = Math.min(images[0]!.image.naturalWidth, 720);
  const scaleOf = (image: HTMLImageElement): number => cellImageWidth / image.naturalWidth;
  const cellImageHeight = Math.round(images[0]!.image.naturalHeight * scaleOf(images[0]!.image));
  const cardWidth = cellImageWidth + CARD_PADDING * 2;
  const cardHeight = cellImageHeight + CARD_PADDING * 2 + CAPTION_HEIGHT;
  const width = CELL_GAP + columns * (cardWidth + CELL_GAP);
  const height = CELL_GAP + rows * (cardHeight + CELL_GAP);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw codedError("RENDER_INTERNAL", "no 2d context");
  }
  context.fillStyle = "#eef0f2";
  context.fillRect(0, 0, width, height);
  context.textBaseline = "middle";
  context.font = "13px -apple-system, 'Segoe UI', sans-serif";
  images.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = CELL_GAP + column * (cardWidth + CELL_GAP);
    const y = CELL_GAP + row * (cardHeight + CELL_GAP);
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, cardWidth, cardHeight);
    context.strokeStyle = "#cbd0d6";
    context.strokeRect(x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);
    const scale = scaleOf(entry.image);
    context.drawImage(
      entry.image,
      x + CARD_PADDING,
      y + CARD_PADDING,
      Math.round(entry.image.naturalWidth * scale),
      Math.round(entry.image.naturalHeight * scale),
    );
    context.fillStyle = "#444a51";
    context.fillText(
      `Page ${entry.page}`,
      x + CARD_PADDING,
      y + CARD_PADDING + cellImageHeight + CAPTION_HEIGHT / 2,
    );
  });
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}
