import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import authRoutes from "./routes/auth.js";
import accessRoutes from "./routes/access.js";
import centralJobIntakeRoutes from "./routes/centralJobIntake.js";
import shootRoutes from "./routes/shoots.js";
import statusEventRoutes from "./routes/statusEvents.js";
import clockRoutes from "./routes/clock.js";
import mileageRoutes from "./routes/mileage.js";
import uploadRoutes from "./routes/uploads.js";
import mediaRoutes from "./routes/media.js";
import alertRoutes from "./routes/alerts.js";
import pushRoutes from "./routes/push.js";
import integrationRoutes from "./routes/integrations.js";
import outlookRoutes from "./routes/outlook.js";
import zendeskIntegrationRoutes from "./routes/zendeskIntegration.js";
import zendeskRoutes from "./routes/zendesk.js";
import shiftRoutes from "./routes/shifts.js";
import attendanceRoutes from "./routes/attendance.js";
import laborRoutes from "./routes/labor.js";
import complianceRoutes from "./routes/compliance.js";
import approvalRoutes from "./routes/approvals.js";
import exceptionRoutes from "./routes/exceptions.js";
import watchRoutes from "./routes/watch.js";
import notificationRoutes from "./routes/notifications.js";
import dashboardRoutes from "./routes/dashboard.js";
import trainingRoutes from "./routes/training.js";
import locationRoutes from "./routes/locations.js";
import gearRoutes from "./routes/gear.js";
import organizationRoutes from "./routes/organizations.js";
import schoolsHubRoutes from "./routes/schoolsHub.js";
import schoolsLeadershipRoutes from "./routes/schoolsLeadership.js";
import shootDateChangeRoutes from "./routes/shootDateChange.js";
import productionOperationsRoutes from "./routes/productionOperations.js";
import sportsRoutes from "./routes/sports.js";
import scheduleRoutes from "./routes/schedule.js";
import employeeRoutes from "./routes/employee.js";
import noteRoutes from "./routes/notes.js";
import communicationRoutes from "./routes/communications.js";
import adminSecurityRoutes from "./routes/adminSecurity.js";
import adminSettingsRoutes from "./routes/adminSettings.js";
import adminSystemRoutes from "./routes/adminSystem.js";
import resourceLibraryRoutes from "./routes/resourceLibrary.js";
import recordResourcesRoutes from "./routes/recordResources.js";
import profitabilityRoutes from "./routes/profitability.js";
import productionProjectRoutes from "./routes/productionProjects.js";
import productionAssetRoutes from "./routes/productionAssets.js";
import clientOperationsCoreRoutes from "./routes/clientOperationsCore.js";
import clientCommandCenterRoutes from "./routes/clientCommandCenter.js";
import jobCloseoutRoutes from "./routes/jobCloseout.js";
import salesRoutes from "./routes/sales.js";
import jobRoutes from "./routes/jobs.js";
import checklistRoutes from "./routes/checklists.js";
import taskRoutes from "./routes/tasks.js";
import workflowRoutes from "./routes/workflows.js";
import searchRoutes from "./routes/search.js";
import activityRoutes from "./routes/activity.js";
import reportingRoutes from "./routes/reporting.js";
import conciergeRoutes from "./routes/concierge.js";
import { optionalAuth } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/security.js";
import { errorHandler } from "./middleware/error.js";
import { assertOutlookOauthConfig } from "./config/outlook.js";
import { config } from "./config.js";
import { assertCommunicationStartupConfig, getPublicCommunicationHealthSummary } from "./services/communicationObservability.js";
import { assertCoreFoundationStartupConfig, getPublicCoreFoundationHealthSummary } from "./services/coreFoundationObservability.js";
import {
  assertMicrosoft365ClientIntakeStartupConfig,
  getPublicMicrosoft365ClientIntakeHealthSummary
} from "./services/microsoft365ClientIntake.js";
import {
  assertMicrosoft365ClientIntakeOperationalControlStartupConfig,
  getPublicMicrosoft365ClientIntakeOperationalControlHealthSummary
} from "./services/microsoft365ClientIntakeOperations.js";
import {
  assertMicrosoft365ClientPortalStartupConfig,
  getPublicMicrosoft365ClientPortalHealthSummary
} from "./services/microsoft365ClientPortal.js";
import {
  assertMicrosoft365SmsOptimizationStartupConfig,
  getPublicMicrosoft365SmsOptimizationHealthSummary
} from "./services/microsoft365SmsOptimization.js";
import {
  assertMicrosoft365GovernanceStartupConfig,
  getPublicMicrosoft365GovernanceHealthSummary
} from "./services/microsoft365Governance.js";
import {
  assertMicrosoft365MailAutomationStartupConfig,
  getPublicMicrosoft365MailAutomationHealthSummary
} from "./services/microsoft365MailAutomation.js";
import {
  assertMicrosoft365OperatingSystemStartupConfig,
  getPublicMicrosoft365OperatingSystemHealthSummary
} from "./services/microsoft365OperatingSystem.js";
import {
  assertMicrosoft365ProvisioningStartupConfig,
  getPublicMicrosoft365ProvisioningHealthSummary
} from "./services/microsoft365Provisioning.js";
import { assertMicrosoftIntegrationStartupConfig, getPublicMicrosoftHealthSummary } from "./services/microsoftIntegrationObservability.js";
import { assertReleaseDisciplineStartup, getPublicReleaseDisciplineSummary } from "./services/releaseDiscipline.js";
import { requestContextMiddleware } from "./services/requestContext.js";

