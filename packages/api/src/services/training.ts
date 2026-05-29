import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { isActiveMembership } from "../authz/policy.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  EmployeeAcknowledgementState,
  EmployeeCheckpointResult,
  EmployeeTrainingModuleProgress,
  EmployeeTrainingProfile,
  TrainingCatalogResponse,
  TrainingDashboardSnapshot,
  TrainingEmployeeSummary,
  TrainingQuizAttempt,
  TrainingQuizRound,
  TrainingQuizRoundResponse,
  TrainingQuizSubmitResponse
} from "../types/training.js";
import { createAuditLog } from "./audit.js";
import {
  applyQuizAttempt,
  buildModuleProgress,
  buildPictureDayChallenge,
  cloneProfile,
  getQuizQuestions,
  getTrainingDashboardSnapshot,
  getTrainingEmployeeSummaries,
  normalizeProfile,
  scorePictureDayChallenge,
  templateProfiles,
  trainingAcknowledgements,
  trainingWorkbook,
  trainingModules
} from "./trainingCatalog.js";

type RequestAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type TrainingUserRow = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  status: string;
  roles: string[];
};

type TrainingProfileStateRow = {
  user_id: string;
  assigned_learning_path: string;
  onboarding_stage: string;
  readiness_state: EmployeeTrainingProfile["readiness_state"];
  readiness_note: string;
  workbook_progress_percent: number;
  required_progress_percent: number;
  optional_progress_percent: number;
  manager_signoff_status: EmployeeTrainingProfile["manager_signoff_status"];
  oversight_note: string | null;
  last_completed_at: string | null;
};

type TrainingModuleProgressRow = {
  user_id: string;
  module_id: string;
  status: EmployeeTrainingModuleProgress["status"];
  progress_percent: number;
  due_at: string | null;
  last_started_at: string | null;
  completed_at: string | null;
  best_score: number | null;
  signoff_status: EmployeeTrainingModuleProgress["signoff_status"];
  acknowledgement_complete: boolean;
  version_completed: string | null;
};

type TrainingCheckpointRow = {
  user_id: string;
  checkpoint_id: string;
  status: EmployeeCheckpointResult["status"];
  notes: string;
  reviewed_at: string | null;
};

type TrainingAcknowledgementRow = {
  user_id: string;
  acknowledgement_id: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
};

type TrainingQuizAttemptRow = {
  id: string;
  user_id: string;
  round_title: string;
  module_id: string | null;
  played_at: string;
  score_percent: number;
  passed: boolean;
  correct_count: number;
  question_count: number;
  missed_question_ids: string[];
};

const TEMPLATE_BY_EMAIL: Record<string, keyof typeof templateProfiles> = {
  "matthew@example.com": "leadership",
  "leadership@example.com": "leadership",
  "senior@example.com": "senior",
  "photo@example.com": "photographer",
  "associate@example.com": "associate",
  "office@example.com": "office",
  "newhire@example.com": "newhire",
  "pending@example.com": "newhire"
};

export async function listTrainingProfiles(client: PoolClient, auth: AuthUser): Promise<EmployeeTrainingProfile[]> {
  const users = await listVisibleTrainingUsers(client, auth);
  return loadProfilesForUsers(client, auth.tenantId, users);
}

export async function listTrainingSummaries(client: PoolClient, auth: AuthUser): Promise<TrainingEmployeeSummary[]> {
  const profiles = await listTrainingProfiles(client, auth);
  return getTrainingEmployeeSummaries(profiles);
}

export async function getTrainingDashboard(client: PoolClient, auth: AuthUser): Promise<TrainingDashboardSnapshot> {
  const profiles = await listTrainingProfiles(client, auth);
  return getTrainingDashboardSnapshot(profiles);
}

