import random, sys, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.formatting.rule import CellIsRule
from openpyxl.worksheet.datavalidation import DataValidation

def build(path, rows):
    rnd = random.Random(7)
    wb = Workbook()
    inp = wb.active; inp.title = "Inputs"
    inp["A1"] = "Assumptions"; inp["A1"].font = Font(bold=True, size=14)
    for i, (k, v, fmt) in enumerate([("Tax rate", 0.08, "0.0%"), ("FX USD/CNY", 7.12, "0.00"), ("Target margin", 0.35, "0%"), ("Fiscal year", 2026, "0")], start=3):
        inp.cell(i, 1, k); c = inp.cell(i, 2, v); c.number_format = fmt
    wb.defined_names["TaxRate"] = DefinedName("TaxRate", attr_text="Inputs!$B$3")

    o = wb.create_sheet("Orders")
    hdr = ["Order ID", "Date", "Region", "Rep", "Product", "Qty", "Unit Price", "Amount", "Tax", "Status"]
    o.append(hdr)
    for c in o[1]: c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="305496")
    regions = ["East", "West", "North", "South"]; reps = ["Ana", "Bo", "Chen", "Dee", "Eli", "Fay"]
    prods = ["Widget", "Gadget", "Gizmo", "Doohickey", "Sprocket"]; status = ["open", "shipped", "returned"]
    d0 = datetime.date(2026, 1, 1)
    for r in range(2, rows + 2):
        o.append([f"SO-{100000 + r}", d0 + datetime.timedelta(days=rnd.randrange(365)), rnd.choice(regions), rnd.choice(reps),
                  rnd.choice(prods), rnd.randint(1, 40), round(rnd.uniform(3, 120), 2), f"=F{r}*G{r}", f"=H{r}*TaxRate",
                  rnd.choices(status, [6, 12, 1])[0]])
        o.cell(r, 2).number_format = "yyyy-mm-dd"; o.cell(r, 7).number_format = "#,##0.00"
        o.cell(r, 8).number_format = "#,##0.00"; o.cell(r, 9).number_format = "#,##0.00"
    o.freeze_panes = "A2"
    t = Table(displayName="OrdersTbl", ref=f"A1:J{rows + 1}"); t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    o.add_table(t)
    o.conditional_formatting.add(f"H2:H{rows + 1}", CellIsRule(operator="greaterThan", formula=["3000"], fill=PatternFill("solid", fgColor="FFC7CE")))
    dv = DataValidation(type="list", formula1='"open,shipped,returned"'); o.add_data_validation(dv); dv.add(f"J2:J{rows + 1}")

    s = wb.create_sheet("Summary")
    s["A1"] = "Sales Summary 2026"; s["A1"].font = Font(bold=True, size=16); s.merge_cells("A1:F1")
    s["A1"].alignment = Alignment(horizontal="center")
    s["A3"] = "Region"
    for j, q in enumerate(["Q1", "Q2", "Q3", "Q4"], start=2): s.cell(3, j, q).font = Font(bold=True)
    s.cell(3, 6, "Total").font = Font(bold=True)
    for i, reg in enumerate(regions, start=4):
        s.cell(i, 1, reg)
        for j in range(4):
            lo = f"DATE(2026,{j*3+1},1)"; hi = f"DATE(2026,{j*3+4},1)" if j < 3 else "DATE(2027,1,1)"
            c = s.cell(i, j + 2, f'=SUMIFS(Orders!$H:$H,Orders!$C:$C,$A{i},Orders!$B:$B,">="&{lo},Orders!$B:$B,"<"&{hi})'); c.number_format = "#,##0"
        c = s.cell(i, 6, f"=SUM(B{i}:E{i})"); c.number_format = "#,##0"
    s.cell(8, 1, "Total").font = Font(bold=True)
    for j in range(2, 7):
        col = "ABCDEF"[j - 1]; c = s.cell(8, j, f"=SUM({col}4:{col}7)"); c.number_format = "#,##0"
    s["H3"] = "Orders"; s["I3"] = f"=COUNTA(Orders!A2:A{rows + 1})"
    s["H4"] = "Returned"; s["I4"] = f'=COUNTIF(Orders!J:J,"returned")'
    s["H5"] = "Avg order"; s["I5"] = "=AVERAGE(Orders!H:H)"; s["I5"].number_format = "#,##0.00"

    n = wb.create_sheet("Notes")
    n["A1"] = "Data is synthetic. Amount = Qty x Unit Price; Tax uses the TaxRate name on Inputs."
    n["A3"] = "Owner"; n["B3"] = "Finance team"; n["A4"] = "Refreshed"; n["B4"] = datetime.date(2026, 11, 1); n["B4"].number_format = "yyyy-mm-dd"
    wb.save(path)

build(sys.argv[1], int(sys.argv[2]))
