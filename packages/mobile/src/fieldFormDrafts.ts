import { db } from "./db";

export type FieldFormDraftRow = {
  draft_key: string;
  form_kind: string;
  shift_id: string | null;
  payload: string;
  updated_at: string;
};

export function saveFieldFormDraft(input: {
  draftKey: string;
  formKind: string;
  shiftId?: string | null;
  payload: Record<string, unknown>;
}) {
  db.runSync(
    `
      INSERT OR REPLACE INTO field_form_draft (
        draft_key, form_kind, shift_id, payload, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [input.draftKey, input.formKind, input.shiftId ?? null, JSON.stringify(input.payload), new Date().toISOString()]
  );
}

export function loadFieldFormDraft(draftKey: string) {
  const row = db.getFirstSync("SELECT * FROM field_form_draft WHERE draft_key = ? LIMIT 1", [draftKey]) as FieldFormDraftRow | null;
  if (!row) {
    return null;
  }
  try {
    return {
      ...row,
      payload: JSON.parse(row.payload) as Record<string, unknown>
    };
  } catch {
    return null;
  }
}

export function deleteFieldFormDraft(draftKey: string) {
  db.runSync("DELETE FROM field_form_draft WHERE draft_key = ?", [draftKey]);
}
