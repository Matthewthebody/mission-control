import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  getPhotographerLocationPerformance,
  getShootLocationDetail,
  getShootLocationIntelligence,
  getTopRatedShootLocations,
  linkShootLocation,
  listShootLocations,
  overrideMissingSetupPhotoAlert,
  proxyLocationPhoto,
  reviewShootLocationEvaluation,
  reviewShootLocationPhoto,
  submitShootLocationEvaluation,
  uploadShootLocationPhoto
} from "../services/locations.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();
const allowedPhotoContentTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const setupPhotoDataUrlPattern = /^data:image\/(?:jpeg|png|webp|heic|heif);base64,[a-z0-9+/=]+$/i;

const listQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["alpha", "top_rated", "nearby"]).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional()
});

const intelligenceQuerySchema = z.object({
  shoot_id: z.string().uuid().optional(),
  outlook_event_id: z.string().optional(),
  outlook_calendar_id: z.string().optional(),
  shoot_code: z.string().optional(),
  event_subject: z.string().optional(),
  event_location: z.string().optional(),
  shoot_location_name: z.string().optional(),
  shoot_location_address: z.string().optional()
});

const evaluationBodySchema = z.object({
  shoot_id: z.string().uuid().optional().nullable(),
  outlook_event_id: z.string().optional().nullable(),
  shoot_name: z.string().trim().min(1).max(160),
  shoot_date: z.string().min(1).max(40),
  photographer_name: z.string().trim().min(1).max(120),
  shoot_type: z.enum(["Sports", "Schools"]),
  on_time: z.enum(["Yes", "No"]),
  easy_access: z.enum(["Yes", "No"]),
  overall_rating: z.number().int().min(1).max(5),
  photos_uploaded: z.enum(["Yes", "No"]),
  late_details: z.string().trim().max(500).optional().nullable(),
  access_details: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(3000).optional().nullable(),
  outreach_notes: z.string().trim().max(1000).optional().nullable(),
  recommendations: z.string().trim().max(1000).optional().nullable(),
  image_quality: z.string().trim().max(250).optional().nullable()
});

const setupPhotoBodySchema = z.object({
  shoot_id: z.string().uuid().optional().nullable(),
  outlook_event_id: z.string().optional().nullable(),
  file_name: z.string().trim().min(1).max(140).regex(/^[a-z0-9._ -]+$/i, "File name contains unsupported characters"),
  content_type: z.enum(allowedPhotoContentTypes),
  photo_category: z
    .enum([
      "arrival_entrance",
      "parking_load_in",
      "check_in_flow_area",
      "room_wide_shot",
      "final_camera_background_setup",
      "power_staging_storage",
      "special_constraint_watch_out"
    ])
    .optional()
    .nullable(),
  caption: z.string().trim().max(240).optional().nullable(),
  promote_to_location_memory: z.boolean().optional(),
  data_url: z
    .string()
    .min(20)
    .max(7 * 1024 * 1024, "Setup photos must be 5 MB or smaller")
    .regex(setupPhotoDataUrlPattern, "Setup photos must be uploaded as a supported image data URL")
});

const reviewEvaluationBodySchema = z.object({
  eval_status: z.enum(["reviewed", "closed"]),
  note: z.string().trim().max(1000).optional().nullable()
});

const reviewSetupPhotoBodySchema = z.object({
  memory_state: z.enum(["reviewed", "added_to_memory"]),
  note: z.string().trim().max(1000).optional().nullable()
});

const linkBodySchema = z.object({
  location_id: z.string().uuid(),
  shoot_id: z.string().uuid().optional().nullable(),
  outlook_event_id: z.string().max(160).optional().nullable(),
  outlook_calendar_id: z.string().max(160).optional().nullable(),
  shoot_code: z.string().max(80).optional().nullable(),
  event_subject: z.string().max(240).optional().nullable(),
  event_location: z.string().max(240).optional().nullable(),
  confidence: z.number().optional().nullable()
});

const overrideAlertBodySchema = z.object({
  reason: z.string().min(3)
});

router.use(requireAuth);

