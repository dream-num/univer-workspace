#!/usr/bin/env node
// Prints the JSON input of one renderer operation over a small built-in unit with Latin and Chinese text.
// Usage: renderer-proof.mjs screenshot|printPdf|measureText | verify-uvw renderer-call <label> <op>
const latin = 'Hello Univer';
const chinese = '你好，世界';

const sheet = {
  unitType: 'sheet',
  unitData: {
    id: 'renderer-proof-sheet', name: 'Renderer proof', appVersion: '3.0.0-alpha', locale: 'zhCN', styles: {}, sheetOrder: ['s1'],
    sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 8, columnCount: 4, defaultColumnWidth: 160, defaultRowHeight: 28,
      cellData: { 0: { 0: { v: latin, t: 1 }, 1: { v: chinese, t: 1 } }, 1: { 0: { v: 'Latin 123', t: 1 }, 1: { v: '中文 混排 abc', t: 1 } } } } },
  },
};

const text = `${latin}\r${chinese}`;
const doc = {
  id: 'renderer-proof-doc',
  documentStyle: { pageSize: { width: 595, height: 842 }, marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72 },
  body: {
    dataStream: `${text}\r\n`,
    paragraphs: [{ startIndex: latin.length }, { startIndex: text.length }],
    sectionBreaks: [{ startIndex: text.length + 1 }],
    textRuns: [{ st: 0, ed: text.length, ts: { fs: 24 } }],
  },
};

const inputs = {
  screenshot: sheet,
  printPdf: { unitType: 'doc', unitData: doc },
  measureText: { doc: { ...doc, documentStyle: { marginBottom: 0, marginLeft: 0, marginRight: 0, marginTop: 0, pageSize: { height: 1000000, width: 1000000 } } } },
};
const input = inputs[process.argv[2]];
if (!input) {
  console.error('Usage: renderer-proof.mjs screenshot|printPdf|measureText');
  process.exit(2);
}
console.log(JSON.stringify(input));
