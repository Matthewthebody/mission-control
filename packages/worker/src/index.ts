import {
  scheduleJobs,
  alertsWorker,
  attendanceWorker,
  checklistWorker,
  clientIntakeWorker,
  exceptionReconcileWorker,
  gearWorker,
  laborWorker,
  productionBoardWorker,
  outboxWorker,
  projectTrackingSlaWorker,
  salesPipelineWorker,
  schoolsHubWorker
} from "./queue/bullmq.js";
import { assertCommunicationWorkerStartupConfig } from "./communicationRuntime.js";
import { assertMicrosoftWorkerStartupConfig } from "./microsoftRuntime.js";
import { assertReleaseDisciplineStartup } from "./releaseDiscipline.js";

async function main() {
  assertReleaseDisciplineStartup("worker");
  assertCommunicationWorkerStartupConfig();
  assertMicrosoftWorkerStartupConfig();
  await scheduleJobs();
  outboxWorker.on("completed", () => {});
  alertsWorker.on("completed", () => {});
  attendanceWorker.on("completed", () => {});
  checklistWorker.on("completed", () => {});
  clientIntakeWorker.on("completed", () => {});
  exceptionReconcileWorker.on("completed", () => {});
  gearWorker.on("completed", () => {});
  laborWorker.on("completed", () => {});
  productionBoardWorker.on("completed", () => {});
  projectTrackingSlaWorker.on("completed", () => {});
  salesPipelineWorker.on("completed", () => {});
  schoolsHubWorker.on("completed", () => {});
  // eslint-disable-next-line no-console
  console.log("Worker running");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
