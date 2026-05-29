import type {
  ClientOperationsActivityLogRule,
  ClientOperationsCanonicalEntity,
  ClientOperationsConnectedSystemRule,
  ClientOperationsCoreContract,
  ClientOperationsDocumentMediaRule,
  ClientOperationsFutureProofingRule,
  ClientOperationsNamingRule,
  ClientOperationsPermissionStrategyRow,
  ClientOperationsRelationshipRule,
  ClientOperationsSearchRule,
  ClientOperationsWarningSurfaceRule
} from "../types/clientOperationsCore.js";

const CANONICAL_ENTITIES: ClientOperationsCanonicalEntity[] = [
  {
    entity: "Organization",
    canonical_owner: "Client Operations Core",
    description: "Primary client/account record used across scheduling, agreements, locations, contacts, and reporting.",
    source_of_truth_rule: "All client identity, canonical naming, account typing, and cross-module linkage anchor to Organization.",
    notes: "Use Organization as the canonical client record even if older tools call it account or client."
  },
  {
    entity: "Contact",
    canonical_owner: "Client Operations Core",
    description: "Named person record linked to an Organization for scheduling, agreements, and operational communication.",
    source_of_truth_rule: "Contact always belongs to one Organization, but may be referenced by many Shoots and Agreements.",
    notes: "Primary Contact and additional Contact relationships on Shoot should reuse canonical Contact records."
  },
  {
    entity: "Location",
    canonical_owner: "Client Operations Core",
    description: "Canonical place/building record linked to an Organization and reused by Shoots, resources, agreements, and readiness memory.",
    source_of_truth_rule: "Location always belongs to one Organization and should be selected, not retyped, during Shoot workflows whenever possible.",
    notes: "Recurring Location Intelligence should project from this canonical Location identity."
  },
  {
    entity: "Shoot",
    canonical_owner: "Operations Scheduling",
    description: "Operational job record tying organization, location, timing, staffing, contacts, readiness, agreements, labor, and gear usage together.",
    source_of_truth_rule: "Shoot belongs to one Organization and usually one primary Location, while linking to one primary Contact and zero-to-many additional Contacts.",
    notes: "Shoot is the central operational execution record but not the owner of Organization, Contact, or Location identity."
  },
  {
    entity: "Resource Library Item",
    canonical_owner: "Shared Resource Library",
    description: "Typed internal file/media/document record used for prep, reference, agreement storage, QR/job docs, and historical operational memory.",
    source_of_truth_rule: "Every Resource Library Item must have at least one explicit scope owner such as Organization, Location, Shoot, or Agreement.",
    notes: "Separate UI sections may exist, but one canonical resource model should back them."
  },
  {
    entity: "Agreement",
    canonical_owner: "Contracts & Agreements",
    description: "Structured agreement lifecycle record for storage, status, key dates, signers, countersigners, reminders, and final signed packages.",
    source_of_truth_rule: "Agreement belongs to an Organization and may also link to Contact, Location, and Shoot context through explicit links.",
    notes: "Agreement metadata stays canonical in Mission Control even when a provider handles signature delivery."
  },
  {
    entity: "Post-Shoot Evaluation",
    canonical_owner: "Shoot Closeout",
    description: "Mobile-first closeout record capturing what happened, what to remember, and whether follow-up or mileage conditions apply.",
    source_of_truth_rule: "Post-Shoot Evaluation belongs to one Shoot and links back to that Shoot's Organization and Location at submission time.",
    notes: "Standard users submit once; later analytics and recurring memory read from this record."
  },
  {
    entity: "Recurring Location Intelligence",
    canonical_owner: "Derived Operational Memory",
    description: "Structured derived memory for a Location built from historical Shoots, resources, evaluations, issues, and agreement context.",
    source_of_truth_rule: "Recurring Location Intelligence is a projection, not an independent manually typed source of truth.",
    notes: "It should be refreshable from canonical Location, Shoot, Resource Library Item, Post-Shoot Evaluation, and Agreement context."
  },
  {
    entity: "Time Session",
    canonical_owner: "Time Clock / Labor Tracking",
    description: "Employee workday/session container used for payroll-ready labor reconstruction.",
    source_of_truth_rule: "Time Session belongs to an employee and work date, not directly to a Shoot.",
    notes: "Shoot linkage should happen at Time Segment level."
  },
  {
    entity: "Time Segment",
    canonical_owner: "Time Clock / Labor Tracking",
    description: "Paid work-state slice such as Office/Drive or Photography within a Time Session.",
    source_of_truth_rule: "Time Segment may link to Shoot and Location when labor is attributable to operational work context.",
    notes: "This is the correct bridge from labor tracking back to the Client Operations Core."
  },
  {
    entity: "Asset",
    canonical_owner: "Gear / Equipment",
    description: "Individually tracked gear record with identity, custody, service history, and operational readiness state.",
    source_of_truth_rule: "Asset keeps its own identity even when assigned to a Kit, linked to a Shoot, or temporarily substituted.",
    notes: "Asset is never subsumed by Kit identity."
  },
  {
    entity: "Kit",
    canonical_owner: "Gear / Equipment",
    description: "Self-contained grouping of Assets used for standing assignment, temporary checkout, and Pre-Shoot Verification.",
    source_of_truth_rule: "Kit is a structured operational grouping that owns Kit Asset Membership, not the identity of the assets inside it.",
    notes: "A Kit should not silently share active Assets across multiple Kits."
  }
];

