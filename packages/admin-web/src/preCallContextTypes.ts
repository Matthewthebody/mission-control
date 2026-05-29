import type { RecordResourceObjectType } from "./recordResourcesTypes";

export type PreCallContextTone = "neutral" | "warning" | "critical" | "success";

export type PreCallContextItem = {
  label: string;
  value: string;
  detail?: string | null;
  tone?: PreCallContextTone;
};

export type PreCallContextSection = {
  key: string;
  title: string;
  items: PreCallContextItem[];
  emptyLabel?: string;
};

export type PreCallContextResourceTarget = {
  objectType: RecordResourceObjectType;
  objectId: string;
  title?: string;
  emptyLabel?: string;
};

export type PreCallContextDefinition = {
  title?: string;
  summary?: string;
  callReason?: string | null;
  callReasonLabel?: string;
  emptyLabel?: string;
  sections: PreCallContextSection[];
  resourceTarget?: PreCallContextResourceTarget | null;
};
