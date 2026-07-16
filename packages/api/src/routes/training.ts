import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  createTrainingQuizRound,
  getTrainingCatalog,
  getTrainingDashboard,
  listTrainingProfiles,
  listTrainingSummaries,
  submitTrainingQuizAttempt,
  updateTrainingManagerSignoff
} from "../services/training.js";
import {
  acknowledgeLesson,
  addCohortMember,
  approveLessonVersion,
  assignLesson,
  createCohort,
  createLesson,
  createLessonRevision,
  getLessonDetail,
  getLessonResults,
  getMyLesson,
  getPilotMetrics,
  listCohorts,
  listLessons,
  listMyAssignments,
  recordSectionViewed,
  rejectLessonVersion,
  removeCohortMember,
  replaceDraftContent,
  retireLessonVersion,
  setCohortState,
  submitLessonVersion,
  submitReadiness
} from "../services/training/trainingLessons.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

// ---------------------------------------------------------------------------
// H6 — Fall Field Coach governed training. Authorization is enforced in the
// service layer (requireTrainingManager for authoring/assignment; employees
// act only on their own assignments).
// ---------------------------------------------------------------------------
const choiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  correct: z.boolean(),
  explanation: z.string().max(1000).optional()
});
const sectionSchema = z.object({
  title: z.string().min(1),
  section_kind: z.enum(["reading", "video_clip", "checklist", "scenario"]).optional(),
  body: z.string().max(20000).nullable().optional(),
  knowledge_source_version_id: z.string().uuid().nullable().optional(),
  knowledge_segment_id: z.string().uuid().nullable().optional(),
  media_start_seconds: z.number().nonnegative().nullable().optional(),
  media_end_seconds: z.number().nonnegative().nullable().optional()
});
const questionSchema = z.object({
  prompt: z.string().min(1),
  scenario: z.string().max(2000).nullable().optional(),
  choices: z.array(choiceSchema).max(8),
  review_section_ordinal: z.number().int().min(0).nullable().optional(),
  knowledge_segment_id: z.string().uuid().nullable().optional(),
  allow_open_text: z.boolean().optional()
});
const createLessonSchema = z.object({
  title: z.string().min(1),
  objective: z.string().max(2000).nullable().optional(),
  intended_role: z.string().max(120).nullable().optional(),
  intended_department: z.string().max(120).nullable().optional(),
  prerequisite_lesson_id: z.string().uuid().nullable().optional(),
  pass_threshold_percent: z.number().int().min(0).max(100).optional(),
  ai_drafted: z.boolean().optional(),
  is_demo: z.boolean().optional(),
  sections: z.array(sectionSchema).max(50).optional(),
  questions: z.array(questionSchema).max(50).optional()
});

const quizRoundSchema = z.object({
  employee_id: z.string().uuid().optional(),
  module_id: z.string().optional(),
  mode: z.enum(["dashboard", "profile", "module"]).optional(),
  question_ids: z.array(z.string()).optional()
});

const quizSubmitSchema = z.object({
  employee_id: z.string().uuid().optional(),
  round: z.object({
    id: z.string(),
    mode: z.enum(["dashboard", "profile", "module"]),
    title: z.string(),
    module_id: z.string().nullable().optional(),
    question_ids: z.array(z.string()).min(1).max(5),
    pass_threshold: z.number().int().min(1).max(100),
    best_score: z.number().int(),
    streak_placeholder: z.number().int()
  }),
  answers: z.record(z.string())
});

const signoffSchema = z.object({
  status: z.enum(["pending", "complete"])
});

router.use(requireAuth);

router.get("/profiles", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const profiles = await withClientTransaction(auth.tenantId, auth.id, (client) => listTrainingProfiles(client, auth));
    return res.json(profiles);
  } catch (error) {
    return next(error);
  }
});

router.get("/summaries", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const summaries = await withClientTransaction(auth.tenantId, auth.id, (client) => listTrainingSummaries(client, auth));
    return res.json(summaries);
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const snapshot = await withClientTransaction(auth.tenantId, auth.id, (client) => getTrainingDashboard(client, auth));
    return res.json(snapshot);
  } catch (error) {
    return next(error);
  }
});

router.get("/catalog", async (_req, res, next) => {
  try {
    return res.json(getTrainingCatalog());
  } catch (error) {
    return next(error);
  }
});

