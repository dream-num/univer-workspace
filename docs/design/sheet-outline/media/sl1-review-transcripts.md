# SL1 review transcripts

Head `582dc08e`, a disposable verify-uvw instance seeded with `seed-sheets.mjs`. IDs are shown as shell variables in commands and expanded in output.

## Lane 2. Outline and zoom

```console
$ uvw outline --unit $SALES --worktree $W
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
- workbook "sales.xlsx" [sheets=4]
  - sheet "Inputs" [ref=s1, used=A1:B6]
    - text "Assumptions" [ref=s1.x1, A1]
    - text "Tax rate" [ref=s1.x2, A3]
    - kpi "TaxRate" [ref=s1.k1, B3, percent 0.0%, via=name]: 8.0%
    - table [ref=s1.t1, A4:B6, rows=3, header=0r]
    - objects [name=1]
  - sheet "Orders" [ref=s2, used=A1:J1001, frozen=1r, formulas=2000]
    - table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, via=table]
    - objects [table=1, cf=1, dv=1]
  - sheet "Summary" [ref=s3, used=A1:I8, formulas=28]
    - text "Sales Summary 2026" [ref=s3.x1, A1:F1, span=A1:F1]
    - table [ref=s3.t1, A3:I8, rows=4, totals=8]
    - objects [merged=1]
  - sheet "Notes" [ref=s4, used=A1:B4]
    - text "Data is synthetic. Amount = Qty x Unit …" [ref=s4.x1, A1]
    - table [ref=s4.t1, A3:B4, rows=2, header=0r]
(exit 0)
```

```console
$ uvw outline --unit $SALES --worktree $W --at s2.t1
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
- table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, data=A2:J1001, header-range=A1:J1, header-source=table, via=table]
  - col "Order ID" [ref=s2.t1.c1, A, text unique, data=A2:A1001, header-range=A1, header-source=table]
  - col "Date" [ref=s2.t1.c2, B, date yyyy-mm-dd, 2026-01-01..2026-12-31, data=B2:B1001, header-range=B1, header-source=table]
  - col "Region" [ref=s2.t1.c3, C, text, 4 distinct: West|East|South|North, data=C2:C1001, header-range=C1, header-source=table]
  - col "Rep" [ref=s2.t1.c4, D, text, 6 distinct: Dee|Chen|Bo…, data=D2:D1001, header-range=D1, header-source=table]
  - col "Product" [ref=s2.t1.c5, E, text, 5 distinct: Gizmo|Gadget|Widget|Doohickey|Sprocket, data=E2:E1001, header-range=E1, header-source=table]
  - col "Qty" [ref=s2.t1.c6, F, number, 1..40, data=F2:F1001, header-range=F1, header-source=table]
  - col "Unit Price" [ref=s2.t1.c7, G, number #,##0.00, 3.02..119.99, data=G2:G1001, header-range=G1, header-source=table]
  - col "Amount" [ref=s2.t1.c8, H, number #,##0.00, 10.08..4,632.80, f=F{r}*G{r} ×1000, cf="cellIs gt 3000", data=H2:H1001, header-range=H1, header-source=table]
  - col "Tax" [ref=s2.t1.c9, I, number #,##0.00, 0.81..370.62, f=H{r}*TaxRate ×1000, data=I2:I1001, header-range=I1, header-source=table]
  - col "Status" [ref=s2.t1.c10, J, text, 3 distinct: shipped|open|returned, dv="list: open,shipped,returned", data=J2:J1001, header-range=J1, header-source=table]
  - obj table [ref=obj:table/uni2rId1, A1:J1001, OrdersTbl]
  - obj cf [ref=obj:cf/b64_WyJ1bmkyIiwicnVzdC1jZi0wIl0, H2:H1001, "cellIs gt 3000"]
  - obj dv [ref=obj:dv/b64_WyJ1bmkyIiwicnVzdC1kdi0wIl0, J2:J1001, "list: open,shipped,returned"]
(exit 0)
```