const RELATIONSHIP_RULES: ClientOperationsRelationshipRule[] = [
  {
    from_entity: "Organization",
    to_entity: "Contact",
    cardinality: "one-to-many",
    relationship_rule: "One Organization may have many Contacts; each Contact belongs to one Organization.",
    ownership_rule: "Organization owns Contact directory context; Contact does not outlive its Organization context without explicit migration.",
    notes: "Shoot and Agreement records should link to canonical Contact ids, not copy freeform contact data unless snapshotting is required."
  },
  {
    from_entity: "Organization",
    to_entity: "Location",
    cardinality: "one-to-many",
    relationship_rule: "One Organization may have many Locations; each Location belongs to one Organization.",
    ownership_rule: "Organization owns the canonical client/location relationship.",
    notes: "Location remains separately searchable and reusable across Shoots."
  },
  {
    from_entity: "Organization",
    to_entity: "Shoot",
    cardinality: "one-to-many",
    relationship_rule: "One Organization may have many Shoots; each Shoot belongs to one Organization.",
    ownership_rule: "Organization is the account anchor for Shoot pricing, agreements, history, and readiness context.",
    notes: "This is the primary client-facing operational lineage."
  },
  {
    from_entity: "Location",
    to_entity: "Shoot",
    cardinality: "one-to-many",
    relationship_rule: "One Location may host many Shoots; each Shoot usually has one primary Location.",
    ownership_rule: "Shoot references Location; Location is canonical and not duplicated into ad hoc place records.",
    notes: "Support nullable Location only when the job truly has no stable place record."
  },
  {
    from_entity: "Shoot",
    to_entity: "Contact",
    cardinality: "one-to-many reference set",
    relationship_rule: "Each Shoot must have exactly one primary Contact and may have zero-to-many additional Contacts.",
    ownership_rule: "Shoot references Contact; Contact remains canonical under Organization.",
    notes: "Primary Contact should be explicit and additional Contacts should reuse canonical Contact records."
  },
  {
    from_entity: "Shoot",
    to_entity: "Resource Library Item",
    cardinality: "one-to-many",
    relationship_rule: "A Shoot may have many Resource Library Items such as Setup Photo, job docs, or Best Reference context.",
    ownership_rule: "Resource Library Item belongs to the shared resource model and may also be linked to Organization or Location at the same time.",
    notes: "This avoids loose attachment dumps and preserves reusable prep context."
  },
  {
    from_entity: "Location",
    to_entity: "Resource Library Item",
    cardinality: "one-to-many",
    relationship_rule: "A Location may have many Resource Library Items for setup reference, QR docs, or recurring prep history.",
    ownership_rule: "Location-scoped resources remain reusable across future Shoots at the same Location.",
    notes: "This is a primary feed into Recurring Location Intelligence."
  },
  {
    from_entity: "Agreement",
    to_entity: "Organization",
    cardinality: "many-to-one",
    relationship_rule: "Each Agreement belongs to one Organization; one Organization may have multiple concurrent Agreements.",
    ownership_rule: "Agreement lifecycle is owned by Contracts & Agreements but anchored to the canonical Organization.",
    notes: "Use Agreement Link for additional scope like Location, Contact, or Shoot context."
  },
  {
    from_entity: "Agreement",
    to_entity: "Contact",
    cardinality: "many-to-many via signer/link records",
    relationship_rule: "An Agreement may have one or many signer Contacts and may also point to a primary Contact for business ownership.",
    ownership_rule: "Signer identity should prefer canonical Contact records, with internal countersigners allowed through user identity when necessary.",
    notes: "Do not flatten multi-signer structure into one freeform name field."
  },
  {
    from_entity: "Post-Shoot Evaluation",
    to_entity: "Shoot",
    cardinality: "many-to-one",
    relationship_rule: "Each Post-Shoot Evaluation belongs to one Shoot, though a Shoot may later support multiple evaluation contributors if needed.",
    ownership_rule: "Shoot closeout owns the evaluation record, while the record snapshots its Organization and Location context for history.",
    notes: "Evaluations should never float without a Shoot anchor."
  },
  {
    from_entity: "Recurring Location Intelligence",
    to_entity: "Location",
    cardinality: "one-to-one derived projection",
    relationship_rule: "Recurring Location Intelligence projects per canonical Location from many historical source records.",
    ownership_rule: "Location is canonical; Recurring Location Intelligence is derived and refreshable.",
    notes: "Do not create a second editable location-memory record that drifts from history."
  },
  {
    from_entity: "Asset",
    to_entity: "Shoot",
    cardinality: "many-to-many via custody and checkout context",
    relationship_rule: "Assets may be checked out or linked to a Shoot through custody/workflow events, but do not belong to a Shoot.",
    ownership_rule: "Asset identity and custody remain owned by Gear / Equipment.",
    notes: "This is how high-value gear becomes operationally attributable without corrupting inventory identity."
  },
  {
    from_entity: "Kit",
    to_entity: "Shoot",
    cardinality: "many-to-many via checkout and verification context",
    relationship_rule: "Kits may be checked out for a Shoot and verified before departure, but do not belong to a Shoot.",
    ownership_rule: "Kit identity remains in Gear / Equipment; Shoot linkage is contextual.",
    notes: "Pre-Shoot Verification and return workflows should preserve this distinction."
  },
  {
    from_entity: "Time Session",
    to_entity: "Shoot",
    cardinality: "indirect via Time Segment",
    relationship_rule: "Time Session does not directly belong to a Shoot; Time Segment carries the Shoot and Location attribution when needed.",
    ownership_rule: "Labor source of truth stays in Time Clock / Labor Tracking, then projects to Shoot reporting through Time Segment linkage.",
    notes: "This prevents payroll and operational context from collapsing into one denormalized record."
  },
  {
    from_entity: "Time Segment",
    to_entity: "Shoot",
    cardinality: "many-to-one optional",
    relationship_rule: "A Time Segment may link to a Shoot when the employee is doing Photography or paid Office/Drive work attributable to that Shoot.",
    ownership_rule: "Time Segment remains canonical for labor state while exposing attributable operational context.",
    notes: "This is the correct layer for profit, readiness, and compliance reporting joins."
  }
];

