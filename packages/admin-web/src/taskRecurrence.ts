export type TaskRecurrenceValue = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type TaskRecurrenceOption = {
  value: TaskRecurrenceValue;
  label: string;
  shortLabel: string;
};

export const TASK_RECURRENCE_OPTIONS: TaskRecurrenceOption[] = [
  { value: "none", label: "Does not repeat", shortLabel: "Does not repeat" },
  { value: "daily", label: "Every day", shortLabel: "Every day" },
  { value: "weekly", label: "Every week", shortLabel: "Every week" },
  { value: "monthly", label: "Every month", shortLabel: "Every month" },
  { value: "yearly", label: "Every year", shortLabel: "Every year" }
];

const RECURRENCE_LINE_PATTERN = /^\s*Repeat:\s*(Does not repeat|Every day|Every week|Every month|Every year)\s*$/gim;

function normalizeRecurrenceLabel(label: string) {
  return label.trim().toLowerCase();
}

function findRecurrenceOption(value: TaskRecurrenceValue) {
  return TASK_RECURRENCE_OPTIONS.find((option) => option.value === value) ?? TASK_RECURRENCE_OPTIONS[0];
}

export function getTaskRecurrenceLabel(value: TaskRecurrenceValue) {
  return findRecurrenceOption(value).label;
}

export function extractTaskRecurrence(description: string | null | undefined): TaskRecurrenceValue {
  if (!description) {
    return "none";
  }
  RECURRENCE_LINE_PATTERN.lastIndex = 0;
  const match = RECURRENCE_LINE_PATTERN.exec(description);
  if (!match?.[1]) {
    return "none";
  }
  const normalized = normalizeRecurrenceLabel(match[1]);
  return TASK_RECURRENCE_OPTIONS.find((option) => normalizeRecurrenceLabel(option.label) === normalized)?.value ?? "none";
}

export function stripTaskRecurrenceLine(description: string | null | undefined) {
  RECURRENCE_LINE_PATTERN.lastIndex = 0;
  const stripped = (description ?? "")
    .replace(RECURRENCE_LINE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  RECURRENCE_LINE_PATTERN.lastIndex = 0;
  return stripped;
}

export function buildTaskDescriptionWithRecurrence(description: string, recurrence: TaskRecurrenceValue) {
  const baseDescription = stripTaskRecurrenceLine(description);
  if (recurrence === "none") {
    return baseDescription || null;
  }
  const repeatLine = `Repeat: ${getTaskRecurrenceLabel(recurrence)}`;
  return baseDescription ? `${baseDescription}\n\n${repeatLine}` : repeatLine;
}
