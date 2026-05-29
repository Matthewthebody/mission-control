import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateBody } from "../middleware/validate.js";
import { featureFlags } from "../featureFlags.js";
import { getCommunicationHistoryForRecord } from "../services/communicationHistory.js";
import {
  hideTeamsCommunicationDelivery,
  restoreTeamsCommunicationDelivery,
  setUserCommunicationAccessState,
  setUserCommunicationPostingState
} from "../services/communicationModeration.js";
import { createPostCallOutcome, getPostCallFollowUpView } from "../services/postCallFollowUp.js";
import { getTeamsEmbeddedCommunicationHub } from "../services/teamsEmbeddedCommunications.js";
import {
  createTeamsCommunicationReference,
  getTeamsCommunicationRecordView,
  queueTeamsCommunicationMessage
} from "../services/teamsMessaging.js";
import { cancelTeamsMeeting, getTeamsMeetingRecordView, upsertTeamsMeetingForRecord } from "../services/teamsMeetings.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const objectTypeSchema = z.enum(["job", "production_item", "organization", "location", "task"]);
const referenceTypeSchema = z.enum(["chat", "channel"]);
const meetingModeSchema = z.enum(["calendar_event", "standalone_online_meeting"]);
const meetingLifecycleTypeSchema = z.enum(["ad_hoc_call", "scheduled_record_meeting", "internal_review"]);
const postCallOutcomeStatusSchema = z.enum(["follow_up_open", "handled"]);
const watchFlagSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const moderationReasonSchema = z.string().trim().min(1).max(1000);

router.use(requireAuth);

