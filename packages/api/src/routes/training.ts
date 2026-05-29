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
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

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
    const auth = (req as AuthenticatedRequest).auth;
    const profiles = await withClientTransaction(auth.tenantId, auth.id, (client) => listTrainingProfiles(client, auth));
    return res.json(profiles);
  } catch (error) {
    return next(error);
  }
});

router.get("/summaries", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const summaries = await withClientTransaction(auth.tenantId, auth.id, (client) => listTrainingSummaries(client, auth));
    return res.json(summaries);
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
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
    const auth = (req as AuthenticatedRequest).auth;
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
    const auth = (req as AuthenticatedRequest).auth;
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
    const auth = (req as AuthenticatedRequest).auth;
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

export default router;
