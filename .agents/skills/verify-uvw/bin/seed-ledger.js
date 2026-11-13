const START = Number("__START__"), COUNT = Number("__COUNT__");
const ws = workbook.getSheets()[0];
if (ws.getMaxRows() < START + COUNT) ws.setRowCount(START + COUNT);
if (START === 1) {
  ws.setName("Ledger");
  ws.getRange(0, 0, 1, 10).setValues([["Txn ID", "Date", "Region", "Account", "Category", "Qty", "Unit Price", "Amount", "Currency", "Status"]]);
  ws.setFrozenRows(1);
}
let seed = START * 7919;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rows = [];
for (let i = 0; i < COUNT; i++) {
  const r = START + i;
  const qty = 1 + Math.floor(rnd() * 40), price = Math.round((3 + rnd() * 117) * 100) / 100;
  rows.push([`T-${1000000 + r}`, 46023 + Math.floor(rnd() * 365), pick(["East", "West", "North", "South"]), pick(["4000-Sales", "4100-Services", "4200-Licenses", "5000-COGS"]),
    pick(["Hardware", "Software", "Support", "Training", "Shipping"]), qty, price, Math.round(qty * price * 100) / 100, pick(["USD", "CNY", "EUR"]), pick(["posted", "posted", "posted", "pending", "void"])]);
}
ws.getRange(START, 0, COUNT, 10).setValues(rows);
ws.getRange(START, 1, COUNT, 1).setNumberFormat("yyyy-mm-dd");
ws.getRange(START, 6, COUNT, 2).setNumberFormat("#,##0.00");
return { wrote: COUNT, last: START + COUNT };