router.get(
  "/teams/entry-points",
  requireFeatureFlag(featureFlags.communicationIdentityLinking, {
    message: "Communication identity linking is currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsEmbeddedCommunications, {
    message: "Teams embedded communication entry points are currently disabled."
  }),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getTeamsEmbeddedCommunicationHub(client, auth));
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/records/:objectType/:objectId/history", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        objectType: objectTypeSchema,
        objectId: z.string().uuid()
      })
      .parse(req.params);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getCommunicationHistoryForRecord(client, auth, {
        objectType: parsed.objectType,
        objectId: parsed.objectId
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/records/:objectType/:objectId/post-call", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        objectType: objectTypeSchema,
        objectId: z.string().uuid()
      })
      .parse(req.params);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getPostCallFollowUpView(client, auth, {
        objectType: parsed.objectType,
        objectId: parsed.objectId
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/records/:objectType/:objectId/meeting", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        objectType: objectTypeSchema,
        objectId: z.string().uuid()
      })
      .parse(req.params);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getTeamsMeetingRecordView(client, auth, {
        objectType: parsed.objectType,
        objectId: parsed.objectId
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/records/:objectType/:objectId", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        objectType: objectTypeSchema,
        objectId: z.string().uuid()
      })
      .parse(req.params);
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getTeamsCommunicationRecordView(client, auth, {
        objectType: parsed.objectType,
        objectId: parsed.objectId
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/moderation/deliveries/:deliveryId/hide",
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsCommunications, {
    message: "Teams messaging is currently disabled."
  }),
  validateBody(
    z.object({
      reason: moderationReasonSchema
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z.object({ deliveryId: z.string().uuid() }).parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        hideTeamsCommunicationDelivery(client, auth, { deliveryId: parsed.deliveryId, reason: req.body.reason }, getRequestMeta(req))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/moderation/deliveries/:deliveryId/restore",
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsCommunications, {
    message: "Teams messaging is currently disabled."
  }),
  validateBody(
    z.object({
      reason: z.string().trim().max(1000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z.object({ deliveryId: z.string().uuid() }).parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        restoreTeamsCommunicationDelivery(client, auth, { deliveryId: parsed.deliveryId, reason: req.body.reason ?? null }, getRequestMeta(req))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/moderation/users/:userId/posting",
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  validateBody(
    z.object({
      disabled: z.boolean(),
      reason: z.string().trim().max(1000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z.object({ userId: z.string().uuid() }).parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        setUserCommunicationPostingState(
          client,
          auth,
          {
            userId: parsed.userId,
            disabled: req.body.disabled,
            reason: req.body.reason ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/moderation/users/:userId/access",
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  validateBody(
    z.object({
      enabled: z.boolean(),
      reason: z.string().trim().max(1000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z.object({ userId: z.string().uuid() }).parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        setUserCommunicationAccessState(
          client,
          auth,
          {
            userId: parsed.userId,
            enabled: req.body.enabled,
            reason: req.body.reason ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/records/:objectType/:objectId/post-call",
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationPostCallFollowUp, {
    message: "Post-call follow-up is currently disabled."
  }),
  validateBody(
    z.object({
      meeting_id: z.string().uuid().nullable().optional(),
      summary: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(4000).nullable().optional(),
      reason_for_call: z.string().trim().max(240).nullable().optional(),
      outcome_status: postCallOutcomeStatusSchema.nullable().optional(),
      create_follow_up_task: z.boolean().optional(),
      follow_up_task_title: z.string().trim().max(240).nullable().optional(),
      follow_up_task_assignee_user_id: z.string().uuid().nullable().optional(),
      follow_up_task_due_at: z.string().trim().datetime().nullable().optional(),
      flag_issue: z.boolean().optional(),
      issue_severity: watchFlagSeveritySchema.nullable().optional(),
      issue_title: z.string().trim().max(240).nullable().optional(),
      issue_description: z.string().trim().max(4000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          objectType: objectTypeSchema,
          objectId: z.string().uuid()
        })
        .parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createPostCallOutcome(client, auth, {
          object_type: parsed.objectType,
          object_id: parsed.objectId,
          meeting_id: req.body.meeting_id ?? null,
          summary: req.body.summary,
          notes: req.body.notes ?? null,
          reason_for_call: req.body.reason_for_call ?? null,
          mark_handled: req.body.outcome_status ? req.body.outcome_status === "handled" : null,
          create_follow_up_task: req.body.create_follow_up_task ?? false,
          follow_up_task_title: req.body.follow_up_task_title ?? null,
          follow_up_task_assignee_user_id: req.body.follow_up_task_assignee_user_id ?? null,
          follow_up_task_due_at: req.body.follow_up_task_due_at ?? null,
          flag_issue: req.body.flag_issue ?? false,
          issue_severity: req.body.issue_severity ?? null,
          issue_title: req.body.issue_title ?? null,
          issue_description: req.body.issue_description ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/meetings",
  requireFeatureFlag(featureFlags.communicationIdentityLinking, {
    message: "Communication identity linking is currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsMeetings, {
    message: "Teams meetings are currently disabled."
  }),
  validateBody(
    z.object({
      object_type: objectTypeSchema,
      object_id: z.string().uuid(),
      lifecycle_type: meetingLifecycleTypeSchema.optional(),
      meeting_mode: meetingModeSchema.optional(),
      title: z.string().trim().max(200).nullable().optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      scheduled_start_at: z.string().trim().datetime().nullable().optional(),
      scheduled_end_at: z.string().trim().datetime().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertTeamsMeetingForRecord(
          client,
          auth,
          {
            object_type: req.body.object_type,
            object_id: req.body.object_id,
            lifecycle_type: req.body.lifecycle_type ?? null,
            meeting_mode: req.body.meeting_mode ?? null,
            title: req.body.title ?? null,
            description: req.body.description ?? null,
            scheduled_start_at: req.body.scheduled_start_at ?? null,
            scheduled_end_at: req.body.scheduled_end_at ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/meetings/:meetingId/cancel",
  requireFeatureFlag(featureFlags.communicationIdentityLinking, {
    message: "Communication identity linking is currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsMeetings, {
    message: "Teams meetings are currently disabled."
  }),
  validateBody(
    z.object({
      reason: z.string().trim().max(400).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          meetingId: z.string().uuid()
        })
        .parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        cancelTeamsMeeting(
          client,
          auth,
          {
            meeting_id: parsed.meetingId,
            reason: req.body.reason ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/records/:objectType/:objectId/references",
  requireFeatureFlag(featureFlags.communicationIdentityLinking, {
    message: "Communication identity linking is currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsCommunications, {
    message: "Teams messaging is currently disabled."
  }),
  validateBody(
    z.object({
      reference_type: referenceTypeSchema,
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().max(400).nullable().optional(),
      teams_web_url: z.string().trim().min(1).max(2000),
      team_id: z.string().trim().max(200).nullable().optional(),
      channel_id: z.string().trim().max(200).nullable().optional(),
      chat_id: z.string().trim().max(200).nullable().optional(),
      is_primary: z.boolean().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          objectType: objectTypeSchema,
          objectId: z.string().uuid()
        })
        .parse(req.params);
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createTeamsCommunicationReference(
          client,
          auth,
          {
            object_type: parsed.objectType,
            object_id: parsed.objectId,
            reference_type: req.body.reference_type,
            label: req.body.label,
            description: req.body.description ?? null,
            teams_web_url: req.body.teams_web_url,
            team_id: req.body.team_id ?? null,
            channel_id: req.body.channel_id ?? null,
            chat_id: req.body.chat_id ?? null,
            is_primary: req.body.is_primary
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/send",
  requireFeatureFlag(featureFlags.communicationIdentityLinking, {
    message: "Communication identity linking is currently disabled."
  }),
  requireFeatureFlag(featureFlags.communicationInAppActions, {
    message: "In-app communication actions are currently disabled."
  }),
  requireFeatureFlag(featureFlags.microsoftTeamsCommunications, {
    message: "Teams messaging is currently disabled."
  }),
  validateBody(
    z.object({
      reference_id: z.string().uuid(),
      object_type: objectTypeSchema,
      object_id: z.string().uuid(),
      message_text: z.string().trim().min(1).max(4000),
      app_deep_link: z.string().trim().max(2000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueTeamsCommunicationMessage(
          client,
          auth,
          {
            reference_id: req.body.reference_id,
            object_type: req.body.object_type,
            object_id: req.body.object_id,
            message_text: req.body.message_text,
            app_deep_link: req.body.app_deep_link ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
