import { useEffect, useMemo, useState } from "react";
import { fileToDataUrl, overrideLocationAlert, submitShootLocationEvaluation, uploadShootLocationPhoto } from "../services/locationApi";
import type { EvaluationSubmitInput, SessionUser, ShootLocationDetail, ShootLocationIntelligence } from "../types";

type ContextInput = {
  shootId?: string | null;
  outlookEventId?: string | null;
  shootName?: string | null;
  shootDate?: string | null;
  photographerName?: string | null;
};

type Props = {
  token: string;
  currentUser: SessionUser;
  location: NonNullable<ShootLocationDetail | ShootLocationIntelligence["location"]>;
  context?: ContextInput;
  openAlertId?: string | null;
  onRefresh?: () => Promise<void> | void;
  compact?: boolean;
  canOverride?: boolean;
};

type ComposerMode = "none" | "evaluation" | "photo" | "override";
type EvaluationDraft = {
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: "Sports" | "Schools";
  on_time: "Yes" | "No";
  easy_access: "Yes" | "No";
  overall_rating: number;
  photos_uploaded: "Yes" | "No";
  late_details: string;
  access_details: string;
  notes: string;
  outreach_notes: string;
  recommendations: string;
  image_quality: string;
};

const defaultEvaluationState = {
  shoot_type: "Schools" as const,
  on_time: "Yes" as const,
  easy_access: "Yes" as const,
  overall_rating: 4,
  photos_uploaded: "Yes" as const,
  late_details: "",
  access_details: "",
  notes: "",
  outreach_notes: "",
  recommendations: "",
  image_quality: ""
};

