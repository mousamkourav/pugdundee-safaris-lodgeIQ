"use client";

import { DEPARTMENT_LABEL, TASK_DEPARTMENTS } from "@/lib/tasks";

// Department dropdown shared by the assign, add-to-trip and edit task forms.
// Controlled when `value` is passed; uncontrolled (form field) otherwise.
export function DepartmentSelect({
  value,
  onChange,
  name,
  defaultValue,
  disabled,
  className,
  id,
}: {
  value?: string;
  onChange?: (v: string) => void;
  name?: string;
  defaultValue?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
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
