"use client";

import { DEPARTMENT_LABEL, TASK_DEPARTMENTS, departmentLabel } from "@/lib/tasks";

// Department dropdown shared by the assign, add-to-trip and edit task forms.
// Controlled when `value` is passed; uncontrolled (form field) otherwise.
// With `locked` (see lockedDepartmentFor) it renders a fixed, read-only field
// instead of a dropdown; the server actions enforce the same lock.
export function DepartmentSelect({
  value,
  onChange,
  name,
  defaultValue,
  disabled,
  className,
  id,
  locked,
}: {
  value?: string;
  onChange?: (v: string) => void;
  name?: string;
  defaultValue?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  locked?: string | null;
}) {
  if (locked) {
    return (
      <>
        <div
          id={id}
          aria-readonly="true"
          className={(className ?? "") + " flex items-center justify-between gap-2 bg-sand-100"}
        >
          <span className="font-medium">{departmentLabel(locked) ?? locked}</span>
          <span className="text-xs text-sand-500">Fixed for your role</span>
        </div>
        {name && <input type="hidden" name={name} value={locked} />}
      </>
    );
  }
  return (
    <select
      id={id}
      name={name}
      required
      disabled={disabled}
      className={className}
      {...(value !== undefined
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : { defaultValue: defaultValue ?? "" })}
    >
      <option value="" disabled>
        Choose department
      </option>
      {TASK_DEPARTMENTS.map((d) => (
        <option key={d} value={d}>
          {DEPARTMENT_LABEL[d]}
        </option>
      ))}
    </select>
  );
}
