// Renders the 1200x630 link preview images served at /link-preview/<kind>.png.
// Needs Google Chrome (or CHROME=<binary>) and ImageMagick's `magick` on PATH.
// Run from apps/workspace: node scripts/render-link-preview-images.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const output = resolve(fileURLToPath(new URL("../web/public/link-preview", import.meta.url)));
const sans = import.meta.resolve("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2");
const mono = import.meta.resolve("@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2");

const ink = "#0A0C12";
const ink2 = "#4F545D";
const line = "rgba(12,14,22,.09)";
const line2 = "rgba(12,14,22,.16)";
const mark = `<svg viewBox="0 0 20 20" width="44" height="44" fill="${ink}"><path d="M6.674 9.781C6.674 9.862 6.623 9.934 6.548 9.961L0.009 12.338V15.524L8.635 12.179C9.204 11.96 9.58 11.413 9.58 10.803V0.016H6.674V9.781Z"/><path d="M19.992 12.338V15.524L11.191 12.179C10.622 11.96 10.246 11.413 10.246 10.803V8.715C10.246 8.105 10.622 7.557 11.191 7.338L19.992 4.012V7.475L13.217 9.76C13.178 9.773 13.153 9.809 13.153 9.849C13.153 9.889 13.178 9.924 13.215 9.938L19.992 12.338Z"/><path d="M9.58 13.196V19.999H6.674L6.675 13.952C6.675 13.76 6.793 13.589 6.972 13.52L8.953 12.764C9.256 12.648 9.58 12.871 9.58 13.196Z"/><path d="M5.495 9.465L0.009 7.221V3.994L5.774 6.354C5.913 6.411 6.004 6.546 6.004 6.696L6.005 9.122C6.005 9.386 5.739 9.565 5.495 9.465Z"/></svg>`;