export function LocationSubmissionActions({
  token,
  currentUser,
  location,
  context,
  openAlertId,
  onRefresh,
  compact = false,
  canOverride = false
}: Props) {
  const [mode, setMode] = useState<ComposerMode>("none");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationDraft>(() => ({
    shoot_name: context?.shootName ?? "",
    shoot_date: context?.shootDate ?? new Date().toISOString().slice(0, 10),
    photographer_name: context?.photographerName ?? currentUser.fullName,
    ...defaultEvaluationState
  }));

  useEffect(() => {
    setMode("none");
    setNotice("");
    setError("");
    setPhotoFile(null);
    setPhotoPreview("");
    setOverrideReason("");
    setEvaluation({
      shoot_name: context?.shootName ?? "",
      shoot_date: context?.shootDate ?? new Date().toISOString().slice(0, 10),
      photographer_name: context?.photographerName ?? currentUser.fullName,
      ...defaultEvaluationState
    });
  }, [
    context?.outlookEventId,
    context?.photographerName,
    context?.shootDate,
    context?.shootId,
    context?.shootName,
    currentUser.fullName,
    location.id
  ]);

  const canSubmit = useMemo(
    () => Boolean(location.id && evaluation.shoot_name && evaluation.shoot_date && evaluation.photographer_name),
    [evaluation.photographer_name, evaluation.shoot_date, evaluation.shoot_name, location.id]
  );

  async function handleSubmitEvaluation() {
    if (!canSubmit) {
      setError("Add the shoot name, date, and photographer before sending the evaluation.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const payload: EvaluationSubmitInput = {
        location_id: location.id,
        shoot_id: context?.shootId ?? null,
        outlook_event_id: context?.outlookEventId ?? null,
        shoot_name: evaluation.shoot_name,
        shoot_date: evaluation.shoot_date,
        photographer_name: evaluation.photographer_name,
        shoot_type: evaluation.shoot_type,
        on_time: evaluation.on_time,
        easy_access: evaluation.easy_access,
        overall_rating: evaluation.overall_rating,
        photos_uploaded: evaluation.photos_uploaded,
        late_details: evaluation.late_details || null,
        access_details: evaluation.access_details || null,
        notes: evaluation.notes || null,
        outreach_notes: evaluation.outreach_notes || null,
        recommendations: evaluation.recommendations || null,
        image_quality: evaluation.image_quality || null
      };
      await submitShootLocationEvaluation(token, payload);
      setNotice("Post-shoot evaluation saved to Mission Control and queued through Monday.");
      setMode("none");
      if (onRefresh) {
        await onRefresh();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't save that post-shoot evaluation.");
    } finally {
      setWorking(false);
    }
  }

  async function handlePhotoSelection(file: File | null) {
    setPhotoFile(file);
    if (!file) {
      setPhotoPreview("");
      return;
    }
    try {
      setPhotoPreview(await fileToDataUrl(file));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "We couldn't preview that setup photo.");
    }
  }

  async function handleUploadPhoto() {
    if (!photoFile || !photoPreview) {
      setError("Choose a setup photo before uploading.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await uploadShootLocationPhoto(token, {
        location_id: location.id,
        shoot_id: context?.shootId ?? null,
        outlook_event_id: context?.outlookEventId ?? null,
        file_name: photoFile.name,
        content_type: photoFile.type || "image/jpeg",
        data_url: photoPreview
      });
      setNotice("Setup photo uploaded and attached to this location.");
      setMode("none");
      setPhotoFile(null);
      setPhotoPreview("");
      if (onRefresh) {
        await onRefresh();
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "We couldn't upload that setup photo.");
    } finally {
      setWorking(false);
    }
  }

  async function handleOverrideAlert() {
    if (!openAlertId || !overrideReason.trim()) {
      setError("Add the manager reason before clearing this missing-photo alert.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await overrideLocationAlert(token, openAlertId, overrideReason.trim());
      setNotice("Missing setup photo alert cleared with a manager override.");
      setMode("none");
      setOverrideReason("");
      if (onRefresh) {
        await onRefresh();
      }
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : "We couldn't clear that missing setup photo alert.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={`location-actions${compact ? " location-actions--compact" : ""}`}>
      <div className="location-actions__row">
        <button className="secondary-button" onClick={() => setMode(mode === "evaluation" ? "none" : "evaluation")}>
          {mode === "evaluation" ? "Close Evaluation" : "Add Evaluation"}
        </button>
        <button className="secondary-button" onClick={() => setMode(mode === "photo" ? "none" : "photo")}>
          {mode === "photo" ? "Close Upload" : "Upload Setup Photo"}
        </button>
        {canOverride && openAlertId ? (
          <button className="danger-button" onClick={() => setMode(mode === "override" ? "none" : "override")}>
            {mode === "override" ? "Close Override" : "Override Alert"}
          </button>
        ) : null}
      </div>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {mode === "evaluation" ? (
        <div className="location-form-shell">
          <div className="field-grid">
            <label className="filter-field">
              <span>Shoot Name</span>
              <input value={evaluation.shoot_name} onChange={(event) => setEvaluation((current) => ({ ...current, shoot_name: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Date</span>
              <input type="date" value={evaluation.shoot_date} onChange={(event) => setEvaluation((current) => ({ ...current, shoot_date: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Photographer</span>
              <input value={evaluation.photographer_name} onChange={(event) => setEvaluation((current) => ({ ...current, photographer_name: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Shoot Type</span>
              <select value={evaluation.shoot_type} onChange={(event) => setEvaluation((current) => ({ ...current, shoot_type: event.target.value as "Sports" | "Schools" }))}>
                <option value="Schools">Schools</option>
                <option value="Sports">Sports</option>
              </select>
            </label>
            <label className="filter-field">
              <span>On Time</span>
              <select value={evaluation.on_time} onChange={(event) => setEvaluation((current) => ({ ...current, on_time: event.target.value as "Yes" | "No" }))}>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Easy Access</span>
              <select value={evaluation.easy_access} onChange={(event) => setEvaluation((current) => ({ ...current, easy_access: event.target.value as "Yes" | "No" }))}>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Overall Rating</span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={evaluation.overall_rating}
                onChange={(event) => setEvaluation((current) => ({ ...current, overall_rating: Number(event.target.value) }))}
              />
              <div className="muted">Score: {evaluation.overall_rating}/5</div>
            </label>
            <label className="filter-field">
              <span>Photos Uploaded</span>
              <select value={evaluation.photos_uploaded} onChange={(event) => setEvaluation((current) => ({ ...current, photos_uploaded: event.target.value as "Yes" | "No" }))}>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Late Details</span>
              <textarea rows={2} value={evaluation.late_details} onChange={(event) => setEvaluation((current) => ({ ...current, late_details: event.target.value }))} />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Access Details</span>
              <textarea rows={2} value={evaluation.access_details} onChange={(event) => setEvaluation((current) => ({ ...current, access_details: event.target.value }))} />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Notes</span>
              <textarea rows={3} value={evaluation.notes} onChange={(event) => setEvaluation((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Outreach Notes</span>
              <textarea rows={2} value={evaluation.outreach_notes} onChange={(event) => setEvaluation((current) => ({ ...current, outreach_notes: event.target.value }))} />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Recommendations</span>
              <textarea rows={3} value={evaluation.recommendations} onChange={(event) => setEvaluation((current) => ({ ...current, recommendations: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Image Quality</span>
              <input value={evaluation.image_quality} onChange={(event) => setEvaluation((current) => ({ ...current, image_quality: event.target.value }))} placeholder="Strong, Mixed, Needs work" />
            </label>
          </div>
          <div className="location-actions__row">
            <button className="secondary-button" onClick={() => setMode("none")}>
              Cancel
            </button>
            <button className="primary-button" disabled={working || !canSubmit} onClick={() => void handleSubmitEvaluation()}>
              {working ? "Saving..." : "Submit Evaluation"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "photo" ? (
        <div className="location-form-shell">
          <label className="filter-field filter-field--wide">
            <span>Setup Photo</span>
            <input type="file" accept="image/*" capture="environment" onChange={(event) => void handlePhotoSelection(event.target.files?.[0] ?? null)} />
          </label>
          {photoPreview ? (
            <div className="location-upload-preview">
              <img src={photoPreview} alt="Setup photo preview" />
            </div>
          ) : null}
          <div className="location-actions__row">
            <button className="secondary-button" onClick={() => setMode("none")}>
              Cancel
            </button>
            <button className="primary-button" disabled={working || !photoPreview} onClick={() => void handleUploadPhoto()}>
              {working ? "Uploading..." : "Upload Setup Photo"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "override" ? (
        <div className="location-form-shell">
          <label className="filter-field filter-field--wide">
            <span>Manager Override Reason</span>
            <textarea rows={3} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain why this shoot should be cleared without a setup photo upload." />
          </label>
          <div className="location-actions__row">
            <button className="secondary-button" onClick={() => setMode("none")}>
              Cancel
            </button>
            <button className="danger-button" disabled={working || !overrideReason.trim()} onClick={() => void handleOverrideAlert()}>
              {working ? "Clearing..." : "Clear Alert"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