const CONNECTED_SYSTEMS: ClientOperationsConnectedSystemRule[] = [
  {
    system: "Time Clock / Labor Tracking",
    canonical_entities_used: ["Shoot", "Location", "Time Session", "Time Segment"],
    source_of_truth_rule: "Time Session and Time Segment are the canonical labor records; Shoot and Location are contextual references, not labor-owned records.",
    projection_rule: "Operations, dashboards, mileage, and profitability consume approved labor projections from Time Session and Time Segment.",
    notes: "Geofence logic, correction workflows, and payroll export should not mutate Shoot identity."
  },
  {
    system: "Gear / Equipment",
    canonical_entities_used: ["Asset", "Kit", "Shoot", "Location"],
    source_of_truth_rule: "Asset and Kit are canonical inventory records; Shoot and Location are contextual usage references through custody events and verification workflows.",
    projection_rule: "Dashboard and alert surfaces consume overdue, missing, repair, and return state projections from canonical gear records.",
    notes: "Gear should hang off the core through explicit shoot/location linkage rather than a separate ad hoc equipment world."
  },
  {
    system: "Alerts / Notifications",
    canonical_entities_used: ["Organization", "Location", "Shoot", "Agreement", "Post-Shoot Evaluation"],
    source_of_truth_rule: "Alerts are derived cross-system records that reference canonical entities and preserve resolution history.",
    projection_rule: "Dashboard, Operations, Organization Overview, Attendance, Gear, and employee workflows should read warning projections rather than hardcode checks in every view.",
    notes: "This is the correct place to unify missing agreement, missing setup photo, and assigned-but-missing employee signals."
  },
  {
    system: "Reporting / Dashboards",
    canonical_entities_used: ["Organization", "Location", "Shoot", "Agreement", "Post-Shoot Evaluation", "Time Segment", "Asset", "Kit"],
    source_of_truth_rule: "Reports are derived projections and must not become a parallel source of operational truth.",
    projection_rule: "Leadership and employee-safe dashboards should read cached projections built from canonical entities and approved event/state sources.",
    notes: "This keeps reporting performant without duplicating operational ownership."
  }
];

