// Production turnaround / deadline estimates for Job Intake.
//
// Deadlines are estimated in business days (weekends skipped). Holidays are
// intentionally ignored until the app has a shared holiday calendar — the
// estimate is a helpful default that stays fully editable, never a hard rule.

export function addBusinessDays(isoDate: string, businessDays: number): string {
  if (!isoDate || !Number.isFinite(businessDays) || businessDays <= 0) {
    return "";
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }
  const cursor = new Date(year, month - 1, day);
  let added = 0;
  while (added < businessDays) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) {
      added += 1;
    }
  }
  const yyyy = cursor.getFullYear();
  const mm = String(cursor.getMonth() + 1).padStart(2, "0");
  const dd = String(cursor.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function yearFromIsoDate(isoDate: string): string {
  const [year] = (isoDate || "").split("-");
  return year && /^\d{4}$/.test(year) ? year : "";
}