## Lane 3. Budget and continuation

```console
$ uvw outline --unit $SALES --worktree $W --at s2.t1 --budget 300
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
- table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, data=A2:J1001, header-range=A1:J1, header-source=table, via=table]
  - col "Order ID" [ref=s2.t1.c1, A, text unique, data=A2:A1001, header-range=A1, header-source=table]
  - … 9 more col [zoom=s2.t1, from=s2.t1.c2]
  - … 3 more obj [zoom=s2.t1, from=obj:table/uni2rId1]
… 9 more col: uvw outline --unit f1a4a9ee-c4c6-4963-a401-f255c437132d --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --at s2.t1 --from s2.t1.c2 --budget 300
(exit 0)
```

```console
$ uvw outline --unit $SALES --worktree $W --at s2.t1 --from s2.t1.c2 --budget 300
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
- table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, data=A2:J1001, header-range=A1:J1, header-source=table, via=table]
  - col "Date" [ref=s2.t1.c2, B, date yyyy-mm-dd, 2026-01-01..2026-12-31, data=B2:B1001, header-range=B1, header-source=table]
  - … 8 more col [zoom=s2.t1, from=s2.t1.c3]
  - … 3 more obj [zoom=s2.t1, from=obj:table/uni2rId1]
… 8 more col: uvw outline --unit f1a4a9ee-c4c6-4963-a401-f255c437132d --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --at s2.t1 --from s2.t1.c3 --budget 300
(exit 0)
```

## Lane 4. Paged read on the 30,000-row ledger

```console
$ uvw read 'Ledger!A1:J200' --max 100 --unit $L30 --worktree $W
unit ba210ae1-85a8-46ca-8fe4-769a70de155f [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=31]
read Ledger!A1:J10 [ref=s1, both]
row	A	B	C	D	E	F	G	H	I	J
1	"Txn ID"	"Date"	"Region"	"Account"	"Category"	"Qty"	"Unit Price"	"Amount"	"Currency"	"Status"
2	"T-1000001"	"2026-02-14"	"North"	"4000-Sales"	"Shipping"	"12"	"24.72"	"296.64"	"CNY"	"pending"
3	"T-1000002"	"2026-03-15"	"North"	"5000-COGS"	"Software"	"39"	"118.21"	"4,610.19"	"USD"	"posted"
4	"T-1000003"	"2026-12-17"	"East"	"4200-Licenses"	"Support"	"17"	"92.98"	"1,580.66"	"EUR"	"pending"
5	"T-1000004"	"2026-09-18"	"East"	"4200-Licenses"	"Hardware"	"21"	"18.78"	"394.38"	"CNY"	"posted"
6	"T-1000005"	"2026-03-28"	"East"	"4000-Sales"	"Support"	"13"	"102.97"	"1,338.61"	"EUR"	"posted"
7	"T-1000006"	"2026-09-21"	"North"	"5000-COGS"	"Shipping"	"37"	"25.38"	"939.06"	"CNY"	"posted"
8	"T-1000007"	"2026-03-08"	"South"	"4000-Sales"	"Training"	"17"	"96.93"	"1,647.81"	"EUR"	"void"
9	"T-1000008"	"2026-12-21"	"West"	"4000-Sales"	"Software"	"23"	"26.56"	"610.88"	"EUR"	"posted"
10	"T-1000009"	"2026-06-13"	"North"	"4000-Sales"	"Hardware"	"16"	"16.41"	"262.56"	"USD"	"posted"
… 190 more rows: uvw read --unit ba210ae1-85a8-46ca-8fe4-769a70de155f --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --max 100 -- Ledger!A11:J200
(exit 0)
```