const PERMISSIONS: ClientOperationsPermissionStrategyRow[] = [
  {
    role_group: "Leadership",
    create_scope: ["Organization", "Contact", "Location", "Shoot", "Agreement", "Resource Library Item metadata", "Time correction and override records", "Asset and Kit registry records"],
    manage_scope: ["full Contracts & Agreements lifecycle", "gear custody overrides", "labor corrections and approvals", "organization-wide warning review", "reporting and dashboard visibility"],
    default_view_scope: "organization-wide across all client and operational entities",
    restrictions: ["must still respect employee-safe field filtering when viewing employee projections", "provider integrations and payroll exports should remain routed through protected services"]
  },
  {
    role_group: "Schools department",
    create_scope: ["Organization", "Contact", "Location", "Shoot", "Resource Library Item", "non-financial operational notes"],
    manage_scope: ["schools Shoots, schools Locations, schools prep resources, schools recurring readiness context"],
    default_view_scope: "department-oriented operational access with organization-wide search for shared client records",
    restrictions: ["no Agreement send authority by default", "no leadership-only labor cost or provider-backed contract lifecycle access"]
  },
  {
    role_group: "Sports department",
    create_scope: ["Organization", "Contact", "Location", "Shoot", "Resource Library Item", "non-financial operational notes"],
    manage_scope: ["sports Shoots, sports Locations, sports prep resources, sports recurring readiness context"],
    default_view_scope: "department-oriented operational access with organization-wide search for shared client records",
    restrictions: ["no Agreement send authority by default", "no leadership-only labor cost or provider-backed contract lifecycle access"]
  },
  {
    role_group: "Customer service",
    create_scope: ["Organization", "Contact", "Location", "Shoot support notes", "Resource Library Item documents where allowed"],
    manage_scope: ["client directory maintenance, contact maintenance, location maintenance, agreement visibility, warning follow-up context"],
    default_view_scope: "organization-wide client directory visibility with operational context where needed for service follow-up",
    restrictions: ["no labor correction authority", "no gear custody authority", "Agreement send/reminder authority stays leadership-only"]
  },
  {
    role_group: "Assistant managers",
    create_scope: ["gear custody operational records", "service issue reports", "operational check-in/check-out state"],
    manage_scope: ["gear custody, returns, Pre-Shoot Verification, temporary substitutions, operational inventory review"],
    default_view_scope: "operational inventory and limited shoot context visibility",
    restrictions: ["no canonical Agreement management", "no organization directory creation by default unless paired with an authorized office role"]
  },
  {
    role_group: "Photographers",
    create_scope: ["Resource Library Item uploads", "Post-Shoot Evaluation", "own Time Session and Time Segment interactions", "issue reports where allowed"],
    manage_scope: ["own field workflows only"],
    default_view_scope: "search/view/select core records needed for assigned work plus employee-safe history and prep context",
    restrictions: ["cannot create Organization, Contact, or Location unless also holding an authorized office role", "cannot manage Agreement lifecycle", "cannot edit submitted Post-Shoot Evaluation"]
  }
];

