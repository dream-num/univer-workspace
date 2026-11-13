const ws = workbook.getSheetByName("Ledger");
const [header, ...rows] = ws.getRange("A1:J30001").getValues();
return header.map((name, c) => {
  const col = rows.map((r) => r[c]);
  const nums = col.filter((x) => typeof x === "number");
  const distinct = new Set(col);
  return { name, distinct: distinct.size, sample: [...distinct].slice(0, 5), min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null };
});