const httpLogger = pinoHttp as unknown as (options?: Record<string, unknown>) => express.RequestHandler;
const LOCAL_DEV_ADMIN_WEB_PORTS = Array.from({ length: 27 }, (_, index) => 5173 + index);

export function createApp() {
  if (config.MICROSOFT_OUTLOOK_SYNC_ENABLED) {
    assertOutlookOauthConfig();
    if (config.NODE_ENV === "production" && !config.OUTLOOK_TOKEN_ENCRYPTION_SECRET) {
      throw new Error("OUTLOOK_TOKEN_ENCRYPTION_SECRET is required when Outlook sync is enabled in production.");
    }
  }
  assertReleaseDisciplineStartup("api");
  assertCommunicationStartupConfig("api");
  assertCoreFoundationStartupConfig("api");
  assertMicrosoft365ClientIntakeStartupConfig();
  assertMicrosoft365ClientIntakeOperationalControlStartupConfig();
  assertMicrosoft365ClientPortalStartupConfig();
  assertMicrosoft365SmsOptimizationStartupConfig();
  assertMicrosoft365GovernanceStartupConfig();
  assertMicrosoft365MailAutomationStartupConfig();
  assertMicrosoft365OperatingSystemStartupConfig();
  assertMicrosoft365ProvisioningStartupConfig();
  assertMicrosoftIntegrationStartupConfig("api");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", parseTrustProxyValue(config.TRUST_PROXY));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (getAllowedCorsOrigins().has(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true
    })
  );
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use(
    httpLogger({
      enabled: config.NODE_ENV !== "test",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-forwarded-for",
          "res.headers.set-cookie"
        ],
        censor: "[Redacted]"
      }
    } as never)
  );
  app.use(requestContextMiddleware);
  app.use(optionalAuth);
  app.use(csrfProtection);

  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      communications: getPublicCommunicationHealthSummary(),
      foundation: getPublicCoreFoundationHealthSummary(),
      microsoft365_client_intake: getPublicMicrosoft365ClientIntakeHealthSummary(),
      microsoft365_client_intake_operations: getPublicMicrosoft365ClientIntakeOperationalControlHealthSummary(),
      microsoft365_client_portal: getPublicMicrosoft365ClientPortalHealthSummary(),
      microsoft365_sms_optimization: getPublicMicrosoft365SmsOptimizationHealthSummary(),
      microsoft365_governance: getPublicMicrosoft365GovernanceHealthSummary(),
      microsoft365_mail_automation: getPublicMicrosoft365MailAutomationHealthSummary(),
      microsoft365_operating_system: getPublicMicrosoft365OperatingSystemHealthSummary(),
      microsoft365_provisioning: getPublicMicrosoft365ProvisioningHealthSummary(),
      microsoft: getPublicMicrosoftHealthSummary(),
      release_discipline: getPublicReleaseDisciplineSummary()
    })
  );
  app.use("/auth", authRoutes);
  app.use("/api/access", accessRoutes);
  app.use("/api/shoots/intake", centralJobIntakeRoutes);
  app.use("/api/shoots", shootRoutes);
  app.use("/api/shoots", statusEventRoutes);
  app.use("/api/shoots", clockRoutes);
  app.use("/api/shoots", mileageRoutes);
  app.use("/api/shoots", mediaRoutes);
  app.use("/api/uploads", uploadRoutes);
  app.use("/api/alerts", alertRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api/integrations", integrationRoutes);
  app.use("/api/integrations/outlook", outlookRoutes);
  app.use("/api/integrations/zendesk", zendeskIntegrationRoutes);
  app.use("/api/shifts", shiftRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/labor", laborRoutes);
  app.use("/api/compliance", complianceRoutes);
  app.use("/api/approvals", approvalRoutes);
  app.use("/api/exceptions", exceptionRoutes);
  app.use("/api/watch", watchRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/zendesk", zendeskRoutes);
  app.use("/api/training", trainingRoutes);
  app.use("/api/organizations", organizationRoutes);
  app.use("/api/schools-hub", schoolsHubRoutes);
  app.use("/api/schools/leadership", schoolsLeadershipRoutes);
  app.use("/api/shoots/date-change-requests", shootDateChangeRoutes);
  app.use("/api/production", productionOperationsRoutes);
  app.use("/api/sports", sportsRoutes);
  app.use("/api/locations", locationRoutes);
  app.use("/api/gear", gearRoutes);
  app.use("/api/schedule", scheduleRoutes);
  app.use("/api/employee", employeeRoutes);
  app.use("/api/notes", noteRoutes);
  app.use("/api/communications", communicationRoutes);
  app.use("/api/resource-library", resourceLibraryRoutes);
  app.use("/api/record-resources", recordResourcesRoutes);
  app.use("/api/projects", productionProjectRoutes);
  app.use("/api/production-assets", productionAssetRoutes);
  app.use("/api/client-command-center", clientCommandCenterRoutes);
  app.use("/api/job-closeout", jobCloseoutRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/activity", activityRoutes);
  app.use("/api/reporting", reportingRoutes);
  app.use("/api/checklists", checklistRoutes);
  app.use("/api/concierge", conciergeRoutes);
  app.use("/api/sales", salesRoutes);
  app.use("/api/profitability", profitabilityRoutes);
  app.use("/api/client-operations-core", clientOperationsCoreRoutes);
  app.use("/api/admin/security", adminSecurityRoutes);
  app.use("/api/admin/settings", adminSettingsRoutes);
  app.use("/api/admin/system", adminSystemRoutes);

  app.use(errorHandler);

  return app;
}

function parseTrustProxyValue(value: string) {
  if (!value) {
    return false;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }
  return value;
}

export function getAllowedCorsOrigins() {
  const origins = new Set<string>();
  for (const value of [config.SOCKET_IO_CORS_ORIGIN, config.ADMIN_WEB_URL]) {
    if (!value) {
      continue;
    }
    origins.add(value);
    try {
      const parsed = new URL(value);
      if (parsed.hostname === "localhost") {
        parsed.hostname = "127.0.0.1";
        origins.add(parsed.toString().replace(/\/$/, ""));
      } else if (parsed.hostname === "127.0.0.1") {
        parsed.hostname = "localhost";
        origins.add(parsed.toString().replace(/\/$/, ""));
      }
    } catch {
      // Ignore malformed optional origins and keep the explicit value only.
    }
  }
  if (config.NODE_ENV !== "production") {
    for (const port of LOCAL_DEV_ADMIN_WEB_PORTS) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return origins;
}