const ACTIVITY_LOG_STRATEGY: ClientOperationsActivityLogRule[] = [
  {
    event_family: "Agreement lifecycle",
    shared_activity_log: true,
    module_specific_log: "provider event log and signer lifecycle records",
    primary_scope_entities: ["Agreement", "Organization", "Contact"],
    notes: "Agreement detail should show lifecycle context, while Organization activity feeds can project a summarized contract history."
  },
  {
    event_family: "Resource uploads and approvals",
    shared_activity_log: true,
    module_specific_log: "resource review history",
    primary_scope_entities: ["Resource Library Item", "Shoot", "Location", "Organization"],
    notes: "Shared activity should expose upload/review milestones without hiding the richer review metadata."
  },
  {
    event_family: "Post-Shoot Evaluation submission",
    shared_activity_log: true,
    module_specific_log: "closeout compliance flags",
    primary_scope_entities: ["Post-Shoot Evaluation", "Shoot", "Location", "Organization"],
    notes: "This is both historical memory and compliance state."
  },
  {
    event_family: "Labor corrections and approvals",
    shared_activity_log: false,
    module_specific_log: "Time Session, Time Segment, Clock Event, Exception Request, Approval Record, audit_log",
    primary_scope_entities: ["Time Session", "Time Segment", "Shoot"],
    notes: "Cross-module pages should consume summarized status, but payroll-grade detail stays in labor-specific logs."
  },
  {
    event_family: "Gear custody and return events",
    shared_activity_log: false,
    module_specific_log: "Custody Event, scan history, Service / Repair Record",
    primary_scope_entities: ["Asset", "Kit", "Shoot", "Location"],
    notes: "Operational dashboards may project these into shared warning surfaces, but the custody timeline remains gear-owned."
  },
  {
    event_family: "Alerts and incidents",
    shared_activity_log: true,
    module_specific_log: "alert/incident lifecycle records",
    primary_scope_entities: ["Organization", "Location", "Shoot", "Agreement"],
    notes: "Warnings should be visible in shared operational history even when the underlying incident model stays module-specific."
  }
];

const DOCUMENT_MEDIA_STRATEGY: ClientOperationsDocumentMediaRule[] = [
  {
    subject: "Shared file storage backbone",
    canonical_storage_model: "One underlying object storage and file metadata model with typed Resource Library linkage plus Agreement-specific version records where lifecycle demands it.",
    module_surfaces: ["Resource Library", "Contracts & Agreements", "Shoot detail", "Location detail", "Organization detail"],
    access_rule: "File access is role-filtered and context-aware; the storage layer is shared, but projection layers decide what each role can see or download.",
    notes: "Do not create separate attachment silos for each module."
  },
  {
    subject: "Prep photos and historical reference media",
    canonical_storage_model: "Store as Resource Library Item records with explicit category, scope owner, visibility, and approval metadata.",
    module_surfaces: ["Shoot Resource Library", "Location Resource Library", "Recurring Location Intelligence"],
    access_rule: "Photographers see approved prep context only; leadership may view and manage the full set.",
    notes: "Best Reference remains a curation layer on top of the shared Resource Library Item model."
  },
  {
    subject: "Agreements and signed contract packages",
    canonical_storage_model: "Agreement File and Agreement Version records use the same underlying file store but remain surfaced separately inside Contracts & Agreements.",
    module_surfaces: ["Contracts & Agreements", "Organization summary"],
    access_rule: "Agreement management remains leadership-only even though the storage foundation is shared.",
    notes: "This supports eventual 17hats replacement without building a second file stack."
  },
  {
    subject: "QR/job docs and operational documents",
    canonical_storage_model: "Store as Resource Library Item documents with explicit scope to Shoot, Location, or Organization and clean category tagging.",
    module_surfaces: ["Resource Library", "Shoot detail", "Recurring Location Intelligence"],
    access_rule: "Use contextual viewing first and avoid unrestricted download defaults for sensitive operational documents.",
    notes: "Documents stay in the same library experience but must remain clearly segmented from media."
  }
];