```console
$ uvw read --unit $L30 --worktree $W --max 100 -- 'Ledger!A11:J200'
unit ba210ae1-85a8-46ca-8fe4-769a70de155f [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=31]
read Ledger!A11:J20 [ref=s1, both]
row	A	B	C	D	E	F	G	H	I	J
11	"T-1000010"	"2026-08-31"	"West"	"4200-Licenses"	"Support"	"27"	"78.66"	"2,123.82"	"EUR"	"posted"
12	"T-1000011"	"2026-02-16"	"South"	"4200-Licenses"	"Training"	"7"	"41.25"	"288.75"	"USD"	"posted"
13	"T-1000012"	"2026-12-08"	"South"	"4000-Sales"	"Software"	"24"	"98.51"	"2,364.24"	"EUR"	"void"
14	"T-1000013"	"2026-12-25"	"West"	"5000-COGS"	"Shipping"	"16"	"70.54"	"1,128.64"	"CNY"	"posted"
15	"T-1000014"	"2026-08-15"	"North"	"4100-Services"	"Software"	"26"	"45.66"	"1,187.16"	"USD"	"posted"
16	"T-1000015"	"2026-02-01"	"West"	"4100-Services"	"Hardware"	"21"	"112.80"	"2,368.80"	"CNY"	"posted"
17	"T-1000016"	"2026-10-04"	"East"	"5000-COGS"	"Shipping"	"15"	"42.43"	"636.45"	"USD"	"pending"
18	"T-1000017"	"2026-01-25"	"West"	"5000-COGS"	"Shipping"	"17"	"109.63"	"1,863.71"	"USD"	"posted"
19	"T-1000018"	"2026-12-03"	"South"	"5000-COGS"	"Support"	"39"	"110.41"	"4,305.99"	"CNY"	"posted"
20	"T-1000019"	"2026-03-23"	"East"	"5000-COGS"	"Training"	"31"	"58.42"	"1,811.02"	"EUR"	"posted"
… 180 more rows: uvw read --unit ba210ae1-85a8-46ca-8fe4-769a70de155f --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --max 100 -- Ledger!A21:J200
(exit 0)
```

## Lane 5. Typed values

```console
$ uvw read 'Summary!F4:F5' --json --unit $SALES --worktree $W
{
  "unitId": "f1a4a9ee-c4c6-4963-a401-f255c437132d",
  "scope": {
    "kind": "worktree",
    "worktreeId": "e3faf6e0-34dd-4899-8138-8ea57e168b45"
  },
  "revision": 1,
  "text": "read Summary!F4:F5 [ref=s3, both]\nrow\tF\n4\t{\"display\":\"302,100\",\"formula\":\"=SUM(B4:E4)\"}\n5\t{\"display\":\"335,182\",\"formula\":\"=SUM(B5:E5)\"}\n",
  "json": {
    "sheet": "Summary",
    "ref": "s3",
    "range": "F4:F5",
    "requested": "F4:F5",
    "content": "both",
    "rows": 2,
    "columns": 1,
    "empty": false,
    "cells": [
      {
        "ref": "F4",
        "type": "number",
        "display": "302,100",
        "value": 302100.28,
        "formula": "=SUM(B4:E4)"
      },
      {
        "ref": "F5",
        "type": "number",
        "display": "335,182",
        "value": 335182.47,
        "formula": "=SUM(B5:E5)"
      }
    ]
  },
  "warnings": []
}
(exit 0)
```

## Lane 6. Find

```console
$ uvw find returned --max 10 --unit $SALES --worktree $W
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
find "returned" [in=values, cells=61]
ref	display	formula	terms
Orders!J18	"returned"	""	["returned"]
Orders!J28	"returned"	""	["returned"]
Orders!J31	"returned"	""	["returned"]
Orders!J39	"returned"	""	["returned"]
Orders!J69	"returned"	""	["returned"]
Orders!J72	"returned"	""	["returned"]
Orders!J76	"returned"	""	["returned"]
Orders!J83	"returned"	""	["returned"]
Orders!J88	"returned"	""	["returned"]
Orders!J89	"returned"	""	["returned"]
… 51 more hits: uvw find --unit f1a4a9ee-c4c6-4963-a401-f255c437132d --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --from Orders!J107 --max 10 -- returned
(exit 0)
```

