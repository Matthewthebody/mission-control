import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "../config.js";
import { processOutboxBatch } from "../outbox/processor.js";
import { evaluateAlerts } from "../jobs/alertEvaluator.js";
import { monitorAttendance } from "../jobs/attendanceMonitor.js";
import { monitorChecklistReminders } from "../jobs/checklistMonitor.js";
import {
  monitorClientIntakeOperationalControl,
  monitorClientIntakeReminders,
  monitorMicrosoft365SmsReminders
} from "../jobs/clientIntakeMonitor.js";
import { monitorExceptionReconcile } from "../jobs/exceptionReconcileMonitor.js";
import { monitorGear } from "../jobs/gearMonitor.js";
import { monitorLabor } from "../jobs/laborMonitor.js";
import { monitorProductionBoard } from "../jobs/productionBoardMonitor.js";
import { monitorProjectTrackingSla } from "../jobs/projectTrackingSlaMonitor.js";
import { monitorSalesPipeline } from "../jobs/salesPipelineMonitor.js";
import { monitorSchoolsHub } from "../jobs/schoolsHubAutomation.js";

const RedisClient = Redis as unknown as new (
  url: string,
  options: {
    maxRetriesPerRequest: null;
  }
) => any;

export const connection = new RedisClient(config.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const outboxQueue = new Queue("outbox", { connection });
export const alertsQueue = new Queue("alerts", { connection });
export const attendanceQueue = new Queue("attendance", { connection });
export const checklistQueue = new Queue("checklists", { connection });
export const clientIntakeQueue = new Queue("client-intake", { connection });
export const exceptionReconcileQueue = new Queue("exception-reconcile", { connection });
export const gearQueue = new Queue("gear", { connection });
export const laborQueue = new Queue("labor", { connection });
export const productionBoardQueue = new Queue("production-board", { connection });
export const projectTrackingSlaQueue = new Queue("project-tracking-sla", { connection });
export const salesPipelineQueue = new Queue("sales-pipeline", { connection });
export const schoolsHubQueue = new Queue("schools-hub", { connection });

export const outboxWorker = new Worker(
  "outbox",
  async () => {
    await processOutboxBatch();
  },
  { connection }
);

export const alertsWorker = new Worker(
  "alerts",
  async () => {
    await evaluateAlerts();
  },
  { connection }
);

export const attendanceWorker = new Worker(
  "attendance",
  async () => {
    await monitorAttendance();
  },
  { connection }
);

export const checklistWorker = new Worker(
  "checklists",
  async () => {
    await monitorChecklistReminders();
  },
  { connection }
);

export const clientIntakeWorker = new Worker(
  "client-intake",
  async () => {
    await monitorClientIntakeReminders();
    await monitorClientIntakeOperationalControl();
    await monitorMicrosoft365SmsReminders();
  },
  { connection }
);

export const exceptionReconcileWorker = new Worker(
  "exception-reconcile",
  async () => {
    await monitorExceptionReconcile();
  },
  { connection }
);

export const gearWorker = new Worker(
  "gear",
  async () => {
    await monitorGear();
  },
  { connection }
);

export const laborWorker = new Worker(
  "labor",
  async () => {
    await monitorLabor();
  },
  { connection }
);

export const productionBoardWorker = new Worker(
  "production-board",
  async () => {
    await monitorProductionBoard();
  },
  { connection }
);

export const projectTrackingSlaWorker = new Worker(
  "project-tracking-sla",
  async () => {
    await monitorProjectTrackingSla();
  },
  { connection }
);

export const salesPipelineWorker = new Worker(
  "sales-pipeline",
  async () => {
    await monitorSalesPipeline();
  },
  { connection }
);

export const schoolsHubWorker = new Worker(
  "schools-hub",
  async () => {
    await monitorSchoolsHub();
  },
  { connection }
);

export async function scheduleJobs() {
  await outboxQueue.upsertJobScheduler("outbox-repeat", { every: 5000 }, { name: "process-outbox", data: {} });
  await alertsQueue.upsertJobScheduler("alerts-repeat", { every: 60000 }, { name: "evaluate-alerts", data: {} });
  await attendanceQueue.upsertJobScheduler("attendance-repeat", { every: 60000 }, { name: "monitor-attendance", data: {} });
  await checklistQueue.upsertJobScheduler("checklists-repeat", { every: 60000 }, { name: "monitor-checklists", data: {} });
  await clientIntakeQueue.upsertJobScheduler("client-intake-repeat", { every: 60000 }, { name: "monitor-client-intake", data: {} });
  await exceptionReconcileQueue.upsertJobScheduler("exception-reconcile-repeat", { every: 60000 }, { name: "monitor-exception-reconcile", data: {} });
  await gearQueue.upsertJobScheduler("gear-repeat", { every: 60000 }, { name: "monitor-gear", data: {} });
  await laborQueue.upsertJobScheduler("labor-repeat", { every: 60000 }, { name: "monitor-labor", data: {} });
  await productionBoardQueue.upsertJobScheduler("production-board-repeat", { every: 60000 }, { name: "monitor-production-board", data: {} });
  await projectTrackingSlaQueue.upsertJobScheduler("project-tracking-sla-repeat", { every: 60000 }, { name: "monitor-project-tracking-sla", data: {} });
  await salesPipelineQueue.upsertJobScheduler("sales-pipeline-repeat", { every: 60000 }, { name: "monitor-sales-pipeline", data: {} });
  await schoolsHubQueue.upsertJobScheduler("schools-hub-repeat", { every: 60000 }, { name: "monitor-schools-hub", data: {} });
}