const SEARCH_STRATEGY: ClientOperationsSearchRule[] = [
  {
    facet: "organization/client",
    canonical_sources: ["Organization.canonical_name", "Organization.display_name", "Organization aliases"],
    expected_behavior: "Global typeahead and list filtering should prefer canonical Organization matches and suppress duplicate freeform variants.",
    notes: "This is the primary identity anchor for the Client Operations Core."
  },
  {
    facet: "contact",
    canonical_sources: ["Contact.full_name", "Contact.email", "Contact.phone", "linked Organization"],
    expected_behavior: "Search should support organization-scoped and global contact lookup, then project contact-linked Shoots and Agreements.",
    notes: "Contacts should be searchable anywhere selection is required."
  },
  {
    facet: "location",
    canonical_sources: ["Location.location_name", "Location address fields", "linked Organization"],
    expected_behavior: "Support fast search-first location lookup with clear result lists and drill-in to detail/history.",
    notes: "Recurring Location Intelligence should be reachable from these results."
  },
  {
    facet: "shoot date",
    canonical_sources: ["Shoot date/time fields", "linked Organization", "linked Location", "status"],
    expected_behavior: "Calendar views, queue views, and reports should all filter from the same canonical Shoot timing model.",
    notes: "Avoid separate competing calendar concepts."
  },
  {
    facet: "agreement status",
    canonical_sources: ["Agreement.status", "Agreement key dates", "Agreement signer/provider state"],
    expected_behavior: "Contracts & Agreements and shoot/account warnings should filter and bucket off the same canonical Agreement lifecycle fields.",
    notes: "Unsigned, expiring, expired, and countersign pending should not be re-derived differently per screen."
  },
  {
    facet: "resource category",
    canonical_sources: ["Resource Library Item.category", "visibility scope", "linked owners", "captured_at"],
    expected_behavior: "Resource lists should filter by category, date, Shoot, Location, Organization, and uploader from one shared model.",
    notes: "This is critical for prep-first workflows."
  },
  {
    facet: "evaluation history",
    canonical_sources: ["Post-Shoot Evaluation submission fields", "linked Shoot/Location/Organization"],
    expected_behavior: "Search and reporting should surface evaluations by Organization, Location, Shoot, date, and issue flag.",
    notes: "This powers closeout review and recurring memory."
  },
  {
    facet: "recurring location intelligence signals",
    canonical_sources: ["derived Recurring Location Intelligence projections", "resource summaries", "evaluation summaries", "issue summaries"],
    expected_behavior: "Location detail and prep workflows should expose filters for recurring issues, best references, and reminders without bypassing the canonical source records.",
    notes: "These are derived search facets, not standalone user-entered records."
  }
];

const WARNING_STRATEGY: ClientOperationsWarningSurfaceRule[] = [
  {
    warning_code: "missing_active_agreement",
    originating_systems: ["Contracts & Agreements", "Alerts / Notifications"],
    primary_surfaces: ["Organization Overview", "Contracts & Agreements", "Shoot detail", "Dashboard"],
    escalation_rule: "Surface immediately at the Organization level and project into upcoming Shoot context until an active Agreement exists.",
    notes: "This warning should be derived from canonical Agreement status rather than custom per-screen checks."
  },
  {
    warning_code: "upcoming_shoot_without_signed_agreement",
    originating_systems: ["Contracts & Agreements", "Operations Scheduling", "Alerts / Notifications"],
    primary_surfaces: ["Shoot detail", "Operations calendar", "Dashboard", "Reports"],
    escalation_rule: "Escalate to a major warning as the Shoot approaches when the linked Organization lacks a signed or active Agreement.",
    notes: "Scheduling remains allowed, but the warning must be operationally obvious."
  },
  {
    warning_code: "missing_setup_photos",
    originating_systems: ["Resource Library", "Shoot Closeout", "Alerts / Notifications"],
    primary_surfaces: ["employee context", "Shoot detail", "Dashboard", "Reports"],
    escalation_rule: "Warn during the Shoot and at closeout; notify leadership when unresolved after expected closeout timing.",
    notes: "This is a compliance and prep-memory signal, not a booking blocker."
  },
  {
    warning_code: "missing_post_shoot_evaluation",
    originating_systems: ["Shoot Closeout", "Alerts / Notifications"],
    primary_surfaces: ["employee context", "Shoot detail", "Dashboard", "Reports"],
    escalation_rule: "Warn at closeout, keep visible until submitted, and notify leadership where configured.",
    notes: "This should feed Recurring Location Intelligence and closeout compliance reporting."
  },
  {
    warning_code: "mileage_blocked_missing_evaluation",
    originating_systems: ["Shoot Closeout", "Time Clock / Labor Tracking", "Alerts / Notifications"],
    primary_surfaces: ["employee context", "Attendance", "Dashboard", "Reports"],
    escalation_rule: "Surface when mileage eligibility exists but the required Post-Shoot Evaluation has not been completed.",
    notes: "Keep mileage status distinct from labor cost and payroll calculations."
  },
  {
    warning_code: "gear_not_returned",
    originating_systems: ["Gear / Equipment", "Alerts / Notifications"],
    primary_surfaces: ["Gear dashboard", "Shoot detail", "Dashboard", "Reports"],
    escalation_rule: "Create and maintain an open warning when checked-out gear exceeds the allowed return window or is explicitly marked missing.",
    notes: "Use canonical Asset, Kit, and custody state rather than manual notes."
  },
  {
    warning_code: "assigned_but_missing_employee",
    originating_systems: ["Time Clock / Labor Tracking", "Alerts / Notifications"],
    primary_surfaces: ["Dashboard", "Attendance", "Operations calendar", "Shoot detail"],
    escalation_rule: "Escalate after the configured showtime threshold when the assigned employee is neither correctly clocked in nor inside the required geofence.",
    notes: "This is a leadership urgency surface, not a payroll-only condition."
  },
  {
    warning_code: "likely_present_missing_clock_in",
    originating_systems: ["Time Clock / Labor Tracking", "Alerts / Notifications"],
    primary_surfaces: ["Attendance", "Dashboard", "Shoot detail"],
    escalation_rule: "Surface as a softer operational warning when the user appears present within the soft radius but is not correctly clocked in.",
    notes: "Route initially to the shoot leader to reduce alert noise."
  }
];

