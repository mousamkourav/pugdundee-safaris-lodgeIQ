f = "components/nav.ts"
t = open(f, encoding="utf-8").read()

# Every reporting item EXCEPT Trip reports gets a roles gate that excludes task_creator.
# We restrict them to the roles that already use reporting (everyone except task_creator).
REP = '["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"]'

repls = [
  ('{ label: "Dashboard", href: "/dashboard", icon: "grid" }',
   '{ label: "Dashboard", href: "/dashboard", icon: "grid", roles: ' + REP + ' }'),
  ('{ label: "Enter monthly report", href: "/monthly", icon: "clipboard" }',
   '{ label: "Enter monthly report", href: "/monthly", icon: "clipboard", roles: ' + REP + ' }'),
  ('{ label: "Monthly summary", href: "/reports", icon: "fileText" }',
   '{ label: "Monthly summary", href: "/reports", icon: "fileText", roles: ' + REP + ' }'),
  ('{ label: "Detailed report", href: "/report-detail", icon: "fileSearch" }',
   '{ label: "Detailed report", href: "/report-detail", icon: "fileSearch", roles: ' + REP + ' }'),
  ('{ label: "Notifications", href: "/notifications", icon: "bell" }',
   '{ label: "Notifications", href: "/notifications", icon: "bell", roles: ' + REP + ' }'),
  ('{ label: "Assets & service log", href: "/assets", icon: "wrench" }',
   '{ label: "Assets & service log", href: "/assets", icon: "wrench", roles: ' + REP + ' }'),
  ('{ label: "Insurances & licences", href: "/compliance", icon: "shield" }',
   '{ label: "Insurances & licences", href: "/compliance", icon: "shield", roles: ' + REP + ' }'),
]
done = []
for old, new in repls:
    if old in t:
        t = t.replace(old, new, 1); done.append(old.split('"')[1])
open(f, "w", encoding="utf-8").write(t)
print("gated items:", done)
print("trip reports still open:", '{ label: "Trip reports", href: "/trip-reports", icon: "route" }' in t)
