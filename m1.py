f = "lib/monthly.ts"
t = open(f, encoding="utf-8").read()

def rep(old, new, label):
    global t
    if old not in t:
        print("!! MISSING:", label); return
    t = t.replace(old, new, 1); print("ok:", label)

# --- 4. New joinee: Salary -> CTC, add Gross + In-hand ---
rep(
'          { key: "salary", label: "Salary", type: "number", unit: "money" },',
'          { key: "salary", label: "CTC", type: "number", unit: "money" },\n          { key: "gross", label: "Gross salary", type: "number", unit: "money" },\n          { key: "in_hand", label: "In-hand", type: "number", unit: "money" },',
"new joinee CTC/gross/in-hand")

# --- 2. Staff leave: add opening + closing (closing auto = opening + availed) ---
rep(
'          { key: "leaves", label: "No. of leaves", type: "number", unit: "count" },\n        ],\n      },',
'          { key: "leave_opening", label: "Leave opening", type: "number", unit: "count" },\n          { key: "leaves", label: "Leaves availed", type: "number", unit: "count" },\n          { key: "leave_closing", label: "Leave closing (auto)", type: "number", unit: "count", computed: true },\n        ],\n      },',
"staff leave opening/closing")

# --- 3. Comp liquor: Value -> Quantity, add Amount before Remark ---
rep(
'          { key: "value", label: "Value", type: "number", unit: "money" },\n          { key: "remark", label: "Remark", type: "text" },',
'          { key: "value", label: "Quantity", type: "number", unit: "count" },\n          { key: "amount", label: "Amount", type: "number", unit: "money" },\n          { key: "remark", label: "Remark", type: "text" },',
"comp liquor quantity+amount")

# --- 3b. Comp liquor total now sums AMOUNT ---
rep(
'''  const compLiquor = Array.isArray(data.comp_liquor)
    ? data.comp_liquor.reduce((acc: number, r: any) => acc + toNum(r?.value), 0)
    : 0;
  data.comp_liquor_total = compLiquor;''',
'''  const compLiquor = Array.isArray(data.comp_liquor)
    ? data.comp_liquor.reduce((acc: number, r: any) => acc + toNum(r?.amount), 0)
    : 0;
  data.comp_liquor_total = compLiquor;

  // Staff leave: closing = opening + leaves availed (per row, auto).
  if (Array.isArray(data.staff_leave)) {
    data.staff_leave = data.staff_leave.map((r: any) => {
      if (r == null) return r;
      return { ...r, leave_closing: round2(toNum(r?.leave_opening) + toNum(r?.leaves)) };
    });
  }''',
"comp total from amount + staff leave closing calc")

open(f, "w", encoding="utf-8").write(t)
print("done")