const INFORMATION_ARCHITECTURE = {
  top_level_navigation: ["Dashboard", "Operations", "Clients / Organizations", "Reports", "Training", "Account"],
  operations_sections: ["Calendar", "Shoots", "Alerts", "Approvals", "Attendance / Labor", "Gear", "Status Board"],
  client_organization_sections: ["Overview", "Contacts", "Locations", "Shoots", "Resource Library", "Contracts & Agreements", "Activity / History"],
  notes: [
    "Clients / Organizations is the canonical client backbone where Organization, Contact, Location, Agreement, and Resource Library context come together.",
    "Operations is the execution layer working from the same canonical Organization, Location, Shoot, labor, and gear records rather than a separate system.",
    "Reports remains derived and should not become a parallel source of operational truth."
  ]
};

const NAMING_DICTIONARY: ClientOperationsNamingRule[] = [
  {
    term: "Organization",
    definition: "Canonical client/account record for Kemmetmueller Photography operational work.",
    aliases_to_avoid: ["Account", "Client account", "Customer"],
    notes: "Use Organization consistently across directory, Shoot linkage, and Agreement context."
  },
  {
    term: "Contact",
    definition: "Named person linked to an Organization and reused across scheduling, Agreement, and communication workflows.",
    aliases_to_avoid: ["Client contact", "Person", "Rep"],
    notes: "Use Primary Contact and additional Contact where Shoot-specific roles matter."
  },
  {
    term: "Location",
    definition: "Canonical building/place record linked to an Organization and reused across Shoots, resources, agreements, and recurring memory.",
    aliases_to_avoid: ["Venue", "Site", "Location guide entry"],
    notes: "Recurring Location Intelligence should project from Location rather than replace it."
  },
  {
    term: "Shoot",
    definition: "Operational job record for scheduling, staffing, readiness, labor attribution, agreement risk, and gear usage.",
    aliases_to_avoid: ["Job", "Assignment", "Event instance"],
    notes: "When job is used informally in copy, the canonical entity name should still remain Shoot."
  },
  {
    term: "Resource Library",
    definition: "Shared internal media/document system for prep materials, references, job docs, and historical operational memory.",
    aliases_to_avoid: ["Files", "Attachments", "Media dump"],
    notes: "Use Resource Library Item for the individual record and Resource Library for the experience."
  },
  {
    term: "Agreement",
    definition: "Structured contract lifecycle record with metadata, signers, countersigners, versions, reminders, and status.",
    aliases_to_avoid: ["Contract record", "17hats document"],
    notes: "Use Contracts & Agreements as the section label and Agreement as the record name."
  },
  {
    term: "Post-Shoot Evaluation",
    definition: "Submitted closeout record capturing outcome, reminders for next time, issue flags, and mileage-related completion status.",
    aliases_to_avoid: ["Post-job eval", "Wrap report", "Closeout note"],
    notes: "Keep the name consistent in mobile and reporting surfaces."
  },
  {
    term: "Recurring Location Intelligence",
    definition: "Derived prep/readiness memory for a Location assembled from historical Shoots, Resource Library Items, Post-Shoot Evaluation records, and issues.",
    aliases_to_avoid: ["Location memory", "Location guide intelligence", "Recurring notes"],
    notes: "Treat it as a projection layer rather than a new editable root entity."
  },
  {
    term: "Time Session",
    definition: "Employee workday/session container in the labor model.",
    aliases_to_avoid: ["Time card", "Day punch record"],
    notes: "Use Time Segment for attributable state slices within a Time Session."
  },
  {
    term: "Time Segment",
    definition: "Explicit paid work-state slice such as Office/Drive or Photography within a Time Session.",
    aliases_to_avoid: ["Punch segment", "Work chunk"],
    notes: "Use this as the bridge from labor to Shoot and Location attribution."
  },
  {
    term: "Asset",
    definition: "Individually tracked gear record with identity, custody, service history, and readiness state.",
    aliases_to_avoid: ["Gear item", "Equipment piece"],
    notes: "Asset identity remains independent even when the item belongs to a Kit."
  },
  {
    term: "Kit",
    definition: "Self-contained grouping of Assets used for standing assignment, temporary checkout, and Pre-Shoot Verification.",
    aliases_to_avoid: ["Bag", "Package", "Set"],
    notes: "Use Kit Asset Membership for the structured contents relationship."
  }
];