export function getTrainingCatalog(): TrainingCatalogResponse {
  return {
    workbook: {
      ...trainingWorkbook,
      sections: trainingWorkbook.sections.map((section) => ({ ...section, module_ids: [...section.module_ids] }))
    },
    modules: trainingModules.map((module) => ({
      ...module,
      content_blocks: module.content_blocks.map((block) => ({
        ...block,
        bullets: block.bullets ? [...block.bullets] : undefined
      })),
      checkpoint_ids: [...module.checkpoint_ids],
      acknowledgement_ids: [...module.acknowledgement_ids],
      question_ids: [...module.question_ids]
    })),
    acknowledgements: trainingAcknowledgements.map((entry) => ({ ...entry }))
  };
}

export async function createTrainingQuizRound(
  client: PoolClient,
  auth: AuthUser,
  input: {
    employeeId?: string | null;
    moduleId?: string | null;
    mode?: TrainingQuizRound["mode"];
    questionIds?: string[];
  }
): Promise<TrainingQuizRoundResponse> {
  const profile = await loadAuthorizedTrainingProfile(client, auth, input.employeeId ?? null);
  const round = buildPictureDayChallenge(profile, {
    moduleId: input.moduleId ?? null,
    mode: input.mode ?? "dashboard",
    questionIds: input.questionIds?.length ? input.questionIds : undefined
  });

  return {
    round,
    questions: getQuizQuestions(round.question_ids)
  };
}

