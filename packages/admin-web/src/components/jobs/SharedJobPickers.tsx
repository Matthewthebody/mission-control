import { ContactLookupField, LocationLookupField, OrganizationLookupField } from "../jobIntake/JobIntakeFields";
import type { DirectoryOwnerOption, OrganizationContact, OrganizationLocation, OrganizationSummary } from "../../types";

type SharedPickerProps = {
  disabled?: boolean;
  required?: boolean;
  errors?: string[];
  helperText?: string;
};

type OrganizationPickerProps = SharedPickerProps & {
  departmentType: "schools" | "sports";
  label?: string;
  placeholder?: string;
  noMatchText?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  unresolvedValue: string;
  onUnresolvedChange: (value: string) => void;
  loading: boolean;
  results: OrganizationSummary[];
  selectedOrganization: OrganizationSummary | null;
  onSelectOrganization: (organization: OrganizationSummary) => void;
  collapseResults?: boolean;
  showUnresolvedField?: boolean;
  typeaheadOnly?: boolean;
};

type LocationPickerProps = SharedPickerProps & {
  label: string;
  placeholder?: string;
  noMatchText?: string;
  unresolvedLabel?: string;
  unresolvedPlaceholder?: string;
  showUnresolvedField?: boolean;
  noSingleLocationLabel?: string;
  onNoSingleLocation?: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  unresolvedValue: string;
  onUnresolvedChange: (value: string) => void;
  options: OrganizationLocation[];
  selectedLocationId: string;
  onSelectLocation: (value: string) => void;
};

type ContactPickerProps = SharedPickerProps & {
  label: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  unresolvedValue: string;
  onUnresolvedChange: (value: string) => void;
  options: OrganizationContact[];
  selectedContactId: string;
  onSelectContact: (value: string) => void;
};

type StaffPickerProps = SharedPickerProps & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: DirectoryOwnerOption[];
  emptyLabel?: string;
};

export function SharedOrganizationPicker(props: OrganizationPickerProps) {
  return (
    <OrganizationLookupField
      department={props.departmentType}
      label={props.label ?? "Organization"}
      placeholder={props.placeholder}
      noMatchText={props.noMatchText}
      searchValue={props.searchValue}
      onSearchChange={props.onSearchChange}
      unresolvedValue={props.unresolvedValue}
      onUnresolvedChange={props.onUnresolvedChange}
      loading={props.loading}
      results={props.results}
      selectedOrganization={props.selectedOrganization}
      onSelectOrganization={props.onSelectOrganization}
      disabled={props.disabled}
      required={props.required}
      helperText={props.helperText}
      errors={props.errors}
      collapseResults={props.collapseResults}
      showUnresolvedField={props.showUnresolvedField}
      typeaheadOnly={props.typeaheadOnly}
    />
  );
}

export function SharedLocationPicker(props: LocationPickerProps) {
  return (
    <LocationLookupField
      label={props.label}
      placeholder={props.placeholder}
      noMatchText={props.noMatchText}
      unresolvedLabel={props.unresolvedLabel}
      unresolvedPlaceholder={props.unresolvedPlaceholder}
      showUnresolvedField={props.showUnresolvedField}
      noSingleLocationLabel={props.noSingleLocationLabel}
      onNoSingleLocation={props.onNoSingleLocation}
      searchValue={props.searchValue}
      onSearchChange={props.onSearchChange}
      unresolvedValue={props.unresolvedValue}
      onUnresolvedChange={props.onUnresolvedChange}
      options={props.options}
      selectedLocationId={props.selectedLocationId}
      onSelectLocation={props.onSelectLocation}
      disabled={props.disabled}
      required={props.required}
      helperText={props.helperText}
      errors={props.errors}
    />
  );
}

export function SharedContactPicker(props: ContactPickerProps) {
  return (
    <ContactLookupField
      label={props.label}
      searchValue={props.searchValue}
      onSearchChange={props.onSearchChange}
      unresolvedValue={props.unresolvedValue}
      onUnresolvedChange={props.onUnresolvedChange}
      options={props.options}
      selectedContactId={props.selectedContactId}
      onSelectContact={props.onSelectContact}
      disabled={props.disabled}
      required={props.required}
      helperText={props.helperText}
      errors={props.errors}
    />
  );
}

export function SharedStaffPicker({ label, value, onChange, options, errors = [], disabled = false, required = false, emptyLabel = "Choose owner" }: StaffPickerProps) {
  return (
    <label className="filter-field">
      <span>
        {label}
        {required ? <span className="job-intake__required" aria-hidden="true">*</span> : null}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.user_id} value={option.user_id}>
            {option.full_name}
            {option.department ? ` | ${option.department}` : ""}
          </option>
        ))}
      </select>
      {errors.length ? <div className="shared-job-form__field-errors" role="alert">{errors.map((message) => <div key={`${label}-${message}`}>{message}</div>)}</div> : null}
    </label>
  );
}