const FUTURE_PROOFING: ClientOperationsFutureProofingRule[] = [
  {
    capability: "17hats replacement for agreements",
    architectural_support: "Agreement records, signer lifecycle, reminder history, provider sync fields, and Agreement-specific file/version lineage already anchor contract management inside Mission Control.",
    notes: "A provider integration can plug in later without changing Organization, Contact, or Agreement ownership."
  },
  {
    capability: "eventual payroll export",
    architectural_support: "Time Session and Time Segment remain canonical labor records while Shoot and Location attribution stays relational and export-ready.",
    notes: "This prevents payroll logic from forcing a rewrite of the core client and Shoot model."
  },
  {
    capability: "recurring location memory",
    architectural_support: "Recurring Location Intelligence is explicitly defined as a derived projection from Location, Resource Library Item, Post-Shoot Evaluation, Agreement, and Shoot history.",
    notes: "This keeps readiness memory refreshable and testable."
  },
  {
    capability: "mobile-first field workflows",
    architectural_support: "Shoot, Resource Library Item, Post-Shoot Evaluation, Time Session, and Time Segment relationships all preserve strong mobile entry points without fragmenting record ownership.",
    notes: "Field users can contribute evidence and closeout data without becoming owners of core identity records."
  },
  {
    capability: "QR-based gear workflows",
    architectural_support: "Asset and Kit identity stay canonical while custody, verification, scan history, and Shoot linkage remain contextual event layers.",
    notes: "This supports future scan-assisted flows without distorting inventory identity."
  },
  {
    capability: "geofence-based labor workflows",
    architectural_support: "Labor remains anchored to Time Session and Time Segment, with Location and Shoot references carrying contextual attribution and warning generation.",
    notes: "Geofence transitions can evolve without rewriting client, Shoot, or agreement models."
  }
];

const REVIEWER_HANDOFF = [
  "Keep Organization, Contact, Location, and Shoot as the canonical client-and-execution backbone. Do not create parallel client/account/location identity in later modules.",
  "Keep Resource Library Item as the shared media/document spine even when the UI presents separate surfaces like Resource Library or Contracts & Agreements.",
  "Keep Agreement, Post-Shoot Evaluation, Time Session, Time Segment, Asset, and Kit authoritative inside their own bounded domains, then project outward into dashboards and warning surfaces.",
  "Implement cross-system warnings through shared alert or warning records and projections rather than hardcoding duplicate warning logic in every screen.",
  "Keep Recurring Location Intelligence, dashboards, and reports derived from canonical source records so they remain refreshable and auditable."
];

export function getClientOperationsCoreContract(): ClientOperationsCoreContract {
  return {
    domain_name: "Client Operations Core",
    architecture_choice:
      "A bounded core inside Mission Control where canonical client-and-operation records anchor every major module, while labor, gear, alerts, agreements, and reporting connect through explicit relational boundaries instead of becoming separate products.",
    north_star:
      "One connected operational platform where Kemmetmueller Photography can manage Organization, Contact, Location, Shoot, Resource Library Item, Agreement, Post-Shoot Evaluation, Recurring Location Intelligence, labor, and equipment in one trustworthy system.",
    canonical_entities: CANONICAL_ENTITIES,
    relationship_rules: RELATIONSHIP_RULES,
    connected_systems: CONNECTED_SYSTEMS,
    permissions_strategy: PERMISSIONS,
    activity_log_strategy: ACTIVITY_LOG_STRATEGY,
    file_document_media_strategy: DOCUMENT_MEDIA_STRATEGY,
    search_strategy: SEARCH_STRATEGY,
    warning_strategy: WARNING_STRATEGY,
    information_architecture: INFORMATION_ARCHITECTURE,
    naming_dictionary: NAMING_DICTIONARY,
    future_proofing: FUTURE_PROOFING,
    reviewer_handoff: REVIEWER_HANDOFF
  };
}
