f = "lib/monthly.ts"
t = open(f, encoding="utf-8").read()
# Relabel the comp liquor total to "Total complimentary amount (auto)"
t = t.replace('C("comp_liquor_total", "Total complimentary value (auto)", "money")',
              'C("comp_liquor_total", "Total complimentary amount (auto)", "money")')
open(f, "w", encoding="utf-8").write(t)
print("label:", "Total complimentary amount" in t)
