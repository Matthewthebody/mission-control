export type TeamsMessageExtensionCommandId = "search";

export type TeamsMessageExtensionClickType = "preview_tap" | "open_button";

export type TeamsMessageExtensionQueryParameter = {
  name?: string;
  value?: unknown;
};

export type TeamsMessageExtensionQueryActivity = {
  type?: string;
  id?: string;
  channelId?: string;
  serviceUrl?: string;
  from?: {
    id?: string;
    name?: string;
    aadObjectId?: string;
  };
  conversation?: {
    id?: string;
    conversationType?: string;
    tenantId?: string;
  };
  channelData?: {
    tenant?: {
      id?: string;
    };
  };
  value?: {
    commandId?: string;
    parameters?: TeamsMessageExtensionQueryParameter[];
  };
};

export type TeamsMessageExtensionAttachment = {
  contentType: string;
  content: Record<string, unknown>;
  preview?: {
    contentType: string;
    content: Record<string, unknown>;
  };
};

export type TeamsMessageExtensionResponse = {
  composeExtension: {
    type: "result";
    attachmentLayout: "list";
    attachments: TeamsMessageExtensionAttachment[];
  };
};

export type TeamsMessageExtensionTelemetryItem = {
  id: string;
  event_type: string;
  result: string;
  created_at: string;
  actor_name: string | null;
  context: Record<string, unknown> | null;
};
