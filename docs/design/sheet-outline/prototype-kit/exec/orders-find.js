const values = workbook.getSheetByName("Orders").getRange("A1:J1001").getValues();
const hits = [];
values.forEach((row, r) => row.forEach((x, c) => { if (String(x).toLowerCase().includes("returned")) hits.push(String.fromCharCode(65 + c) + (r + 1)); }));
return { total: hits.length, first: hits.slice(0, 50) };
