import type { DirectoryOwnerOption } from "../../types";
import type { SharedJobFormDayState } from "./DepartmentJobAdapterUIRegistry";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";

type Props = {
  days: SharedJobFormDayState[];
  onChange: (days: SharedJobFormDayState[]) => void;
  ownerOptions: DirectoryOwnerOption[];
  disabled?: boolean;
  errors?: string[];
};

function createBlankDay(timezone: string) {
  return {
    day_label: "",
    date: "",
    start_time: "",
    end_time: "",
    timezone,
    location_id: "",
    onsite_contact_id: "",
    lead_user_id: "",
    weather_sensitive: false,
    indoor_outdoor: "",
    access_notes: "",
    parking_notes: "",
    setup_notes: "",
    travel_notes: ""
  };
}

export function JobDayManager({ days, onChange, ownerOptions, disabled = false, errors = [] }: Props) {
  function updateDay(index: number, next: Partial<SharedJobFormDayState>) {
    onChange(days.map((day, dayIndex) => (dayIndex === index ? { ...day, ...next } : day)));
  }

  function addDay() {
    onChange([...days, createBlankDay(days[0]?.timezone || "America/Chicago")]);
  }

  function duplicateDay(index: number) {
    const source = days[index];
    if (!source) {
      return;
    }
    onChange([...days.slice(0, index + 1), { ...source, day_label: source.day_label ? `${source.day_label} Copy` : "Copy" }, ...days.slice(index + 1)]);
  }

  function removeDay(index: number) {
    if (days.length === 1) {
      onChange([createBlankDay(days[0]?.timezone || "America/Chicago")]);
      return;
    }
    onChange(days.filter((_, dayIndex) => dayIndex !== index));
  }

  return (
    <div className="shared-job-day-manager">
      {errors.length ? <div className="shared-job-form__field-errors" role="alert">{errors.map((message) => <div key={message}>{message}</div>)}</div> : null}
      <div className="shared-job-day-manager__list">
        {days.map((day, index) => (
          <section key={`${day.date}-${index}`} className="panel shared-job-day-manager__card">
            <div className="shared-job-day-manager__card-header">
              <strong>{day.day_label || `Day ${index + 1}`}</strong>
              <WorkspaceActionBar align="end" compact>
                <button type="button" className="secondary-button" onClick={() => duplicateDay(index)} disabled={disabled}>Duplicate</button>
                <button type="button" className="secondary-button" onClick={() => removeDay(index)} disabled={disabled}>Remove</button>
              </WorkspaceActionBar>
            </div>
            <div className="field-grid shared-job-form__grid">
              <label className="filter-field">
                <span>Label</span>
                <input value={day.day_label} onChange={(event) => updateDay(index, { day_label: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Date</span>
                <input type="date" value={day.date} onChange={(event) => updateDay(index, { date: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Start</span>
                <input type="time" value={day.start_time} onChange={(event) => updateDay(index, { start_time: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>End</span>
                <input type="time" value={day.end_time} onChange={(event) => updateDay(index, { end_time: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Timezone</span>
                <input value={day.timezone} onChange={(event) => updateDay(index, { timezone: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Lead</span>
                <select value={day.lead_user_id} onChange={(event) => updateDay(index, { lead_user_id: event.target.value })} disabled={disabled}>
                  <option value="">Unassigned</option>
                  {ownerOptions.map((option) => (
                    <option key={option.user_id} value={option.user_id}>
                      {option.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Location ID</span>
                <input value={day.location_id} onChange={(event) => updateDay(index, { location_id: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Onsite contact ID</span>
                <input value={day.onsite_contact_id} onChange={(event) => updateDay(index, { onsite_contact_id: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field">
                <span>Indoor / outdoor</span>
                <input value={day.indoor_outdoor} onChange={(event) => updateDay(index, { indoor_outdoor: event.target.value })} disabled={disabled} />
              </label>
              <label className="shared-job-form__toggle">
                <input type="checkbox" checked={day.weather_sensitive} onChange={(event) => updateDay(index, { weather_sensitive: event.target.checked })} disabled={disabled} />
                <span>Weather sensitive</span>
              </label>
              <label className="filter-field filter-field--wide">
                <span>Access notes</span>
                <textarea rows={2} value={day.access_notes} onChange={(event) => updateDay(index, { access_notes: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field filter-field--wide">
                <span>Parking notes</span>
                <textarea rows={2} value={day.parking_notes} onChange={(event) => updateDay(index, { parking_notes: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field filter-field--wide">
                <span>Setup notes</span>
                <textarea rows={2} value={day.setup_notes} onChange={(event) => updateDay(index, { setup_notes: event.target.value })} disabled={disabled} />
              </label>
              <label className="filter-field filter-field--wide">
                <span>Travel notes</span>
                <textarea rows={2} value={day.travel_notes} onChange={(event) => updateDay(index, { travel_notes: event.target.value })} disabled={disabled} />
              </label>
            </div>
          </section>
        ))}
      </div>
      <WorkspaceActionBar align="start">
        <button type="button" className="secondary-button" onClick={addDay} disabled={disabled}>
          Add day
        </button>
      </WorkspaceActionBar>
    </div>
  );
}
