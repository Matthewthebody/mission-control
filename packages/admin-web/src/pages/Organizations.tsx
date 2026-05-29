import { useEffect, useMemo, useState } from "react";
import {
  ContactEditorForm,
  DuplicateReviewForm,
  LocationAttachForm,
  LocationEditorForm,
  OrganizationContactLinkForm,
  OrganizationEditorForm,
  ShootAttachForm
} from "../components/directory/DirectoryActionForms";
import { DirectoryContactImportWorkflow } from "../components/directory/DirectoryContactImportWorkflow";
import {
  DirectoryCommunicationLogForm,
  DirectoryRelationshipFollowUpForm,
  DirectoryRelationshipMemoryForm,
  DirectoryTouchpointPlanForm
} from "../components/directory/DirectoryContinuityForms";
import { DirectoryDrawer } from "../components/directory/DirectoryDrawer";
import { DirectoryRail } from "../components/directory/DirectoryRail";
import {
  SchoolContactCategoriesForm,
  SchoolNoteForm,
  SchoolProfileForm,
  SchoolRuleForm
} from "../components/directory/DirectorySchoolForms";
import { DirectoryWorkspace } from "../components/directory/DirectoryWorkspace";
import type { DirectoryView, DirectoryWorkspaceTab } from "../components/directory/directoryOptions";
import { canManageCanonicalDirectoryRecords, canManageSchoolFoundation } from "../permissions";
import {
  archiveOrganizationContactRecord,
  archiveOrganizationLocationRecord,
  attachContactToLocationRecord,
  attachContactToOrganizationRecord,
  attachContactToShootRecord,
  createDirectoryDuplicateReviewRecord,
  createDirectoryRelationshipFollowUpRecord,
  createDirectoryRelationshipMemoryRecord,
  createDirectoryTouchpointPlanRecord,
  createOrganizationContactRecord,
  createOrganizationLocationRecord,
  createOrganizationRecord,
  createSchoolNoteRecord,
  createSchoolRuleRecord,
  createOrganizationTouchpointRecord,
  detachContactFromLocationRecord,
  getContactRelationshipContinuity,
  getDirectoryContactDetail,
  getOrganizationDetail,
  getOrganizationRelationshipContinuity,
  getOrganizationOperationsHub,
  listDirectoryContacts,
  listDirectoryDuplicateReviews,
  listDirectoryLocations,
  listDirectoryOwnerOptions,
  listOrganizationTouchpoints,
  listOrganizations,
  reactivateOrganizationContactRecord,
  reactivateOrganizationLocationRecord,
  updateDirectoryDuplicateReviewRecord,
  updateDirectoryRelationshipFollowUpRecord,
  updateDirectoryRelationshipMemoryRecord,
  updateDirectoryTouchpointPlanRecord,
  updateSchoolContactCategoriesRecord,
  updateSchoolProfileRecord,
  updateSchoolRuleRecord,
  updateOrganizationContactRecord,
  updateOrganizationLocationRecord,
  updateOrganizationRecord,
  uploadOrganizationContactPhotoFile,
  uploadOrganizationLogoFile,
  type DirectoryDuplicateReviewCreateInput,
  type DirectoryRelationshipAttachInput,
  type DirectoryTouchpointCreateInput,
  type OrganizationContactCreateInput,
  type OrganizationCreateInput,
  type OrganizationLocationCreateInput
} from "../services/organizationApi";
import type {
  DirectoryActiveStatus,
  DirectoryContactRoleCategory,
  DirectoryContactDetailResponse,
  DirectoryContactStatus,
  DirectoryContactSummary,
  DirectoryDecisionInfluence,
  DirectoryRelationshipContinuityBundle,
  DirectoryDuplicateReviewRecord,
  DirectoryLocationSummary,
  DirectoryOperationalImportance,
  DirectoryOwnerOption,
  DirectoryRelationshipOwnershipState,
  DirectoryTouchpointRecord,
  OrganizationAccountType,
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation,
  OrganizationOperationsHub,
  OrganizationSummary,
  SchoolRule,
  SessionUser
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  entryView?: DirectoryView;
  defaultContactAudience?: "all" | "company";
};
type RouteState = { view: DirectoryView; organizationId: string | null; contactId: string | null; locationId: string | null; tab: DirectoryWorkspaceTab };
type ContactAudience = "all" | "company" | "external";
type DrawerState =
  | { type: "create-organization" }
  | { type: "edit-organization" }
  | { type: "edit-school-profile" }
  | { type: "edit-school-contact-categories"; contact: OrganizationContact }
  | { type: "create-school-rule" }
  | { type: "edit-school-rule"; rule: SchoolRule }
  | { type: "create-school-note" }
  | { type: "create-contact" }
  | { type: "edit-contact"; contact: OrganizationContact }
  | { type: "link-existing-contact" }
  | { type: "create-location" }
  | { type: "edit-location"; location: OrganizationLocation }
  | { type: "touchpoint"; contact?: OrganizationContact | null }
  | { type: "touchpoint-plan"; contact?: OrganizationContact | null }
  | { type: "relationship-memory"; contact?: OrganizationContact | null }
  | { type: "relationship-follow-up"; contact?: OrganizationContact | null }
  | { type: "attach-location"; contact: OrganizationContact }
  | { type: "attach-shoot"; contact: OrganizationContact }
  | { type: "import-contacts" }
  | { type: "duplicate-review"; contact?: OrganizationContact | null };
type DirectoryRailFilters = {
  search: string;
  accountType: OrganizationAccountType | "all";
  activeStatus: DirectoryActiveStatus | "all";
  contactStatus: DirectoryContactStatus | "all";
  roleCategory: DirectoryContactRoleCategory | "all";
  operationalImportance: DirectoryOperationalImportance | "all";
  decisionInfluence: DirectoryDecisionInfluence | "all";
  primaryInternalOwnerUserId: string | null;
  relationshipOwnershipState: DirectoryRelationshipOwnershipState | "all";
  hasPhotoOnly: boolean;
  hasLogoOnly: boolean;
  needsReviewOnly: boolean;
  myContactsOnly: boolean;
};