```console
$ uvw find SUMIFS --in formulas --max 5 --unit $SALES --worktree $W
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
find "SUMIFS" [in=formulas, cells=16]
ref	display	formula	terms
Summary!B4	"80,188"	"=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A4,Orders!$B:$B,\">=\"&DATE(2026,1,1),Orders!$B:$B,\"<\"&DATE(2026,4,1))"	["SUMIFS"]
Summary!C4	"90,607"	"=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A4,Orders!$B:$B,\">=\"&DATE(2026,4,1),Orders!$B:$B,\"<\"&DATE(2026,7,1))"	["SUMIFS"]
Summary!D4	"63,436"	"=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A4,Orders!$B:$B,\">=\"&DATE(2026,7,1),Orders!$B:$B,\"<\"&DATE(2026,10,1))"	["SUMIFS"]
Summary!E4	"67,870"	"=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A4,Orders!$B:$B,\">=\"&DATE(2026,10,1),Orders!$B:$B,\"<\"&DATE(2027,1,1))"	["SUMIFS"]
Summary!B5	"57,718"	"=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A5,Orders!$B:$B,\">=\"&DATE(2026,1,1),Orders!$B:$B,\"<\"&DATE(2026,4,1))"	["SUMIFS"]
… 11 more hits: uvw find --unit f1a4a9ee-c4c6-4963-a401-f255c437132d --worktree e3faf6e0-34dd-4899-8138-8ea57e168b45 --in formulas --from Summary!C5 --max 5 -- SUMIFS
(exit 0)
```

## Lane 7. Large sheet

```console
$ uvw outline --unit $L50 --worktree $W
unit a3be94b3-b651-4a58-9e2d-0ba4241e98ce [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=51]
- workbook "ledger50k" [sheets=1]
  - sheet "Ledger" [ref=s1, used=A1:J50001, frozen=1r]
    - block [ref=s1.b1, A1:J50001]
note: sheet s1 too large: rendered as one block; read it page by page with read, or locate cells with find
(exit 0)
```

## Lane 8. Revision

```console
$ uvw outline --unit $SALES --worktree $W --at s2.t1.c10
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=1]
- col "Status" [ref=s2.t1.c10, J, text, 3 distinct: shipped|open|returned, dv="list: open,shipped,returned", data=J2:J1001, header-range=J1, header-source=table]
(exit 0)
```

```console
$ uvw execute --worktree $W --unit $SALES -e 'workbook.getSheetByName("Orders").getRange("J2").setValue("disputed");'
null
committed revision 2 (committed)
(exit 0)
```

```console
$ uvw outline --unit $SALES --worktree $W --at s2.t1.c10
unit f1a4a9ee-c4c6-4963-a401-f255c437132d [worktree e3faf6e0-34dd-4899-8138-8ea57e168b45, rev=2]
- col "Status" [ref=s2.t1.c10, J, text, 4 distinct: shipped|open|returned|disputed, dv="list: open,shipped,returned", data=J2:J1001, header-range=J1, header-source=table]
(exit 0)
```

## Lane 9. Errors

```console
$ uvw outline --unit $DOC --worktree $W
workspace-sheet-lens-unit-type-unsupported: Sheet Lens does not support Unit type 'doc'; use inspect for this Unit
(exit 1)
```

```console
$ uvw outline --unit $SALES --worktree $W --at s9.t1
workspace-sheet-lens-ref-not-found: no region or sheet with ref 's9.t1' in this Unit
Hint: run outline on this Unit again to see its current refs; editing the Unit can renumber them
(exit 1)
```

```console
$ uvw read 'Nope!A1' --unit $SALES --worktree $W
workspace-sheet-lens-sheet-not-found: no sheet 'Nope' in this Unit (sheets: Inputs, Orders, Summary, Notes)
Hint: run outline on this Unit to list its sheet names
(exit 1)
```