export async function submitTrainingQuizAttempt(
  client: PoolClient,
  auth: AuthUser,
  input: {
    employeeId?: string | null;
    round: TrainingQuizRound;
    answers: Record<string, string>;
  },
  meta: RequestAuditContext = {}
): Promise<TrainingQuizSubmitResponse> {
  const profile = await loadAuthorizedTrainingProfile(client, auth, input.employeeId ?? null);
  const sanitizedRound = buildPictureDayChallenge(profile, {
    moduleId: input.round.module_id ?? null,
    mode: input.round.mode,
    questionIds: input.round.question_ids
  });
  const result = scorePictureDayChallenge(sanitizedRound, input.answers);
  const storedAttempt = await insertTrainingQuizAttempt(client, auth.tenantId, profile.employee.id, result.attempt);
  const nextProfile = applyQuizAttempt(profile, storedAttempt);
  await persistProfileState(client, auth.tenantId, profile.employee.id, nextProfile);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: profile.employee.id,
    action: "training.quiz.submitted",
    entityType: "training_profile",
    entityId: profile.employee.id,
    metadata: {
      module_id: storedAttempt.module_id ?? null,
      score_percent: storedAttempt.score_percent,
      passed: storedAttempt.passed
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return {
    profile: nextProfile,
    attempt: storedAttempt,
    questions: result.questions
  };
}

export async function updateTrainingManagerSignoff(
  client: PoolClient,
  auth: AuthUser,
  input: {
    employeeId: string;
    status: EmployeeTrainingProfile["manager_signoff_status"];
  },
  meta: RequestAuditContext = {}
): Promise<EmployeeTrainingProfile> {
  if (!canManageTraining(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  const profile = await loadAuthorizedTrainingProfile(client, auth, input.employeeId);
  const nextProfile = cloneProfile(profile);
  nextProfile.manager_signoff_status = input.status;
  nextProfile.modules = nextProfile.modules.map((module) => {
    const definition = trainingModules.find((entry) => entry.id === module.module_id);
    if (!definition?.signoff_required || module.status !== "completed") {
      return module;
    }
    return {
      ...module,
      signoff_status: input.status === "complete" ? "complete" : "pending"
    };
  });
  const normalized = normalizeProfile(nextProfile);
  await persistProfileState(client, auth.tenantId, profile.employee.id, normalized);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: profile.employee.id,
    action: "training.signoff.updated",
    entityType: "training_profile",
    entityId: profile.employee.id,
    metadata: {
      manager_signoff_status: input.status
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
  return normalized;
}

export async function seedTrainingState(client: PoolClient, tenantId: string) {
  const users = await listTrainingUsersForSeeding(client, tenantId);
  await ensureTrainingState(client, tenantId, users);
}

async function loadAuthorizedTrainingProfile(client: PoolClient, auth: AuthUser, requestedEmployeeId: string | null) {
  const users = await listVisibleTrainingUsers(client, auth, requestedEmployeeId);
  const targetUserId = requestedEmployeeId ?? auth.id;
  const targetUser = users.find((user) => user.id === targetUserId);
  if (!targetUser) {
    throw new ApiError(403, "Forbidden");
  }

  const profiles = await loadProfilesForUsers(client, auth.tenantId, [targetUser]);
  if (!profiles.length) {
    throw new ApiError(404, "Training profile not found");
  }
  return profiles[0];
}

async function loadProfilesForUsers(client: PoolClient, tenantId: string, users: TrainingUserRow[]) {
  if (!users.length) {
    return [];
  }

  const userIds = users.map((user) => user.id);

  const profileRows = await client.query<TrainingProfileStateRow>(
    `
      SELECT
        user_id,
        assigned_learning_path,
        onboarding_stage,
        readiness_state::text AS readiness_state,
        readiness_note,
        workbook_progress_percent,
        required_progress_percent,
        optional_progress_percent,
        manager_signoff_status::text AS manager_signoff_status,
        oversight_note,
        last_completed_at::text
      FROM training_profile_state
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  const moduleRows = await client.query<TrainingModuleProgressRow>(
    `
      SELECT
        user_id,
        module_id,
        status::text AS status,
        progress_percent,
        due_at::text,
        last_started_at::text,
        completed_at::text,
        best_score,
        signoff_status::text AS signoff_status,
        acknowledgement_complete,
        version_completed
      FROM training_module_progress
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  const quizRows = await client.query<TrainingQuizAttemptRow>(
    `
      SELECT
        id,
        user_id,
        round_title,
        module_id,
        played_at::text,
        score_percent,
        passed,
        correct_count,
        question_count,
        missed_question_ids
      FROM training_quiz_attempt
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
      ORDER BY played_at DESC, created_at DESC
    `,
    [tenantId, userIds]
  );
  const checkpointRows = await client.query<TrainingCheckpointRow>(
    `
      SELECT
        user_id,
        checkpoint_id,
        status::text AS status,
        notes,
        reviewed_at::text
      FROM training_checkpoint_result
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  const acknowledgementRows = await client.query<TrainingAcknowledgementRow>(
    `
      SELECT
        user_id,
        acknowledgement_id,
        acknowledged,
        acknowledged_at::text
      FROM training_acknowledgement_state
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );

  const profileRowByUserId = new Map(profileRows.rows.map((row) => [row.user_id, row]));
  const moduleRowsByUserId = groupBy(moduleRows.rows, (row) => row.user_id);
  const quizRowsByUserId = groupBy(quizRows.rows, (row) => row.user_id);
  const checkpointRowsByUserId = groupBy(checkpointRows.rows, (row) => row.user_id);
  const acknowledgementRowsByUserId = groupBy(acknowledgementRows.rows, (row) => row.user_id);

  return users.map((user) => {
    const base = buildSeedProfile(user);
    const profileRow = profileRowByUserId.get(user.id);
    const moduleRowMap = new Map((moduleRowsByUserId.get(user.id) ?? []).map((row) => [row.module_id, row]));
    const checkpointRowMap = new Map((checkpointRowsByUserId.get(user.id) ?? []).map((row) => [row.checkpoint_id, row]));
    const acknowledgementRowMap = new Map((acknowledgementRowsByUserId.get(user.id) ?? []).map((row) => [row.acknowledgement_id, row]));

    const profile: EmployeeTrainingProfile = {
      employee: base.employee,
      assigned_learning_path: profileRow?.assigned_learning_path ?? base.assigned_learning_path,
      onboarding_stage: profileRow?.onboarding_stage ?? base.onboarding_stage,
      readiness_state: profileRow?.readiness_state ?? base.readiness_state,
      readiness_note: profileRow?.readiness_note ?? base.readiness_note,
      workbook_progress_percent: Number(profileRow?.workbook_progress_percent ?? base.workbook_progress_percent),
      required_progress_percent: Number(profileRow?.required_progress_percent ?? base.required_progress_percent),
      optional_progress_percent: Number(profileRow?.optional_progress_percent ?? base.optional_progress_percent),
      manager_signoff_status: profileRow?.manager_signoff_status ?? base.manager_signoff_status,
      modules: trainingModules.map((module) => {
        const fallback = base.modules.find((entry) => entry.module_id === module.id) ?? buildModuleProgress({ module_id: module.id, status: "not_started" });
        const row = moduleRowMap.get(module.id);
        return row
          ? {
              module_id: row.module_id,
              status: row.status,
              progress_percent: Number(row.progress_percent ?? 0),
              due_at: row.due_at,
              last_started_at: row.last_started_at,
              completed_at: row.completed_at,
              best_score: row.best_score,
              signoff_status: row.signoff_status,
              acknowledgement_complete: Boolean(row.acknowledgement_complete),
              version_completed: row.version_completed
            }
          : fallback;
      }),
      quiz_history: (quizRowsByUserId.get(user.id) ?? []).slice(0, 8).map((row) => ({
        id: row.id,
        round_title: row.round_title,
        module_id: row.module_id,
        played_at: row.played_at,
        score_percent: Number(row.score_percent ?? 0),
        passed: Boolean(row.passed),
        correct_count: Number(row.correct_count ?? 0),
        question_count: Number(row.question_count ?? 0),
        missed_question_ids: [...(row.missed_question_ids ?? [])]
      })),
      checkpoints: trainingModules
        .flatMap((module) => module.checkpoint_ids)
        .filter((checkpointId, index, all) => all.indexOf(checkpointId) === index)
        .map((checkpointId) => {
          const fallback = base.checkpoints.find((entry) => entry.checkpoint_id === checkpointId) ?? {
            checkpoint_id: checkpointId,
            status: "pending" as const,
            notes: "Pending review"
          };
          const row = checkpointRowMap.get(checkpointId);
          return row
            ? {
                checkpoint_id: row.checkpoint_id,
                status: row.status,
                notes: row.notes,
                reviewed_at: row.reviewed_at
              }
            : fallback;
        }),
      acknowledgements: trainingAcknowledgements.map((acknowledgement) => {
        const fallback = base.acknowledgements.find((entry) => entry.acknowledgement_id === acknowledgement.id) ?? {
          acknowledgement_id: acknowledgement.id,
          acknowledged: false
        };
        const row = acknowledgementRowMap.get(acknowledgement.id);
        return row
          ? {
              acknowledgement_id: row.acknowledgement_id,
              acknowledged: Boolean(row.acknowledged),
              acknowledged_at: row.acknowledged_at
            }
          : fallback;
      }),
      last_completed_at: profileRow?.last_completed_at ?? base.last_completed_at ?? null,
      oversight_note: profileRow?.oversight_note ?? base.oversight_note
    };

    return normalizeProfile(profile);
  });
}

async function ensureTrainingState(client: PoolClient, tenantId: string, users: TrainingUserRow[]) {
  if (!users.length) {
    return;
  }

  const userIds = users.map((user) => user.id);
  const existingProfiles = await client.query<{ user_id: string }>(
    `
      SELECT user_id
      FROM training_profile_state
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );
  const existingAttempts = await client.query<{ user_id: string }>(
    `
      SELECT DISTINCT user_id
      FROM training_quiz_attempt
      WHERE tenant_id = $1
        AND user_id = ANY($2::uuid[])
    `,
    [tenantId, userIds]
  );

  const existingProfileIds = new Set(existingProfiles.rows.map((row) => row.user_id));
  const existingAttemptIds = new Set(existingAttempts.rows.map((row) => row.user_id));

  for (const user of users) {
    const seedProfile = buildSeedProfile(user);

    await client.query(
      `
        INSERT INTO training_profile_state (
          tenant_id,
          user_id,
          assigned_learning_path,
          onboarding_stage,
          readiness_state,
          readiness_note,
          workbook_progress_percent,
          required_progress_percent,
          optional_progress_percent,
          manager_signoff_status,
          oversight_note,
          last_completed_at
        )
        VALUES ($1,$2,$3,$4,$5::training_readiness_state,$6,$7,$8,$9,$10::training_signoff_status,$11,$12)
        ON CONFLICT (tenant_id, user_id) DO NOTHING
      `,
      [
        tenantId,
        user.id,
        seedProfile.assigned_learning_path,
        seedProfile.onboarding_stage,
        seedProfile.readiness_state,
        seedProfile.readiness_note,
        seedProfile.workbook_progress_percent,
        seedProfile.required_progress_percent,
        seedProfile.optional_progress_percent,
        seedProfile.manager_signoff_status,
        seedProfile.oversight_note ?? null,
        seedProfile.last_completed_at ?? null
      ]
    );

    for (const module of seedProfile.modules) {
      await client.query(
        `
          INSERT INTO training_module_progress (
            tenant_id,
            user_id,
            module_id,
            status,
            progress_percent,
            due_at,
            last_started_at,
            completed_at,
            best_score,
            signoff_status,
            acknowledgement_complete,
            version_completed
          )
          VALUES ($1,$2,$3,$4::training_module_status,$5,$6,$7,$8,$9,$10::training_signoff_status,$11,$12)
          ON CONFLICT (tenant_id, user_id, module_id) DO NOTHING
        `,
        [
          tenantId,
          user.id,
          module.module_id,
          module.status,
          module.progress_percent,
          module.due_at ?? null,
          module.last_started_at ?? null,
          module.completed_at ?? null,
          module.best_score ?? null,
          module.signoff_status,
          module.acknowledgement_complete,
          module.version_completed ?? null
        ]
      );
    }

    for (const checkpoint of seedProfile.checkpoints) {
      await client.query(
        `
          INSERT INTO training_checkpoint_result (
            tenant_id,
            user_id,
            checkpoint_id,
            status,
            notes,
            reviewed_at
          )
          VALUES ($1,$2,$3,$4::training_checkpoint_status,$5,$6)
          ON CONFLICT (tenant_id, user_id, checkpoint_id) DO NOTHING
        `,
        [tenantId, user.id, checkpoint.checkpoint_id, checkpoint.status, checkpoint.notes, checkpoint.reviewed_at ?? null]
      );
    }

    for (const acknowledgement of seedProfile.acknowledgements) {
      await client.query(
        `
          INSERT INTO training_acknowledgement_state (
            tenant_id,
            user_id,
            acknowledgement_id,
            acknowledged,
            acknowledged_at
          )
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (tenant_id, user_id, acknowledgement_id) DO NOTHING
        `,
        [
          tenantId,
          user.id,
          acknowledgement.acknowledgement_id,
          acknowledgement.acknowledged,
          acknowledgement.acknowledged_at ?? null
        ]
      );
    }

    if (!existingProfileIds.has(user.id) && seedProfile.quiz_history.length && !existingAttemptIds.has(user.id)) {
      for (const attempt of seedProfile.quiz_history) {
        await insertTrainingQuizAttempt(client, tenantId, user.id, attempt);
      }
    }
  }
}

async function persistProfileState(client: PoolClient, tenantId: string, userId: string, profile: EmployeeTrainingProfile) {
  await client.query(
    `
      INSERT INTO training_profile_state (
        tenant_id,
        user_id,
        assigned_learning_path,
        onboarding_stage,
        readiness_state,
        readiness_note,
        workbook_progress_percent,
        required_progress_percent,
        optional_progress_percent,
        manager_signoff_status,
        oversight_note,
        last_completed_at
      )
      VALUES ($1,$2,$3,$4,$5::training_readiness_state,$6,$7,$8,$9,$10::training_signoff_status,$11,$12)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        assigned_learning_path = EXCLUDED.assigned_learning_path,
        onboarding_stage = EXCLUDED.onboarding_stage,
        readiness_state = EXCLUDED.readiness_state,
        readiness_note = EXCLUDED.readiness_note,
        workbook_progress_percent = EXCLUDED.workbook_progress_percent,
        required_progress_percent = EXCLUDED.required_progress_percent,
        optional_progress_percent = EXCLUDED.optional_progress_percent,
        manager_signoff_status = EXCLUDED.manager_signoff_status,
        oversight_note = EXCLUDED.oversight_note,
        last_completed_at = EXCLUDED.last_completed_at,
        updated_at = now()
    `,
    [
      tenantId,
      userId,
      profile.assigned_learning_path,
      profile.onboarding_stage,
      profile.readiness_state,
      profile.readiness_note,
      profile.workbook_progress_percent,
      profile.required_progress_percent,
      profile.optional_progress_percent,
      profile.manager_signoff_status,
      profile.oversight_note ?? null,
      profile.last_completed_at ?? null
    ]
  );

  for (const module of profile.modules) {
    await client.query(
      `
        INSERT INTO training_module_progress (
          tenant_id,
          user_id,
          module_id,
          status,
          progress_percent,
          due_at,
          last_started_at,
          completed_at,
          best_score,
          signoff_status,
          acknowledgement_complete,
          version_completed
        )
        VALUES ($1,$2,$3,$4::training_module_status,$5,$6,$7,$8,$9,$10::training_signoff_status,$11,$12)
        ON CONFLICT (tenant_id, user_id, module_id) DO UPDATE SET
          status = EXCLUDED.status,
          progress_percent = EXCLUDED.progress_percent,
          due_at = EXCLUDED.due_at,
          last_started_at = EXCLUDED.last_started_at,
          completed_at = EXCLUDED.completed_at,
          best_score = EXCLUDED.best_score,
          signoff_status = EXCLUDED.signoff_status,
          acknowledgement_complete = EXCLUDED.acknowledgement_complete,
          version_completed = EXCLUDED.version_completed,
          updated_at = now()
      `,
      [
        tenantId,
        userId,
        module.module_id,
        module.status,
        module.progress_percent,
        module.due_at ?? null,
        module.last_started_at ?? null,
        module.completed_at ?? null,
        module.best_score ?? null,
        module.signoff_status,
        module.acknowledgement_complete,
        module.version_completed ?? null
      ]
    );
  }

  for (const checkpoint of profile.checkpoints) {
    await client.query(
      `
        INSERT INTO training_checkpoint_result (
          tenant_id,
          user_id,
          checkpoint_id,
          status,
          notes,
          reviewed_at
        )
        VALUES ($1,$2,$3,$4::training_checkpoint_status,$5,$6)
        ON CONFLICT (tenant_id, user_id, checkpoint_id) DO UPDATE SET
          status = EXCLUDED.status,
          notes = EXCLUDED.notes,
          reviewed_at = EXCLUDED.reviewed_at,
          updated_at = now()
      `,
      [tenantId, userId, checkpoint.checkpoint_id, checkpoint.status, checkpoint.notes, checkpoint.reviewed_at ?? null]
    );
  }

  for (const acknowledgement of profile.acknowledgements) {
    await client.query(
      `
        INSERT INTO training_acknowledgement_state (
          tenant_id,
          user_id,
          acknowledgement_id,
          acknowledged,
          acknowledged_at
        )
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, user_id, acknowledgement_id) DO UPDATE SET
          acknowledged = EXCLUDED.acknowledged,
          acknowledged_at = EXCLUDED.acknowledged_at,
          updated_at = now()
      `,
      [
        tenantId,
        userId,
        acknowledgement.acknowledgement_id,
        acknowledgement.acknowledged,
        acknowledgement.acknowledged_at ?? null
      ]
    );
  }
}

async function insertTrainingQuizAttempt(
  client: PoolClient,
  tenantId: string,
  userId: string,
  attempt: TrainingQuizAttempt
): Promise<TrainingQuizAttempt> {
  const { rows } = await client.query<TrainingQuizAttemptRow>(
    `
      INSERT INTO training_quiz_attempt (
        tenant_id,
        user_id,
        round_title,
        module_id,
        played_at,
        score_percent,
        passed,
        correct_count,
        question_count,
        missed_question_ids
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[])
      RETURNING
        id,
        user_id,
        round_title,
        module_id,
        played_at::text,
        score_percent,
        passed,
        correct_count,
        question_count,
        missed_question_ids
    `,
    [
      tenantId,
      userId,
      attempt.round_title,
      attempt.module_id ?? null,
      attempt.played_at,
      attempt.score_percent,
      attempt.passed,
      attempt.correct_count,
      attempt.question_count,
      attempt.missed_question_ids
    ]
  );

  return {
    id: rows[0].id,
    round_title: rows[0].round_title,
    module_id: rows[0].module_id,
    played_at: rows[0].played_at,
    score_percent: Number(rows[0].score_percent ?? 0),
    passed: Boolean(rows[0].passed),
    correct_count: Number(rows[0].correct_count ?? 0),
    question_count: Number(rows[0].question_count ?? 0),
    missed_question_ids: [...(rows[0].missed_question_ids ?? [])]
  };
}

async function listVisibleTrainingUsers(client: PoolClient, auth: AuthUser, requestedEmployeeId?: string | null) {
  if (!isActiveMembership(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  if (!canViewAllTrainingProfiles(auth)) {
    return listTrainingUsersByIds(client, auth.tenantId, [auth.id]);
  }

  if (requestedEmployeeId) {
    return listTrainingUsersByIds(client, auth.tenantId, [requestedEmployeeId]);
  }

  return listTrainingUsersForSeeding(client, auth.tenantId);
}

async function listTrainingUsersByIds(client: PoolClient, tenantId: string, userIds: string[]) {
  if (!userIds.length) {
    return [];
  }

  const { rows } = await client.query<TrainingUserRow>(
    `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.department,
        u.status::text,
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}'::text[]) AS roles
      FROM app_user u
      LEFT JOIN user_role ur
        ON ur.tenant_id = u.tenant_id
       AND ur.user_id = u.id
      LEFT JOIN role r
        ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.id = ANY($2::uuid[])
        AND u.status <> 'revoked'
      GROUP BY u.id, u.email, u.full_name, u.department, u.status
      ORDER BY lower(u.full_name), lower(u.email)
    `,
    [tenantId, userIds]
  );
  return rows.map((row) => ({ ...row, roles: [...(row.roles ?? [])] }));
}

async function listTrainingUsersForSeeding(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<TrainingUserRow>(
    `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.department,
        u.status::text,
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}'::text[]) AS roles
      FROM app_user u
      LEFT JOIN user_role ur
        ON ur.tenant_id = u.tenant_id
       AND ur.user_id = u.id
      LEFT JOIN role r
        ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.status <> 'revoked'
      GROUP BY u.id, u.email, u.full_name, u.department, u.status
      ORDER BY lower(u.full_name), lower(u.email)
    `,
    [tenantId]
  );
  return rows.map((row) => ({ ...row, roles: [...(row.roles ?? [])] }));
}

function buildSeedProfile(user: TrainingUserRow): EmployeeTrainingProfile {
  const template = cloneProfile(getTemplateForUser(user));
  return normalizeProfile({
    ...template,
    employee: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      department: user.department,
      roles: normalizeTrainingRoles(user.roles),
      employment_status: user.status
    }
  });
}

function getTemplateForUser(user: TrainingUserRow) {
  const templateKey = TEMPLATE_BY_EMAIL[user.email.toLowerCase()];
  if (templateKey) {
    return templateProfiles[templateKey];
  }
  if (user.status !== "active") {
    return templateProfiles.newhire;
  }
  if (user.roles.some((role) => ["owner_admin", "admin", "leadership"].includes(role))) {
    return templateProfiles.leadership;
  }
  if (user.roles.includes("senior_photographer")) {
    return templateProfiles.senior;
  }
  if (user.roles.includes("office_employee")) {
    return templateProfiles.office;
  }
  if (user.roles.includes("associate_photographer")) {
    return templateProfiles.associate;
  }
  return templateProfiles.photographer;
}

function normalizeTrainingRoles(roles: string[]) {
  const next = new Set(roles);
  if (roles.includes("photographer")) {
    next.add("associate_photographer");
  }
  if (roles.some((role) => ["owner_admin", "admin"].includes(role))) {
    next.add("leadership");
  }
  return [...next];
}

function canViewAllTrainingProfiles(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

function canManageTraining(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

function groupBy<TItem>(items: TItem[], keyFn: (item: TItem) => string) {
  const grouped = new Map<string, TItem[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}
