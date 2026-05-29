import { z } from "zod";

type OutlookContractParseOptions = {
  contractName: string;
};

export class OutlookGraphContractError extends Error {
  constructor(
    public readonly contractName: string,
    public readonly issues: string[]
  ) {
    super(`Outlook Graph contract violation for ${contractName}: ${issues.join("; ")}`);
  }
}

const graphTokenSuccessSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().min(1).optional()
  })
  .passthrough();

const graphTokenErrorSchema = z
  .object({
    error: z.string().min(1).optional(),
    error_description: z.string().optional()
  })
  .passthrough();

const graphUserProfileSchema = z
  .object({
    mail: z.string().email().nullable().optional(),
    userPrincipalName: z.string().email().nullable().optional()
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (!(value.mail || value.userPrincipalName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Microsoft Graph profile response must include mail or userPrincipalName."
      });
    }
  });

const graphCalendarSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    isDefaultCalendar: z.boolean().nullable().optional(),
    owner: z
      .object({
        name: z.string().nullable().optional(),
        address: z.string().email().nullable().optional()
      })
      .nullable()
      .optional()
  })
  .passthrough();

const graphCalendarResponseSchema = z
  .object({
    value: z.array(graphCalendarSchema).default([])
  })
  .passthrough();

const graphEventSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().nullable().optional(),
    start: z
      .object({
        dateTime: z.string().min(1).nullable().optional()
      })
      .nullable()
      .optional(),
    end: z
      .object({
        dateTime: z.string().min(1).nullable().optional()
      })
      .nullable()
      .optional(),
    organizer: z
      .object({
        emailAddress: z
          .object({
            name: z.string().nullable().optional()
          })
          .nullable()
          .optional()
      })
      .nullable()
      .optional(),
    location: z
      .object({
        displayName: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    webLink: z.string().url().nullable().optional()
  })
  .passthrough();

const graphEventResponseSchema = z
  .object({
    value: z.array(graphEventSchema).default([])
  })
  .passthrough();

const graphFolderSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().nullable().optional(),
    unreadItemCount: z.number().int().nonnegative().nullable().optional()
  })
  .passthrough();

const graphFolderResponseSchema = z
  .object({
    value: z.array(graphFolderSchema).default([])
  })
  .passthrough();

const graphMessageSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().nullable().optional(),
    receivedDateTime: z.string().min(1).nullable().optional(),
    bodyPreview: z.string().nullable().optional(),
    isRead: z.boolean().nullable().optional(),
    importance: z.string().nullable().optional(),
    parentFolderId: z.string().nullable().optional(),
    from: z
      .object({
        emailAddress: z
          .object({
            name: z.string().nullable().optional(),
            address: z.string().email().nullable().optional()
          })
          .nullable()
          .optional()
      })
      .nullable()
      .optional(),
    flag: z
      .object({
        flagStatus: z.string().nullable().optional()
      })
      .nullable()
      .optional()
  })
  .passthrough();

const graphMessageResponseSchema = z
  .object({
    value: z.array(graphMessageSchema).default([])
  })
  .passthrough();

export type GraphTokenSuccess = z.infer<typeof graphTokenSuccessSchema>;
export type GraphTokenError = z.infer<typeof graphTokenErrorSchema>;
export type GraphUserProfile = z.infer<typeof graphUserProfileSchema>;
export type GraphCalendarResponse = z.infer<typeof graphCalendarResponseSchema>;
export type GraphEventResponse = z.infer<typeof graphEventResponseSchema>;
export type GraphFolderResponse = z.infer<typeof graphFolderResponseSchema>;
export type GraphMessageResponse = z.infer<typeof graphMessageResponseSchema>;

export function parseGraphTokenSuccess(value: unknown) {
  return parseOutlookContract(graphTokenSuccessSchema, value, {
    contractName: "oauth_token_success"
  });
}

export function parseGraphTokenError(value: unknown) {
  return parseOutlookContract(graphTokenErrorSchema, value, {
    contractName: "oauth_token_error"
  });
}

export function parseGraphUserProfile(value: unknown) {
  return parseOutlookContract(graphUserProfileSchema, value, {
    contractName: "graph_profile"
  });
}

export function parseGraphCalendarResponse(value: unknown) {
  return parseOutlookContract(graphCalendarResponseSchema, value, {
    contractName: "graph_calendars"
  });
}

export function parseGraphEventResponse(value: unknown) {
  return parseOutlookContract(graphEventResponseSchema, value, {
    contractName: "graph_calendar_view"
  });
}

export function parseGraphFolderResponse(value: unknown) {
  return parseOutlookContract(graphFolderResponseSchema, value, {
    contractName: "graph_mail_folders"
  });
}

export function parseGraphMessageResponse(value: unknown) {
  return parseOutlookContract(graphMessageResponseSchema, value, {
    contractName: "graph_messages"
  });
}

function parseOutlookContract<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  options: OutlookContractParseOptions
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => issue.message);
  throw new OutlookGraphContractError(options.contractName, issues);
}
