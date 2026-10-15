f = "lib/tasks.ts"
t = open(f, encoding="utf-8").read()
t = t.replace(
  "export const canAssignTasks = (role?: string | null) => isSuperAdmin(role);",
  'export const canAssignTasks = (role?: string | null) =>\n  isSuperAdmin(role) || role === "task_creator";')
open(f, "w", encoding="utf-8").write(t)
print("ok2:", "task_creator" in t.split("canAssignTasks")[1][:90])
