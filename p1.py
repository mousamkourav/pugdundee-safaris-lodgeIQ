f = "lib/auth.ts"
t = open(f, encoding="utf-8").read()
t = t.replace('  | "sales_member";', '  | "sales_member"\n  | "task_creator";')
t = t.replace('  sales_member: "Sales member",\n};', '  sales_member: "Sales member",\n  task_creator: "Task creator",\n};')
t = t.replace('export const isSalesOnly = (role?: string | null) => role === "sales_member";',
              'export const isSalesOnly = (role?: string | null) => role === "sales_member";\nexport const isTaskCreatorOnly = (role?: string | null) => role === "task_creator";')
open(f, "w", encoding="utf-8").write(t)
print("ok1:", "task_creator" in t)