router.post("/quiz-rounds", validateBody(quizRoundSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createTrainingQuizRound(client, auth, {
        employeeId: req.body.employee_id ?? null,
        moduleId: req.body.module_id ?? null,
        mode: req.body.mode,
        questionIds: req.body.question_ids
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/quiz-attempts", validateBody(quizSubmitSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      submitTrainingQuizAttempt(
        client,
        auth,
        {
          employeeId: req.body.employee_id ?? null,
          round: {
            id: req.body.round.id,
            mode: req.body.round.mode,
            title: req.body.round.title,
            module_id: req.body.round.module_id ?? null,
            question_ids: req.body.round.question_ids,
            pass_threshold: req.body.round.pass_threshold,
            best_score: req.body.round.best_score,
            streak_placeholder: req.body.round.streak_placeholder
          },
          answers: req.body.answers
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/profiles/:id/signoff", validateBody(signoffSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateTrainingManagerSignoff(
        client,
        auth,
        {
          employeeId: String(req.params.id),
          status: req.body.status
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// --- Lesson governance (manager) ---
router.get("/lessons", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listLessons(client, auth, {
        query: typeof req.query.query === "string" ? req.query.query : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        role: typeof req.query.role === "string" ? req.query.role : undefined,
        includeDemo: req.query.include_demo === "false" ? false : undefined
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/lessons", validateBody(createLessonSchema), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createLesson(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/lessons/:lessonId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getLessonDetail(client, auth, String(req.params.lessonId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/lessons/:lessonId/revisions",
  validateBody(z.object({ copy_from_current: z.boolean().optional(), ai_drafted: z.boolean().optional(), note: z.string().max(2000).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createLessonRevision(client, auth, String(req.params.lessonId), {
          copyFromCurrent: req.body.copy_from_current,
          ai_drafted: req.body.ai_drafted,
          note: req.body.note ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/lesson-versions/:versionId/content",
  validateBody(z.object({ sections: z.array(sectionSchema).max(50), questions: z.array(questionSchema).max(50), pass_threshold_percent: z.number().int().min(0).max(100).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        replaceDraftContent(client, auth, String(req.params.versionId), req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/lesson-versions/:versionId/submit", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => submitLessonVersion(client, auth, String(req.params.versionId)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/lesson-versions/:versionId/approve",
  validateBody(z.object({ effective_from: z.string().datetime().nullable().optional(), review_due_at: z.string().datetime().nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        approveLessonVersion(client, auth, String(req.params.versionId), {
          effective_from: req.body.effective_from ?? null,
          review_due_at: req.body.review_due_at ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/lesson-versions/:versionId/reject", validateBody(z.object({ note: z.string().min(1).max(2000) })), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => rejectLessonVersion(client, auth, String(req.params.versionId), req.body.note));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/lesson-versions/:versionId/retire", validateBody(z.object({ note: z.string().max(2000).optional() })), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => retireLessonVersion(client, auth, String(req.params.versionId), req.body.note ?? null));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// --- Pilot cohorts (manager) ---
router.get("/cohorts", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listCohorts(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/cohorts",
  validateBody(z.object({ name: z.string().min(1), description: z.string().max(2000).nullable().optional(), starts_on: z.string().nullable().optional(), ends_on: z.string().nullable().optional(), support_contact: z.string().max(500).nullable().optional(), is_demo: z.boolean().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createCohort(client, auth, req.body));
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/cohorts/:cohortId",
  validateBody(z.object({ enabled: z.boolean().optional(), status: z.enum(["draft", "active", "ended"]).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => setCohortState(client, auth, String(req.params.cohortId), req.body));
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/cohorts/:cohortId/members", validateBody(z.object({ user_id: z.string().uuid() })), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => addCohortMember(client, auth, String(req.params.cohortId), req.body.user_id));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.delete("/cohorts/:cohortId/members/:userId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => removeCohortMember(client, auth, String(req.params.cohortId), String(req.params.userId)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// --- Assignment + manager visibility ---
router.post(
  "/assignments",
  validateBody(z.object({ lesson_id: z.string().uuid(), user_id: z.string().uuid(), cohort_id: z.string().uuid().nullable().optional(), reason: z.string().max(2000).nullable().optional(), due_at: z.string().datetime().nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as unknown as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => assignLesson(client, auth, req.body));
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/lessons/:lessonId/results", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getLessonResults(client, auth, String(req.params.lessonId)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/pilot-metrics", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const cohortId = typeof req.query.cohort_id === "string" ? req.query.cohort_id : null;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getPilotMetrics(client, auth, cohortId));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// --- Employee experience (self only) ---
router.get("/my-assignments", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listMyAssignments(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/my-assignments/:assignmentId", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getMyLesson(client, auth, String(req.params.assignmentId)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/my-assignments/:assignmentId/section-viewed", validateBody(z.object({ section_id: z.string().uuid() })), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => recordSectionViewed(client, auth, String(req.params.assignmentId), req.body.section_id));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/my-assignments/:assignmentId/acknowledge", async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => acknowledgeLesson(client, auth, String(req.params.assignmentId)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/my-assignments/:assignmentId/readiness", validateBody(z.object({ answers: z.record(z.string()) })), async (req, res, next) => {
  try {
    const auth = (req as unknown as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => submitReadiness(client, auth, String(req.params.assignmentId), req.body.answers));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