const glyphs = {
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  slide: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/>',
  page: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M6 17l3-4 3 2 4-5"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

const bar = (width, color = "rgba(12,14,22,.12)", height = 12) =>
  `<i style="display:block;width:${width}px;height:${height}px;border-radius:${height / 2}px;background:${color}"></i>`;

function sheetArt(color) {
  const columns = ["", "A", "B", "C", "D", "E"];
  const rows = [
    ["Region", "Q1", "Q2", "Q3", "Q4"],
    ["North", "12,480", "13,920", "15,310", "16,870"],
    ["South", "9,310", "9,875", "10,240", "11,605"],
    ["East", "14,050", "13,480", "14,920", "15,770"],
    ["West", "7,620", "8,940", "9,415", "10,380"],
    ["Online", "18,390", "21,045", "23,870", "26,210"],
    ["Total", "61,850", "67,260", "73,755", "80,835"],
  ];
  const widths = [56, 150, 132, 132, 132, 132];
  const cell = (content, column, row) => {
    const header = row === 0 || column === 0;
    const selected = column === 4 && row >= 2 && row <= 6;
    const style = [
      `width:${widths[column]}px`,
      "height:52px",
      `border-right:1px solid ${line}`,
      `border-bottom:1px solid ${line}`,
      "display:flex;align-items:center",
      column === 0 || row === 0 ? "justify-content:center" : column === 1 ? "padding-left:16px" : "justify-content:flex-end;padding-right:16px",
      header ? "background:#F5F5F7;color:#686D76;font-size:18px;font-weight:600" : "",
      row === 1 && column > 0 ? "font-weight:700;color:" + ink : "",
      row === 7 && column > 0 ? `font-weight:700;background:${color}14` : "",
      selected ? `background:${color}1F` : "",
      column > 1 && row > 0 ? "font-family:'Geist Mono';font-feature-settings:'tnum'" : "",
    ].join(";");
    return `<div style="${style}">${content}</div>`;
  };
  const grid = [columns.map((label, column) => cell(label, column, 0)).join("")];
  rows.forEach((values, index) => {
    grid.push(cell(String(index + 1), 0, index + 1) + values.map((value, column) => cell(value, column + 1, index + 1)).join(""));
  });
  const bars = [15310, 10240, 14920, 9415, 23870].map((value) =>
    `<i style="display:block;width:34px;height:${Math.round(value / 23870 * 118)}px;border-radius:5px 5px 0 0;background:${color}"></i>`).join("");
  return `
    <div class="card" style="left:560px;top:96px;width:740px;height:600px;font-size:21px;color:${ink2}">
      <div style="display:flex;align-items:center;gap:18px;height:62px;padding:0 20px;border-bottom:1px solid ${line2};font-family:'Geist Mono';font-size:21px">
        <b style="color:${color};font-style:italic;font-family:serif;font-size:24px">fx</b>
        <span style="color:${ink}">=SUM(D2:D6)</span>
      </div>
      ${grid.map((row) => `<div style="display:flex">${row}</div>`).join("")}
      <div style="position:absolute;left:${widths.slice(0, 4).reduce((a, b) => a + b, 0) - 1}px;top:${62 + 52 * 2 - 1}px;width:${widths[4] + 1}px;height:${52 * 5 + 1}px;border:3px solid ${color};box-sizing:border-box;border-radius:2px"></div>
    </div>
    <div class="card" style="left:470px;top:470px;width:250px;height:178px;padding:22px 24px 0;box-sizing:border-box">
      <div style="font-size:17px;font-weight:700;color:${ink};margin-bottom:12px">Q3 by region</div>
      <div style="display:flex;align-items:flex-end;gap:12px;height:118px;border-bottom:2px solid ${line2}">${bars}</div>
    </div>`;
}

function docArt(color) {
  const paragraph = (widths) => widths.map((width) => `<div style="margin-top:16px">${bar(width)}</div>`).join("");
  return `
    <div class="card" style="left:600px;top:96px;width:560px;height:600px;padding:56px 60px;box-sizing:border-box">
      ${bar(330, ink, 26)}
      <div style="margin-top:18px">${bar(210, "rgba(12,14,22,.28)", 14)}</div>
      <div style="margin-top:28px">${paragraph([440, 420, 436, 300])}</div>
      <div style="margin-top:30px;padding:14px 0 14px 20px;border-left:5px solid ${color};background:${color}12">
        ${bar(360, `${color}88`)}<div style="margin-top:16px">${bar(250, `${color}88`)}</div>
      </div>
      <div style="margin-top:22px">${paragraph([440, 410, 330])}</div>
    </div>`;
}

function slideArt(color) {
  const bars = [96, 150, 124, 196, 232].map((height, index) =>
    `<i style="display:block;width:52px;height:${height}px;border-radius:6px 6px 0 0;background:${index === 4 ? color : `${color}55`}"></i>`).join("");
  const thumb = (left, active) =>
    `<div class="card" style="left:${left}px;top:500px;width:176px;height:99px;padding:16px 18px;box-sizing:border-box;${active ? `outline:3px solid ${color};outline-offset:3px` : ""}">${bar(90, "rgba(12,14,22,.5)", 9)}<div style="margin-top:10px">${bar(60)}</div></div>`;
  return `
    <div class="card" style="left:540px;top:96px;width:620px;height:349px;padding:40px 44px;box-sizing:border-box">
      ${bar(300, ink, 24)}
      <div style="margin-top:14px">${bar(190, "rgba(12,14,22,.25)", 12)}</div>
      <div style="position:absolute;right:48px;bottom:40px;display:flex;align-items:flex-end;gap:16px;height:232px">${bars}</div>
      <div style="position:absolute;left:44px;bottom:48px">${bar(150)}<div style="margin-top:14px">${bar(120)}</div><div style="margin-top:14px">${bar(136)}</div></div>
    </div>
    ${thumb(540, true)}${thumb(762, false)}${thumb(984, false)}`;
}

function pageArt(color) {
  const kpi = (label, value, delta) => `
    <div style="flex:1;border:1px solid ${line2};border-radius:12px;padding:16px 18px">
      <div style="font-size:15px;font-weight:600;color:#686D76">${label}</div>
      <div style="margin-top:6px;font-family:'Geist Mono';font-size:30px;font-weight:600;color:${ink}">${value}</div>
      <div style="margin-top:4px;font-family:'Geist Mono';font-size:15px;color:#15803D">${delta}</div>
    </div>`;
  const points = [[0, 150], [70, 128], [140, 136], [210, 104], [280, 112], [350, 76], [420, 84], [490, 40], [560, 28]];
  const path = points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
  return `
    <div class="card" style="left:560px;top:96px;width:640px;height:600px">
      <div style="display:flex;align-items:center;gap:10px;height:56px;padding:0 20px;border-bottom:1px solid ${line2};background:#F5F5F7">
        <i style="width:13px;height:13px;border-radius:50%;background:rgba(12,14,22,.16)"></i>
        <i style="width:13px;height:13px;border-radius:50%;background:rgba(12,14,22,.16)"></i>
        <i style="width:13px;height:13px;border-radius:50%;background:rgba(12,14,22,.16)"></i>
        <div style="margin-left:14px;flex:1;height:30px;border-radius:15px;background:#fff;border:1px solid ${line}"></div>
      </div>
      <div style="padding:26px 30px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          ${bar(240, ink, 22)}
          <span style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:${color}1A;color:${color};font-size:16px;font-weight:700;letter-spacing:.06em"><i style="width:10px;height:10px;border-radius:50%;background:${color}"></i>LIVE</span>
        </div>
        <div style="display:flex;gap:16px;margin-top:26px">${kpi("Revenue", "80.8k", "+9.6%")}${kpi("Orders", "3,214", "+4.1%")}${kpi("Margin", "38%", "+1.2")}</div>
        <svg width="580" height="190" viewBox="-10 0 580 190" style="margin-top:22px;display:block">
          <path d="${path} L560 190 L0 190 Z" fill="${color}" fill-opacity=".12"/>
          <path d="${path}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="560" cy="28" r="9" fill="#fff" stroke="${color}" stroke-width="5"/>
        </svg>
      </div>
    </div>`;
}

function folderArt(color) {
  const file = (left, top, rotate, tint, glyph) => `
    <div class="card" style="left:${left}px;top:${top}px;width:170px;height:210px;transform:rotate(${rotate}deg);display:flex;align-items:flex-start;padding:22px;box-sizing:border-box">
      <span class="tile" style="width:56px;height:56px;border-radius:14px;background:${tint}"><svg viewBox="0 0 24 24" width="32" height="32">${glyphs[glyph]}</svg></span>
    </div>`;
  return `
    ${file(650, 150, -8, "#16A34A", "sheet")}${file(820, 120, 2, "#0284C7", "doc")}${file(985, 160, 9, "#EA580C", "slide")}
    <svg viewBox="0 0 560 400" width="600" height="428" style="position:absolute;left:600px;top:290px">
      <path d="M0 40a30 30 0 0 1 30-30h150a30 30 0 0 1 24 12l26 32h300a30 30 0 0 1 30 30v290a30 30 0 0 1-30 30H30a30 30 0 0 1-30-30z" fill="${color}"/>
      <path d="M0 110a24 24 0 0 1 24-24h512a24 24 0 0 1 24 24v260a30 30 0 0 1-30 30H30a30 30 0 0 1-30-30z" fill="#7A7F87"/>
    </svg>`;
}

function fileArt(color) {
  return `
    <svg viewBox="0 0 400 500" width="420" height="525" style="position:absolute;left:680px;top:110px">
      <path d="M24 2h256l118 118v356a22 22 0 0 1-22 22H24A22 22 0 0 1 2 476V24A22 22 0 0 1 24 2z" fill="#fff" stroke="rgba(12,14,22,.16)" stroke-width="3"/>
      <path d="M280 2v96a22 22 0 0 0 22 22h96" fill="#F5F5F7" stroke="rgba(12,14,22,.16)" stroke-width="3"/>
      ${[190, 240, 290, 340, 390].map((y, index) => `<rect x="52" y="${y}" width="${[296, 260, 296, 220, 250][index]}" height="18" rx="9" fill="${index ? "rgba(12,14,22,.12)" : color}"/>`).join("")}
    </svg>`;
}

const kinds = [
  { id: "sheet", label: "Sheet", tagline: "A live spreadsheet you can open in your browser.", color: "#16A34A", art: sheetArt },
  { id: "doc", label: "Doc", tagline: "A shared document you can open in your browser.", color: "#0284C7", art: docArt },
  { id: "slide", label: "Slides", tagline: "A shared deck you can open in your browser.", color: "#EA580C", art: slideArt },
  { id: "page", label: "Live page", tagline: "A data page that stays in sync with its Sheet.", color: "#7C3AED", art: pageArt },
  { id: "folder", label: "Folder", tagline: "Shared sheets, docs and slides in one place.", color: "#5E636B", art: folderArt },
  { id: "file", label: "File", tagline: "A shared file you can open in your browser.", color: "#686D76", art: fileArt },
];

function html(kind) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: "Plus Jakarta Sans"; src: url("${sans}") format("woff2"); font-weight: 200 800; }
    @font-face { font-family: "Geist Mono"; src: url("${mono}") format("woff2"); font-weight: 100 900; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { position: relative; font-family: "Plus Jakarta Sans", sans-serif; color: ${ink}; background: color-mix(in srgb, ${kind.color} 7%, #fff); }
    .card { position: absolute; overflow: hidden; background: #fff; border: 1px solid ${line2}; border-radius: 16px; box-shadow: 0 18px 40px rgba(15,18,30,.10), 0 2px 6px rgba(15,18,30,.05); }
    .tile { display: flex; align-items: center; justify-content: center; }
    .tile svg { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  </style></head><body>
    ${kind.art(kind.color)}
    <div style="position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px;font-size:32px;font-weight:700;letter-spacing:-.02em">${mark}Univer Workspace</div>
    <div style="position:absolute;left:72px;top:212px;width:430px">
      <span class="tile" style="width:96px;height:96px;border-radius:24px;background:${kind.color}"><svg viewBox="0 0 24 24" width="56" height="56">${glyphs[kind.id]}</svg></span>
      <div style="margin-top:26px;font-size:92px;font-weight:800;letter-spacing:-.035em;line-height:1">${kind.label}</div>
      <div style="margin-top:20px;font-size:30px;font-weight:500;line-height:1.3;color:${ink2}">${kind.tagline}</div>
    </div>
  </body></html>`;
}

mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "link-preview-"));
try {
  for (const kind of kinds) {
    const page = join(scratch, `${kind.id}.html`);
    const raw = join(scratch, `${kind.id}.png`);
    const target = join(output, `${kind.id}.png`);
    writeFileSync(page, html(kind));
    execFileSync(chrome, [
      "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      "--allow-file-access-from-files", "--virtual-time-budget=2000",
      "--window-size=1200,630", `--screenshot=${raw}`, `file://${page}`,
    ], { stdio: "ignore" });
    execFileSync("magick", [raw, "-strip", "-colors", "256", "-define", "png:compression-level=9", `PNG8:${target}`]);
    console.log(`${target} ${Math.round(statSync(target).size / 1024)} KB`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