router.get("/", requireAction("shoot.read"), validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listShootLocations(client, auth, {
        search: req.query.search as string | undefined,
        category: req.query.category as string | undefined,
        sort: req.query.sort as "alpha" | "top_rated" | "nearby" | undefined,
        latitude: req.query.lat ? Number(req.query.lat) : null,
        longitude: req.query.lng ? Number(req.query.lng) : null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/top-rated", requireAction("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) => getTopRatedShootLocations(client, auth));
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/photographers", requireAction("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) => getPhotographerLocationPerformance(client, auth));
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/intelligence", requireAction("shoot.read"), validateQuery(intelligenceQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getShootLocationIntelligence(client, auth, {
        shootId: (req.query.shoot_id as string | undefined) ?? null,
        outlookEventId: (req.query.outlook_event_id as string | undefined) ?? null,
        outlookCalendarId: (req.query.outlook_calendar_id as string | undefined) ?? null,
        shootCode: (req.query.shoot_code as string | undefined) ?? null,
        eventSubject: (req.query.event_subject as string | undefined) ?? null,
        eventLocation: (req.query.event_location as string | undefined) ?? null,
        shootLocationName: (req.query.shoot_location_name as string | undefined) ?? null,
        shootLocationAddress: (req.query.shoot_location_address as string | undefined) ?? null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/photo-proxy", requireAction("shoot.read"), validateQuery(z.object({ url: z.string().url() })), async (req, res, next) => {
  try {
    const proxied = await proxyLocationPhoto(String(req.query.url));
    res.setHeader("Content-Type", proxied.contentType);
    return res.send(proxied.buffer);
  } catch (error) {
    return next(error);
  }
});

router.post("/links", requireAction("shoot.update"), validateBody(linkBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      linkShootLocation(
        client,
        auth,
        {
          location_id: req.body.location_id,
          shoot_id: req.body.shoot_id ?? null,
          outlook_event_id: req.body.outlook_event_id ?? null,
          outlook_calendar_id: req.body.outlook_calendar_id ?? null,
          shoot_code: req.body.shoot_code ?? null,
          event_subject: req.body.event_subject ?? null,
          event_location: req.body.event_location ?? null,
          confidence: req.body.confidence ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/alerts/:id/override", requireAction("alerts.resolve"), validateBody(overrideAlertBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      overrideMissingSetupPhotoAlert(
        client,
        auth,
        {
          alertId: String(req.params.id),
          reason: req.body.reason
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireAction("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getShootLocationDetail(client, auth, String(req.params.id))
    );
    if (!payload) {
      return res.status(404).json({ error: "Location not found" });
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/evaluations", requireAction("shoot.read"), validateBody(evaluationBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      submitShootLocationEvaluation(
        client,
        auth,
        {
          location_id: String(req.params.id),
          shoot_id: req.body.shoot_id ?? null,
          outlook_event_id: req.body.outlook_event_id ?? null,
          shoot_name: req.body.shoot_name,
          shoot_date: req.body.shoot_date,
          photographer_name: req.body.photographer_name,
          shoot_type: req.body.shoot_type,
          on_time: req.body.on_time,
          easy_access: req.body.easy_access,
          overall_rating: req.body.overall_rating,
          photos_uploaded: req.body.photos_uploaded,
          late_details: req.body.late_details ?? null,
          access_details: req.body.access_details ?? null,
          notes: req.body.notes ?? null,
          outreach_notes: req.body.outreach_notes ?? null,
          recommendations: req.body.recommendations ?? null,
          image_quality: req.body.image_quality ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/setup-photos", requireAction("media.attach"), validateBody(setupPhotoBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      uploadShootLocationPhoto(
        client,
        auth,
        {
          location_id: String(req.params.id),
          shoot_id: req.body.shoot_id ?? null,
          outlook_event_id: req.body.outlook_event_id ?? null,
          file_name: req.body.file_name,
          content_type: req.body.content_type,
          photo_category: req.body.photo_category ?? null,
          caption: req.body.caption ?? null,
          promote_to_location_memory: req.body.promote_to_location_memory ?? false,
          data_url: req.body.data_url
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/evaluations/:id/review", requireAction("shoot.update"), validateBody(reviewEvaluationBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      reviewShootLocationEvaluation(
        client,
        auth,
        {
          evaluationId: String(req.params.id),
          evalStatus: req.body.eval_status,
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/setup-photos/:id/review", requireAction("shoot.update"), validateBody(reviewSetupPhotoBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      reviewShootLocationPhoto(
        client,
        auth,
        {
          photoId: String(req.params.id),
          memoryState: req.body.memory_state,
          note: req.body.note ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
