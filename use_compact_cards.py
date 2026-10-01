# Replace the big task-card grid with compact TaskCard components + popup.
f = r"app/(dashboard)/trip-reports/page.tsx"
t = open(f, encoding="utf-8").read()

# 1. import TaskCard
if 'from "./task-card"' not in t:
    t = t.replace(
        'import { ReviewButtons } from "./review-buttons";',
        'import { ReviewButtons } from "./review-buttons";\nimport { TaskCard } from "./task-card";'
    )

# 2. Replace the whole task grid block. Anchor: from the grid open to its close.
start_marker = '        <div className="grid gap-5 lg:grid-cols-2">'
end_marker = '''              </article>
            );
          })}
        </div>
      )}'''

si = t.find(start_marker)
ei = t.find(end_marker)
if si == -1 or ei == -1:
    print("ANCHOR NOT FOUND", si, ei)
else:
    ei_end = ei + len(end_marker)
    replacement = '''        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const refUrls = photoList(t.assigned_photos).map((p) => photoUrl(s, p));
            const doneUrls = photoList(t.completion_photos).map((p) => photoUrl(s, p));
            return (
              <TaskCard
                key={t.id}
                task={t}
                refUrls={refUrls}
                doneUrls={doneUrls}
                assignedByName={who(t.created_by)}
                submittedByName={who(t.submitted_by)}
                resolvedByName={who(t.resolved_by)}
                canSubmit={canSubmitTask(t)}
                canReview={canReviewTask(t, user.id)}
                canDelete={canDelete}
              />
            );
          })}
        </div>
      )}'''
    t = t[:si] + replacement + t[ei_end:]
    open(f, "w", encoding="utf-8").write(t)
    print("task grid replaced with compact cards")
    print("import ok:", 'from "./task-card"' in t)
    print("TaskCard used:", "<TaskCard" in t)