export function Organizations({
  token,
  currentUser,
  entryView = "organizations",
  defaultContactAudience = "all"
}: Props) {
  const canManage = canManageCanonicalDirectoryRecords(currentUser);
  const canManageSchoolRecords = canManageSchoolFoundation(currentUser);
  const [route, setRoute] = useState<RouteState>(() => parseOrganizationsHash(entryView));
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState<OrganizationAccountType | "all">("all");
  const [activeStatus, setActiveStatus] = useState<DirectoryActiveStatus | "all">("active");
  const [contactStatus, setContactStatus] = useState<DirectoryContactStatus | "all">("all");
  const [roleCategory, setRoleCategory] = useState<DirectoryContactRoleCategory | "all">("all");
  const [operationalImportance, setOperationalImportance] = useState<DirectoryOperationalImportance | "all">("all");
  const [decisionInfluence, setDecisionInfluence] = useState<DirectoryDecisionInfluence | "all">("all");
  const [primaryInternalOwnerUserId, setPrimaryInternalOwnerUserId] = useState("");
  const [relationshipOwnershipState, setRelationshipOwnershipState] = useState<DirectoryRelationshipOwnershipState | "all">("all");
  const [hasPhotoOnly, setHasPhotoOnly] = useState(false);
  const [hasLogoOnly, setHasLogoOnly] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [myContactsOnly, setMyContactsOnly] = useState(false);
  const [contactAudience, setContactAudience] = useState<ContactAudience>(
    defaultContactAudience === "company" ? "company" : "all"
  );
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [contacts, setContacts] = useState<DirectoryContactSummary[]>([]);
  const [locations, setLocations] = useState<DirectoryLocationSummary[]>([]);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [contactDetail, setContactDetail] = useState<DirectoryContactDetailResponse | null>(null);
  const [touchpoints, setTouchpoints] = useState<DirectoryTouchpointRecord[]>([]);
  const [duplicateReviews, setDuplicateReviews] = useState<DirectoryDuplicateReviewRecord[]>([]);
  const [operationsHub, setOperationsHub] = useState<OrganizationOperationsHub | null>(null);
  const [organizationContinuity, setOrganizationContinuity] = useState<DirectoryRelationshipContinuityBundle | null>(null);
  const [contactContinuity, setContactContinuity] = useState<DirectoryRelationshipContinuityBundle | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [railLoading, setRailLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [contactDetailLoading, setContactDetailLoading] = useState(false);
  const [operationsHubLoading, setOperationsHubLoading] = useState(false);
  const [duplicateReviewsLoading, setDuplicateReviewsLoading] = useState(false);
  const [organizationContinuityLoading, setOrganizationContinuityLoading] = useState(false);
  const [contactContinuityLoading, setContactContinuityLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [contactDetailError, setContactDetailError] = useState("");
  const [organizationContinuityError, setOrganizationContinuityError] = useState("");
  const [contactContinuityError, setContactContinuityError] = useState("");
  const [drawerError, setDrawerError] = useState("");
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [operationsHubLoadedOrganizationId, setOperationsHubLoadedOrganizationId] = useState<string | null>(null);
  const [duplicateReviewsLoadedOrganizationId, setDuplicateReviewsLoadedOrganizationId] = useState<string | null>(null);
  const selectedContactId = route.contactId ?? null;
  const selectedLocationId = route.locationId ?? null;
  const activeTab = !canManage && route.tab === "duplicates" ? "profile" : route.tab;

  useEffect(() => {
    const sync = () => setRoute(parseOrganizationsHash(entryView));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [entryView]);

  useEffect(() => {
    let cancelled = false;
    if (!canManage) {
      setOwnerOptions([]);
      return () => {
        cancelled = true;
      };
    }
    void listDirectoryOwnerOptions(token)
      .then((ownerPayload) => {
        if (cancelled) return;
        setOwnerOptions(ownerPayload.owners);
      })
      .catch((error) => !cancelled && setPageError(messageFor(error, "We couldn't load directory owner options right now.")));
    return () => {
      cancelled = true;
    };
  }, [canManage, token]);

  useEffect(() => {
    let cancelled = false;
    setRailLoading(true);
    void loadDirectoryRailSlice(token, route.view, {
      search,
      accountType,
      activeStatus,
      contactStatus,
      roleCategory,
      operationalImportance,
      decisionInfluence,
      primaryInternalOwnerUserId: primaryInternalOwnerUserId || null,
      relationshipOwnershipState,
      hasPhotoOnly,
      hasLogoOnly,
      needsReviewOnly,
      myContactsOnly
    })
      .then((payload) => {
        if (cancelled) return;
        setOrganizations(payload.organizations);
        setContacts(payload.contacts);
        setLocations(payload.locations);
        setPageError("");
      })
      .catch((error) => !cancelled && setPageError(messageFor(error, "We couldn't refresh the directory right now.")))
      .finally(() => !cancelled && setRailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    activeStatus,
    accountType,
    contactStatus,
    decisionInfluence,
    hasLogoOnly,
    hasPhotoOnly,
    myContactsOnly,
    needsReviewOnly,
    operationalImportance,
    primaryInternalOwnerUserId,
    relationshipOwnershipState,
    route.view,
    roleCategory,
    search,
    token
  ]);

  const visibleContacts = useMemo(() => {
    if (contactAudience === "company") {
      return contacts.filter((contact) => contact.organization_account_type === "internal");
    }
    if (contactAudience === "external") {
      return contacts.filter((contact) => contact.organization_account_type !== "internal");
    }
    return contacts;
  }, [contactAudience, contacts]);

  const companyDirectoryCount = useMemo(
    () => contacts.filter((contact) => contact.organization_account_type === "internal").length,
    [contacts]
  );
  const externalDirectoryCount = Math.max(contacts.length - companyDirectoryCount, 0);

  useEffect(() => {
    if (railLoading) return;
    if (route.view === "contacts" && !route.contactId) {
      const fallbackContact = visibleContacts[0] ?? contacts[0];
      if (fallbackContact) {
        pushRoute({
          view: "contacts",
          organizationId: fallbackContact.organization_id,
          contactId: fallbackContact.id,
          locationId: null,
          tab: "relationships"
        });
      }
      return;
    }
    if (route.view === "locations" && !route.locationId) {
      const fallbackLocation = locations[0];
      if (fallbackLocation) {
        pushRoute({
          view: "locations",
          organizationId: fallbackLocation.organization_id,
          contactId: null,
          locationId: fallbackLocation.id,
          tab: "relationships"
        });
      }
    }
  }, [contacts, locations, railLoading, route.contactId, route.locationId, route.view, visibleContacts]);

  const activeOrganizationId = useMemo(() => {
    if (route.organizationId) {
      return route.organizationId;
    }
    if (route.view === "contacts" && route.contactId) {
      return (
        contacts.find((contact) => contact.id === route.contactId)?.organization_id ??
        contactDetail?.contact.organization_id ??
        detail?.organization.id ??
        null
      );
    }
    if (route.view === "locations" && route.locationId) {
      return locations.find((location) => location.id === route.locationId)?.organization_id ?? detail?.organization.id ?? null;
    }
    return detail?.organization.id ?? organizations[0]?.id ?? null;
  }, [contactDetail, contacts, detail, locations, organizations, route]);

  useEffect(() => {
    if (!activeOrganizationId) {
      setDetail(null);
      setContactDetail(null);
      setTouchpoints([]);
      setDuplicateReviews([]);
      setOperationsHub(null);
      setOperationsHubLoadedOrganizationId(null);
      setDuplicateReviewsLoadedOrganizationId(null);
      setOrganizationContinuity(null);
      setOrganizationContinuityError("");
      setContactContinuity(null);
      setContactContinuityError("");
      return;
    }
    let cancelled = false;
    setWorkspaceLoading(true);
    setDuplicateReviews([]);
    setOperationsHub(null);
    setOperationsHubLoadedOrganizationId(null);
    setDuplicateReviewsLoadedOrganizationId(null);
    void loadWorkspace(token, activeOrganizationId)
      .then(({ detail, touchpoints }) => {
        if (cancelled) return;
        setDetail(detail);
        setTouchpoints(touchpoints);
        setWorkspaceError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        setTouchpoints([]);
        setWorkspaceError(messageFor(error, "We couldn't load this organization right now."));
      })
      .finally(() => !cancelled && setWorkspaceLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, token]);

  useEffect(() => {
    if (activeTab !== "operations" || !detail) {
      setOperationsHubLoading(false);
      return;
    }
    if (operationsHubLoadedOrganizationId === detail.organization.id) {
      return;
    }
    let cancelled = false;
    setOperationsHubLoading(true);
    void getOrganizationOperationsHub(token, detail.organization.id)
      .then((payload) => {
        if (cancelled) return;
        setOperationsHub(payload);
        setOperationsHubLoadedOrganizationId(detail.organization.id);
      })
      .catch((error) => {
        if (cancelled) return;
        setOperationsHub(null);
        setPageError(messageFor(error, "We couldn't load the operations summary right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setOperationsHubLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, detail, operationsHubLoadedOrganizationId, token]);

  useEffect(() => {
    if (activeTab !== "duplicates" || !detail || !canManage) {
      setDuplicateReviewsLoading(false);
      return;
    }
    if (duplicateReviewsLoadedOrganizationId === detail.organization.id) {
      return;
    }
    let cancelled = false;
    setDuplicateReviewsLoading(true);
    void loadOrganizationDuplicateReviews(token, detail)
      .then((reviews) => {
        if (cancelled) return;
        setDuplicateReviews(reviews);
        setDuplicateReviewsLoadedOrganizationId(detail.organization.id);
      })
      .catch((error) => {
        if (cancelled) return;
        setDuplicateReviews([]);
        setPageError(messageFor(error, "We couldn't load duplicate reviews right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setDuplicateReviewsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canManage, detail, duplicateReviewsLoadedOrganizationId, token]);

  useEffect(() => {
    if (!activeOrganizationId) {
      setOrganizationContinuity(null);
      setOrganizationContinuityLoading(false);
      setOrganizationContinuityError("");
      return;
    }
    let cancelled = false;
    setOrganizationContinuityLoading(true);
    setOrganizationContinuityError("");
    void getOrganizationRelationshipContinuity(token, activeOrganizationId)
      .then((payload) => {
        if (cancelled) return;
        setOrganizationContinuity(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setOrganizationContinuity(null);
        setOrganizationContinuityError(messageFor(error, "We couldn't load relationship continuity right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setOrganizationContinuityLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, token]);

  useEffect(() => {
    if (route.view !== "contacts" || !selectedContactId) {
      setContactDetail(null);
      setContactDetailError("");
      setContactDetailLoading(false);
      setContactContinuity(null);
      setContactContinuityError("");
      setContactContinuityLoading(false);
      return;
    }
    let cancelled = false;
    setContactDetailLoading(true);
    setContactDetailError("");
    void getDirectoryContactDetail(token, selectedContactId)
      .then((payload) => {
        if (cancelled) return;
        setContactDetail(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setContactDetail(null);
        setContactDetailError(messageFor(error, "We couldn't refresh the full contact detail right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setContactDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route.view, selectedContactId, token]);

  useEffect(() => {
    if (route.view !== "contacts" || !selectedContactId) {
      setContactContinuity(null);
      setContactContinuityError("");
      setContactContinuityLoading(false);
      return;
    }
    let cancelled = false;
    setContactContinuityLoading(true);
    setContactContinuityError("");
    void getContactRelationshipContinuity(token, selectedContactId)
      .then((payload) => {
        if (cancelled) return;
        setContactContinuity(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setContactContinuity(null);
        setContactContinuityError(messageFor(error, "We couldn't load contact continuity right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setContactContinuityLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route.view, selectedContactId, token]);

  const organizationShoots = useMemo(() => {
    if (!detail) return [];
    const shoots = new Map<string, OrganizationDetail["recent_shoots"][number] | NonNullable<OrganizationDetail["next_shoot"]>>();
    if (detail.next_shoot) shoots.set(detail.next_shoot.id, detail.next_shoot);
    for (const shoot of detail.recent_shoots) if (!shoots.has(shoot.id)) shoots.set(shoot.id, shoot);
    return [...shoots.values()];
  }, [detail]);
  const continuityBundle = route.view === "contacts" ? contactContinuity : organizationContinuity;
  const continuityLoading = route.view === "contacts" ? contactContinuityLoading : organizationContinuityLoading;
  const continuityError = route.view === "contacts" ? contactContinuityError : organizationContinuityError;

  const intro = getDirectoryIntro(route.view, companyDirectoryCount);

  function pushRoute(next: Partial<RouteState>) {
    const merged: RouteState = {
      view: next.view ?? route.view,
      organizationId: next.organizationId !== undefined ? next.organizationId : route.organizationId,
      contactId: next.contactId !== undefined ? next.contactId : route.contactId,
      locationId: next.locationId !== undefined ? next.locationId : route.locationId,
      tab: next.tab ?? route.tab
    };
    if (!canManage && merged.tab === "duplicates") merged.tab = "profile";
    const params = new URLSearchParams();
    params.set("view", merged.view);
    params.set("tab", merged.tab);
    if (merged.organizationId) params.set("organization", merged.organizationId);
    if (merged.contactId) params.set("contact", merged.contactId);
    if (merged.locationId) params.set("location", merged.locationId);
    const root = getDirectoryRouteRoot(merged.view, defaultContactAudience);
    window.location.hash = `#${root}?${params.toString()}`;
  }

  async function refreshRail() {
    const payload = await loadDirectoryRailSlice(token, route.view, {
      search,
      accountType,
      activeStatus,
      contactStatus,
      roleCategory,
      operationalImportance,
      decisionInfluence,
      primaryInternalOwnerUserId: primaryInternalOwnerUserId || null,
      relationshipOwnershipState,
      hasPhotoOnly,
      hasLogoOnly,
      needsReviewOnly,
      myContactsOnly
    });
    setOrganizations(payload.organizations);
    setContacts(payload.contacts);
    setLocations(payload.locations);
  }

  async function refreshWorkspace(organizationId: string) {
    const payload = await loadWorkspace(token, organizationId);
    setDetail(payload.detail);
    setTouchpoints(payload.touchpoints);
    setOperationsHubLoadedOrganizationId(null);
    setDuplicateReviewsLoadedOrganizationId(null);
    if (activeTab === "operations") {
      await refreshOperationsHub(organizationId);
    }
    if (activeTab === "duplicates" && canManage) {
      await refreshDuplicateReviewQueue(payload.detail);
    }
    setWorkspaceError("");
  }

  async function refreshContactDetail(contactId: string) {
    const payload = await getDirectoryContactDetail(token, contactId);
    setContactDetail(payload);
    setContactDetailError("");
  }

  async function refreshOrganizationContinuity(organizationId: string) {
    const payload = await getOrganizationRelationshipContinuity(token, organizationId);
    setOrganizationContinuity(payload);
    setOrganizationContinuityError("");
  }

  async function refreshContactContinuity(contactId: string) {
    const payload = await getContactRelationshipContinuity(token, contactId);
    setContactContinuity(payload);
    setContactContinuityError("");
  }

  async function refreshFocusedWorkspace(organizationId: string) {
    const refreshers: Promise<unknown>[] = [refreshWorkspace(organizationId), refreshOrganizationContinuity(organizationId)];
    if (route.view === "contacts" && selectedContactId) {
      refreshers.push(refreshContactDetail(selectedContactId));
      refreshers.push(refreshContactContinuity(selectedContactId));
    }
    await Promise.all(refreshers);
  }

  async function refreshAll(organizationId: string) {
    const refreshers: Promise<unknown>[] = [refreshRail(), refreshWorkspace(organizationId), refreshOrganizationContinuity(organizationId)];
    if (route.view === "contacts" && selectedContactId) {
      refreshers.push(refreshContactDetail(selectedContactId));
      refreshers.push(refreshContactContinuity(selectedContactId));
    }
    await Promise.all(refreshers);
  }

  function requireOrganization() {
    if (!activeOrganizationId) {
      setPageError("Select an organization first so the action has a place to attach.");
      return null;
    }
    return activeOrganizationId;
  }

  async function runAction(action: () => Promise<void>, drawer = false) {
    setActionBusy(true);
    if (drawer) setDrawerError("");
    else setPageError("");
    try {
      await action();
      if (drawer) setDrawerState(null);
    } catch (error) {
      const message = messageFor(error, "That directory action could not be completed.");
      if (drawer) setDrawerError(message);
      else setPageError(message);
    } finally {
      setActionBusy(false);
    }
  }

  async function ensureOrganizationsLoaded() {
    if (organizations.length) {
      return organizations;
    }
    const payload = await listOrganizations(token, { activeStatus: "active" });
    setOrganizations(payload.organizations);
    return payload.organizations;
  }

  async function ensureContactsLoaded() {
    if (contacts.length) {
      return contacts;
    }
    const payload = await listDirectoryContacts(token, {
      search,
      accountType,
      activeStatus,
      contactStatus,
      roleCategory,
      operationalImportance,
      decisionInfluence,
      primaryInternalOwnerUserId: primaryInternalOwnerUserId || null,
      relationshipOwnershipState,
      hasPhoto: hasPhotoOnly,
      hasLogo: hasLogoOnly,
      needsReview: needsReviewOnly,
      myContactsOnly
    });
    setContacts(payload.contacts);
    return payload.contacts;
  }

  async function refreshOperationsHub(organizationId: string) {
    const payload = await getOrganizationOperationsHub(token, organizationId);
    setOperationsHub(payload);
    setOperationsHubLoadedOrganizationId(organizationId);
  }

  async function refreshDuplicateReviewQueue(nextDetail: OrganizationDetail) {
    if (!canManage) {
      setDuplicateReviews([]);
      setDuplicateReviewsLoadedOrganizationId(null);
      return;
    }
    const reviews = await loadOrganizationDuplicateReviews(token, nextDetail);
    setDuplicateReviews(reviews);
    setDuplicateReviewsLoadedOrganizationId(nextDetail.organization.id);
  }

  function openDrawer(nextDrawer: DrawerState) {
    setDrawerError("");
    if (nextDrawer.type === "import-contacts" || nextDrawer.type === "link-existing-contact") {
      setActionBusy(true);
      const prepare =
        nextDrawer.type === "import-contacts" ? ensureOrganizationsLoaded() : ensureContactsLoaded();
      void prepare
        .then(() => {
          setPageError("");
          setDrawerState(nextDrawer);
        })
        .catch((error) => {
          setPageError(messageFor(error, "We couldn't prepare that directory action right now."));
        })
        .finally(() => {
          setActionBusy(false);
        });
      return;
    }
    setDrawerState(nextDrawer);
  }

  return (
    <div className="workspace-shell">
      <section className="request-card page-intro page-intro--workspace">
        <div className="page-intro__body">
          <p className="eyebrow">{intro.eyebrow}</p>
          <h2>{intro.title}</h2>
          <p>{intro.body}</p>
        </div>
      </section>
      {pageError ? <div className="request-card directory-page-error">{pageError}</div> : null}
      <div className="directory-layout">
        <DirectoryRail
          view={route.view}
          search={search}
          accountType={accountType}
          activeStatus={activeStatus}
          contactStatus={contactStatus}
          roleCategory={roleCategory}
          operationalImportance={operationalImportance}
          decisionInfluence={decisionInfluence}
          primaryInternalOwnerUserId={primaryInternalOwnerUserId}
          relationshipOwnershipState={relationshipOwnershipState}
          hasPhotoOnly={hasPhotoOnly}
          hasLogoOnly={hasLogoOnly}
          needsReviewOnly={needsReviewOnly}
          myContactsOnly={myContactsOnly}
          ownerOptions={ownerOptions}
          organizations={organizations}
          contacts={visibleContacts}
          locations={locations}
          contactAudience={contactAudience}
          companyDirectoryCount={companyDirectoryCount}
          externalDirectoryCount={externalDirectoryCount}
          loading={railLoading}
          activeOrganizationId={activeOrganizationId}
          activeContactId={selectedContactId}
          activeLocationId={selectedLocationId}
          canManage={canManage}
          onViewChange={(view) => pushRoute({ view, tab: view === "organizations" ? "profile" : "relationships", contactId: view === "contacts" ? route.contactId : null, locationId: view === "locations" ? route.locationId : null })}
          onSearchChange={setSearch}
          onAccountTypeChange={setAccountType}
          onActiveStatusChange={setActiveStatus}
          onContactStatusChange={setContactStatus}
          onRoleCategoryChange={setRoleCategory}
          onOperationalImportanceChange={setOperationalImportance}
          onDecisionInfluenceChange={setDecisionInfluence}
          onPrimaryInternalOwnerChange={setPrimaryInternalOwnerUserId}
          onRelationshipOwnershipStateChange={setRelationshipOwnershipState}
          onHasPhotoOnlyChange={setHasPhotoOnly}
          onHasLogoOnlyChange={setHasLogoOnly}
          onNeedsReviewOnlyChange={setNeedsReviewOnly}
          onMyContactsOnlyChange={setMyContactsOnly}
          onContactAudienceChange={setContactAudience}
          onSelectOrganization={(organizationId) => pushRoute({ view: "organizations", organizationId, contactId: null, locationId: null, tab: "profile" })}
          onSelectContact={(contactId) => pushRoute({ view: "contacts", organizationId: contacts.find((contact) => contact.id === contactId)?.organization_id ?? activeOrganizationId, contactId, locationId: null, tab: "relationships" })}
          onSelectLocation={(locationId) => pushRoute({ view: "locations", organizationId: locations.find((location) => location.id === locationId)?.organization_id ?? activeOrganizationId, contactId: null, locationId, tab: "relationships" })}
          onImportContacts={() => openDrawer({ type: "import-contacts" })}
          onCreateOrganization={() => openDrawer({ type: "create-organization" })}
          onCreateContact={() => requireOrganization() && openDrawer({ type: "create-contact" })}
          onCreateLocation={() => requireOrganization() && openDrawer({ type: "create-location" })}
        />
      <DirectoryWorkspace
        token={token}
        currentUser={currentUser}
        view={route.view}
        detail={detail}
          contactDetail={contactDetail}
          loading={workspaceLoading}
          contactDetailLoading={contactDetailLoading}
          error={workspaceError}
          contactDetailError={contactDetailError}
          continuity={continuityBundle}
          continuityLoading={continuityLoading}
          continuityError={continuityError}
          activeTab={activeTab}
          canManage={canManage}
          canManageSchoolFoundation={canManageSchoolRecords}
          touchpoints={touchpoints}
          duplicateReviews={duplicateReviews}
          duplicateReviewsLoading={duplicateReviewsLoading}
          operationsHub={operationsHub}
          operationsHubLoading={operationsHubLoading}
          selectedContactId={selectedContactId}
          selectedLocationId={selectedLocationId}
          actionBusy={actionBusy}
          onTabChange={(tab) => pushRoute({ tab })}
          onSelectContact={(contactId) => pushRoute({ view: "contacts", contactId, tab: "relationships" })}
          onSelectLocation={(locationId) => pushRoute({ view: "locations", locationId, tab: "relationships" })}
          onSelectOrganization={(organizationId) => pushRoute({ view: "organizations", organizationId, contactId: null, locationId: null, tab: "profile" })}
          onOpenImportContacts={() => openDrawer({ type: "import-contacts" })}
          onCreateContact={() => openDrawer({ type: "create-contact" })}
          onLinkExistingContact={() => openDrawer({ type: "link-existing-contact" })}
          onCreateLocation={() => openDrawer({ type: "create-location" })}
          onEditOrganization={() => openDrawer({ type: "edit-organization" })}
          onEditSchoolProfile={() => openDrawer({ type: "edit-school-profile" })}
          onEditSchoolContactCategories={(contact) => openDrawer({ type: "edit-school-contact-categories", contact })}
          onCreateSchoolRule={() => openDrawer({ type: "create-school-rule" })}
          onEditSchoolRule={(rule) => openDrawer({ type: "edit-school-rule", rule })}
          onCreateSchoolNote={() => openDrawer({ type: "create-school-note" })}
          onEditContact={(contact) => openDrawer({ type: "edit-contact", contact })}
          onToggleContactStatus={(contact) => runAction(async () => {
            if (contact.active_status === "active") await archiveOrganizationContactRecord(token, contact.id);
            else await reactivateOrganizationContactRecord(token, contact.id);
            if (activeOrganizationId) await refreshAll(activeOrganizationId);
          })}
          onMakeContactPrimary={(contact) => runAction(async () => {
            const organizationId = requireOrganization();
            if (!organizationId) return;
            await attachContactToOrganizationRecord(token, organizationId, { contact_id: contact.id, relationship_role: contact.relationship_role ?? "general", is_primary: true });
            await refreshAll(organizationId);
          })}
          onLogTouchpoint={(contact) => openDrawer({ type: "touchpoint", contact: contact ?? null })}
          onAttachContactToLocation={(contact) => openDrawer({ type: "attach-location", contact })}
          onAttachContactToShoot={(contact) => openDrawer({ type: "attach-shoot", contact })}
          onEditLocation={(location) => openDrawer({ type: "edit-location", location })}
          onToggleLocationStatus={(location) => runAction(async () => {
            if (location.active_status === "active") await archiveOrganizationLocationRecord(token, location.id);
            else await reactivateOrganizationLocationRecord(token, location.id);
            if (activeOrganizationId) await refreshAll(activeOrganizationId);
          })}
          onDetachContactFromLocation={(locationId, contactId) => runAction(async () => {
            await detachContactFromLocationRecord(token, locationId, contactId);
            if (activeOrganizationId) await refreshAll(activeOrganizationId);
          })}
          onCreateDuplicateReview={(contact) => openDrawer({ type: "duplicate-review", contact: contact ?? null })}
          onUpdateDuplicateReview={(review, update) => runAction(async () => {
            await updateDirectoryDuplicateReviewRecord(token, review.id, update);
            if (activeOrganizationId) await refreshWorkspace(activeOrganizationId);
          })}
          onCreateTouchpointPlan={(contact) => openDrawer({ type: "touchpoint-plan", contact: contact ?? null })}
          onCreateRelationshipMemory={(contact) => openDrawer({ type: "relationship-memory", contact: contact ?? null })}
          onCreateRelationshipFollowUp={(contact) => openDrawer({ type: "relationship-follow-up", contact: contact ?? null })}
          onUpdateTouchpointPlan={(plan, update) => runAction(async () => {
            await updateDirectoryTouchpointPlanRecord(token, plan.id, update);
            if (activeOrganizationId) await refreshFocusedWorkspace(activeOrganizationId);
          })}
          onUpdateRelationshipMemory={(memory, update) => runAction(async () => {
            await updateDirectoryRelationshipMemoryRecord(token, memory.id, update);
            if (activeOrganizationId) await refreshFocusedWorkspace(activeOrganizationId);
          })}
          onUpdateRelationshipFollowUp={(followUp, update) => runAction(async () => {
            await updateDirectoryRelationshipFollowUpRecord(token, followUp.id, update);
            if (activeOrganizationId) await refreshFocusedWorkspace(activeOrganizationId);
          })}
        />
      </div>
      <DirectoryDrawer open={Boolean(drawerState)} title={drawerTitle(drawerState)} subtitle={drawerSubtitle(drawerState)} onClose={() => setDrawerState(null)}>
        {renderDrawer({
          drawerState,
          detail,
          contacts,
          organizations,
          ownerOptions,
          continuity: continuityBundle,
          organizationId: activeOrganizationId,
          organizationShoots,
          token,
          actionBusy,
          drawerError,
          refreshAll,
          refreshWorkspace,
          refreshFocusedWorkspace,
          closeDrawer: () => setDrawerState(null),
          pushRoute,
          runAction
        })}
      </DirectoryDrawer>
    </div>
  );
}

type DrawerRenderProps = {
  drawerState: DrawerState | null;
  detail: OrganizationDetail | null;
  contacts: DirectoryContactSummary[];
  organizations: OrganizationSummary[];
  ownerOptions: DirectoryOwnerOption[];
  continuity: DirectoryRelationshipContinuityBundle | null;
  organizationId: string | null;
  organizationShoots: Array<OrganizationDetail["recent_shoots"][number] | NonNullable<OrganizationDetail["next_shoot"]>>;
  token: string;
  actionBusy: boolean;
  drawerError: string;
  refreshAll: (organizationId: string) => Promise<void>;
  refreshWorkspace: (organizationId: string) => Promise<void>;
  refreshFocusedWorkspace: (organizationId: string) => Promise<void>;
  closeDrawer: () => void;
  pushRoute: (next: Partial<RouteState>) => void;
  runAction: (action: () => Promise<void>, drawer?: boolean) => Promise<void>;
};

function renderDrawer({ drawerState, detail, contacts, organizations, ownerOptions, continuity, organizationId, organizationShoots, token, actionBusy, drawerError, refreshAll, refreshWorkspace, refreshFocusedWorkspace, closeDrawer, pushRoute, runAction }: DrawerRenderProps) {
  if (!drawerState) return null;
  if (drawerState.type === "create-organization") {
    return <OrganizationEditorForm submitLabel="Create organization" submitting={actionBusy} error={drawerError} onUploadLogo={(file) => uploadOrganizationLogoFile(token, null, file)} onCancel={closeDrawer} onSubmit={(input: OrganizationCreateInput) => runAction(async () => {
      const response = await createOrganizationRecord(token, input);
      await refreshAll(response.organization.id);
      pushRoute({ view: "organizations", organizationId: response.organization.id, contactId: null, locationId: null, tab: "profile" });
    }, true)} />;
  }
  if (drawerState.type === "import-contacts") {
    return (
      <DirectoryContactImportWorkflow
        token={token}
        organizations={organizations}
        initialDefaultOrganizationId={organizationId}
        onApplied={async (session) => {
          await refreshRailAndWorkspaceAfterImport(session, organizationId, refreshAll, pushRoute);
        }}
        onCancel={closeDrawer}
      />
    );
  }
  if (!organizationId || !detail) return <div className="drawer-empty">Choose an organization to continue.</div>;
  if (drawerState.type === "edit-organization") return <OrganizationEditorForm initialValue={{ canonical_name: detail.organization.canonical_name, display_name: detail.organization.display_name, logo_url: detail.organization.logo_url, account_type: detail.organization.account_type, aliases: detail.organization.aliases, notes: detail.organization.notes }} submitLabel="Save organization" submitting={actionBusy} error={drawerError} onUploadLogo={(file) => uploadOrganizationLogoFile(token, organizationId, file)} onCancel={closeDrawer} onSubmit={(input: OrganizationCreateInput) => runAction(async () => { await updateOrganizationRecord(token, organizationId, input); await refreshAll(organizationId); }, true)} />;
  if (drawerState.type === "edit-school-profile") return <SchoolProfileForm initialValue={detail.school_profile ?? null} ownerOptions={ownerOptions} locations={detail.locations} submitLabel="Save school profile" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await updateSchoolProfileRecord(token, organizationId, input); await refreshWorkspace(organizationId); }, true)} />;
  if (drawerState.type === "edit-school-contact-categories") return <SchoolContactCategoriesForm contact={drawerState.contact} submitLabel="Save school roles" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await updateSchoolContactCategoriesRecord(token, organizationId, drawerState.contact.id, input); await refreshWorkspace(organizationId); }, true)} />;
  if (drawerState.type === "create-school-rule") return <SchoolRuleForm submitLabel="Create school rule" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await createSchoolRuleRecord(token, organizationId, input as Parameters<typeof createSchoolRuleRecord>[2]); await refreshWorkspace(organizationId); }, true)} />;
  if (drawerState.type === "edit-school-rule") return <SchoolRuleForm initialValue={drawerState.rule} submitLabel="Save school rule" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await updateSchoolRuleRecord(token, organizationId, drawerState.rule.id, input); await refreshWorkspace(organizationId); }, true)} />;
  if (drawerState.type === "create-school-note") return <SchoolNoteForm submitLabel="Add school note" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await createSchoolNoteRecord(token, organizationId, input); await refreshWorkspace(organizationId); }, true)} />;
  if (drawerState.type === "create-contact") return <ContactEditorForm ownerOptions={ownerOptions} submitLabel="Create contact" submitting={actionBusy} error={drawerError} onUploadPhoto={(file) => uploadOrganizationContactPhotoFile(token, null, file)} onCancel={closeDrawer} onSubmit={(input: OrganizationContactCreateInput) => runAction(async () => { await createOrganizationContactRecord(token, organizationId, input); await refreshAll(organizationId); pushRoute({ view: "contacts", tab: "relationships" }); }, true)} />;
  if (drawerState.type === "edit-contact") return <ContactEditorForm ownerOptions={ownerOptions} initialValue={drawerState.contact} submitLabel="Save contact" submitting={actionBusy} error={drawerError} onUploadPhoto={(file) => uploadOrganizationContactPhotoFile(token, drawerState.contact.id, file)} onCancel={closeDrawer} onSubmit={(input: OrganizationContactCreateInput) => runAction(async () => { await updateOrganizationContactRecord(token, drawerState.contact.id, input); await refreshAll(organizationId); }, true)} />;
  if (drawerState.type === "link-existing-contact") return <OrganizationContactLinkForm contacts={contacts} existingContactIds={detail.contacts.map((contact) => contact.id)} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input: DirectoryRelationshipAttachInput) => runAction(async () => { await attachContactToOrganizationRecord(token, organizationId, input); await refreshAll(organizationId); pushRoute({ view: "contacts", contactId: input.contact_id, tab: "relationships" }); }, true)} />;
  if (drawerState.type === "create-location") return <LocationEditorForm submitLabel="Create location" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input: OrganizationLocationCreateInput) => runAction(async () => { await createOrganizationLocationRecord(token, organizationId, input); await refreshAll(organizationId); pushRoute({ view: "locations", tab: "relationships" }); }, true)} />;
  if (drawerState.type === "edit-location") return <LocationEditorForm initialValue={{ location_name: drawerState.location.location_name, address_line_1: drawerState.location.address_line_1 ?? "", address_line_2: drawerState.location.address_line_2 ?? "", city: drawerState.location.city ?? "", state: drawerState.location.state ?? "", zip: drawerState.location.zip ?? "", maps_label: drawerState.location.maps_label ?? "", notes: drawerState.location.notes ?? "" }} submitLabel="Save location" submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input: OrganizationLocationCreateInput) => runAction(async () => { await updateOrganizationLocationRecord(token, drawerState.location.id, input); await refreshAll(organizationId); }, true)} />;
  if (drawerState.type === "touchpoint") return <DirectoryCommunicationLogForm contacts={detail.contacts} locations={detail.locations} shoots={organizationShoots} ownerOptions={ownerOptions} touchpointPlans={continuity?.touchpoint_plans ?? []} initialContactId={drawerState.contact?.id ?? null} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input: DirectoryTouchpointCreateInput) => runAction(async () => { await createOrganizationTouchpointRecord(token, organizationId, input); await refreshFocusedWorkspace(organizationId); pushRoute({ tab: "touchpoints" }); }, true)} />;
  if (drawerState.type === "touchpoint-plan") return <DirectoryTouchpointPlanForm contacts={detail.contacts} locations={detail.locations} shoots={organizationShoots} ownerOptions={ownerOptions} touchpointTemplates={continuity?.touchpoint_templates ?? []} initialContactId={drawerState.contact?.id ?? null} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await createDirectoryTouchpointPlanRecord(token, organizationId, input); await refreshFocusedWorkspace(organizationId); pushRoute({ tab: "touchpoints" }); }, true)} />;
  if (drawerState.type === "relationship-memory") return <DirectoryRelationshipMemoryForm contacts={detail.contacts} locations={detail.locations} initialContactId={drawerState.contact?.id ?? null} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await createDirectoryRelationshipMemoryRecord(token, organizationId, input); await refreshFocusedWorkspace(organizationId); pushRoute({ tab: "touchpoints" }); }, true)} />;
  if (drawerState.type === "relationship-follow-up") return <DirectoryRelationshipFollowUpForm contacts={detail.contacts} locations={detail.locations} shoots={organizationShoots} ownerOptions={ownerOptions} initialContactId={drawerState.contact?.id ?? null} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input) => runAction(async () => { await createDirectoryRelationshipFollowUpRecord(token, organizationId, input); await refreshFocusedWorkspace(organizationId); pushRoute({ tab: "touchpoints" }); }, true)} />;
  if (drawerState.type === "attach-location") return <LocationAttachForm contact={drawerState.contact} locations={detail.locations} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(locationId, input) => runAction(async () => { await attachContactToLocationRecord(token, locationId, input); await refreshAll(organizationId); pushRoute({ view: "contacts", contactId: drawerState.contact.id, tab: "relationships" }); }, true)} />;
  if (drawerState.type === "attach-shoot") return <ShootAttachForm contact={drawerState.contact} shoots={organizationShoots} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(shootId, input) => runAction(async () => { await attachContactToShootRecord(token, shootId, input); await refreshFocusedWorkspace(organizationId); pushRoute({ view: "contacts", contactId: drawerState.contact.id, tab: "linked_shoots" }); }, true)} />;
  if (drawerState.type === "duplicate-review") return <DuplicateReviewForm contacts={detail.contacts} initialPrimaryContactId={drawerState.contact?.id ?? null} submitting={actionBusy} error={drawerError} onCancel={closeDrawer} onSubmit={(input: DirectoryDuplicateReviewCreateInput) => runAction(async () => { await createDirectoryDuplicateReviewRecord(token, input); await refreshWorkspace(organizationId); pushRoute({ tab: "duplicates" }); }, true)} />;
  return null;
}

async function loadWorkspace(token: string, organizationId: string) {
  const [detailPayload, touchpointPayload] = await Promise.all([
    getOrganizationDetail(token, organizationId),
    listOrganizationTouchpoints(token, organizationId)
  ]);
  return {
    detail: detailPayload,
    touchpoints: [...touchpointPayload.touchpoints].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))
  };
}

async function loadDirectoryRailSlice(token: string, view: DirectoryView, filters: DirectoryRailFilters) {
  if (view === "contacts") {
    const contactPayload = await listDirectoryContacts(token, {
      search: filters.search,
      accountType: filters.accountType,
      activeStatus: filters.activeStatus,
      contactStatus: filters.contactStatus,
      roleCategory: filters.roleCategory,
      operationalImportance: filters.operationalImportance,
      decisionInfluence: filters.decisionInfluence,
      primaryInternalOwnerUserId: filters.primaryInternalOwnerUserId,
      relationshipOwnershipState: filters.relationshipOwnershipState,
      hasPhoto: filters.hasPhotoOnly,
      hasLogo: filters.hasLogoOnly,
      needsReview: filters.needsReviewOnly,
      myContactsOnly: filters.myContactsOnly
    });
    return {
      organizations: [] as OrganizationSummary[],
      contacts: contactPayload.contacts,
      locations: [] as DirectoryLocationSummary[]
    };
  }

  if (view === "locations") {
    const locationPayload = await listDirectoryLocations(token, {
      search: filters.search,
      accountType: filters.accountType,
      activeStatus: filters.activeStatus
    });
    return {
      organizations: [] as OrganizationSummary[],
      contacts: [] as DirectoryContactSummary[],
      locations: locationPayload.locations
    };
  }

  const organizationPayload = await listOrganizations(token, {
    search: filters.search,
    accountType: filters.accountType,
    activeStatus: filters.activeStatus
  });
  return {
    organizations: organizationPayload.organizations,
    contacts: [] as DirectoryContactSummary[],
    locations: [] as DirectoryLocationSummary[]
  };
}

async function loadOrganizationDuplicateReviews(token: string, detail: OrganizationDetail) {
  const reviewPayload = await listDirectoryDuplicateReviews(token);
  const organizationContactIds = new Set(detail.contacts.map((contact) => contact.id));
  return reviewPayload.reviews.filter(
    (review) =>
      (review.primary_contact_id && organizationContactIds.has(review.primary_contact_id)) ||
      (review.suspected_duplicate_contact_id && organizationContactIds.has(review.suspected_duplicate_contact_id))
  );
}

function drawerTitle(drawerState: DrawerState | null) {
  switch (drawerState?.type) {
    case "create-organization": return "Create organization";
    case "edit-organization": return "Edit organization";
    case "edit-school-profile": return "Edit school profile";
    case "edit-school-contact-categories": return `School roles for ${drawerState.contact.full_name}`;
    case "create-school-rule": return "Add school rule";
    case "edit-school-rule": return `Edit ${drawerState.rule.title}`;
    case "create-school-note": return "Add school note";
    case "create-contact": return "Create contact";
    case "edit-contact": return `Edit ${drawerState.contact.full_name}`;
    case "link-existing-contact": return "Link existing contact";
    case "create-location": return "Create location";
    case "edit-location": return `Edit ${drawerState.location.location_name}`;
    case "touchpoint": return drawerState.contact ? `Log communication for ${drawerState.contact.full_name}` : "Log communication";
    case "touchpoint-plan": return drawerState.contact ? `Plan touchpoint for ${drawerState.contact.full_name}` : "Plan touchpoint";
    case "relationship-memory": return drawerState.contact ? `Add memory for ${drawerState.contact.full_name}` : "Add relationship memory";
    case "relationship-follow-up": return drawerState.contact ? `Add follow-up for ${drawerState.contact.full_name}` : "Add follow-up";
    case "attach-location": return `Attach ${drawerState.contact.full_name} to a location`;
    case "attach-shoot": return `Attach ${drawerState.contact.full_name} to a shoot`;
    case "import-contacts": return "Import Contacts";
    case "duplicate-review": return drawerState.contact ? `Review duplicate for ${drawerState.contact.full_name}` : "Create duplicate review";
    default: return "Directory action";
  }
}

function drawerSubtitle(drawerState: DrawerState | null) {
  switch (drawerState?.type) {
    case "edit-school-profile": return "Keep school identity, ownership, location, and health structured instead of spreading it across notes and touchpoints.";
    case "edit-school-contact-categories": return "Tag the exact school-facing roles this contact covers so teams can see who handles what.";
    case "create-school-rule": return "Store school-specific operational rules as structured settings, not a buried note.";
    case "edit-school-rule": return "Adjust the active rule while keeping its type and timeline traceable.";
    case "create-school-note": return "Add a dated school note to the timeline without overwriting the canonical school profile.";
    case "link-existing-contact": return "Reuse an existing person record and keep the relationship metadata attached to the organization.";
    case "touchpoint": return "Log a meaningful interaction once so future operators can see what was said, promised, and owned.";
    case "touchpoint-plan": return "Planned relationship moments should stay visible until they happen, are skipped with reason, or go overdue.";
    case "relationship-memory": return "Store reusable context that improves the next interaction instead of burying it in a one-off note.";
    case "relationship-follow-up": return "Turn owed promises and next steps into visible work with an owner and due date.";
    case "import-contacts": return "Preview a CSV, review duplicate warnings, and import only the rows that are ready.";
    case "duplicate-review": return "This phase creates safe review scaffolding only. Contact merge execution stays deferred.";
    default: return "Use the drawer for focused actions instead of reopening page-wide forms.";
  }
}

async function refreshRailAndWorkspaceAfterImport(
  session: { default_organization_id: string | null; rows: Array<{ resolved_organization_id: string | null }> },
  activeOrganizationId: string | null,
  refreshAll: (organizationId: string) => Promise<void>,
  pushRoute: (next: Partial<RouteState>) => void
) {
  const focusOrganizationId =
    activeOrganizationId ??
    session.default_organization_id ??
    session.rows.find((row) => row.resolved_organization_id)?.resolved_organization_id ??
    null;

  if (focusOrganizationId) {
    await refreshAll(focusOrganizationId);
    pushRoute({
      view: "contacts",
      organizationId: focusOrganizationId,
      contactId: null,
      locationId: null,
      tab: "relationships"
    });
  }
}

function parseOrganizationsHash(defaultView: DirectoryView): RouteState {
  const root = window.location.hash.replace(/^#/, "").split("?")[0] ?? "";
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  const viewParam = params.get("view");
  return {
    view:
      viewParam === "contacts" || viewParam === "locations" || viewParam === "organizations"
        ? viewParam
        : root === "contacts" || root === "directory/contacts" || root === "directory/internal"
          ? "contacts"
          : root === "locations" || root === "directory/locations"
            ? "locations"
          : params.get("contact")
            ? "contacts"
            : params.get("location")
              ? "locations"
              : defaultView,
    organizationId: params.get("organization"),
    contactId: params.get("contact"),
    locationId: params.get("location"),
    tab:
      params.get("tab") === "profile" ||
      params.get("tab") === "relationships" ||
      params.get("tab") === "operations" ||
      params.get("tab") === "touchpoints" ||
      params.get("tab") === "linked_shoots" ||
      params.get("tab") === "duplicates"
        ? (params.get("tab") as DirectoryWorkspaceTab)
        : params.get("contact") || params.get("location")
          ? "relationships"
          : defaultView === "contacts"
            ? "relationships"
            : "profile"
  };
}

function getDirectoryRouteRoot(view: DirectoryView, defaultContactAudience: "all" | "company") {
  if (view === "contacts") {
    return defaultContactAudience === "company" ? "directory/internal" : "directory/contacts";
  }
  if (view === "locations") {
    return "directory/locations";
  }
  return "directory/accounts";
}

function getDirectoryIntro(view: DirectoryView, companyDirectoryCount: number) {
  if (view === "contacts") {
    return {
      eyebrow: companyDirectoryCount ? "Contacts and Company Directory" : "Contacts",
      title: "Keep people visible, not buried inside accounts",
      body: companyDirectoryCount
        ? "Browse clients, school contacts, and coworkers from one contact-first workspace. The company directory shortcut stays lightweight by reusing your internal records instead of creating a separate HR system."
        : "Browse client and internal people records from one contact-first workspace. The page stays summary-first so finding the right person does not turn into a crowded registry screen."
    };
  }
  if (view === "locations") {
    return {
      eyebrow: "Directory",
      title: "Keep places tied to the people who run them",
      body: "Locations stay linked to the right organization and contact context, so operators can confirm where something is without turning Directory into another operations page."
    };
  }
  return {
    eyebrow: "Directory",
    title: "Find the right canonical record fast",
    body: "Directory owns the company’s source-of-truth records. Open a record quickly, confirm who owns it, and push deeper maintenance into drawers and secondary tabs instead of stacking everything on the first screen."
  };
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
