import type {
  OperationalExceptionActionPayload,
  OperationalExceptionDetail,
  OperationalExceptionEventRecord,
  OperationalExceptionListItem,
  OperationalExceptionOwnerOption,
  OperationalExceptionSourceModule,
  OperationalExceptionWorkspace
} from "./exceptionTypes";

/**
 * @deprecated Use the canonical exception-center contracts from `exceptionTypes.ts`.
 * Urgent-watch names remain only as migration aliases for legacy imports.
 */
export type UrgentWatchSourceModule = OperationalExceptionSourceModule;

/** @deprecated Use `OperationalExceptionOwnerOption`. */
export type UrgentWatchOwnerOption = OperationalExceptionOwnerOption;

/** @deprecated Use `OperationalExceptionEventRecord`. */
export type UrgentWatchEventRecord = OperationalExceptionEventRecord;

/** @deprecated Use `OperationalExceptionListItem`. */
export type UrgentWatchListItem = OperationalExceptionListItem;

/** @deprecated Use `OperationalExceptionDetail`. */
export type UrgentWatchDetail = OperationalExceptionDetail;

/** @deprecated Use `OperationalExceptionWorkspace`. */
export type UrgentWatchWorkspace = OperationalExceptionWorkspace;

/** @deprecated Use `OperationalExceptionActionPayload`. */
export type UrgentWatchActionPayload = OperationalExceptionActionPayload;
