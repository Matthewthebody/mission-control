import { config } from "../config.js";

type TeamsWebhookFact = {
  label: string;
  value: string;
};

type TeamsWebhookRoute = {
  route_name: string;
  destination_label: string;
  destination_config: {
    webhook_url: string;
    channel_name?: string | null;
  };
};

type TeamsWebhookAlert = {
  type: string;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  deep_link: string | null;
  facts: TeamsWebhookFact[];
};

export type TeamsWebhookDispatchPayload = {
  route: TeamsWebhookRoute;
  alert: TeamsWebhookAlert;
};

export type TeamsWebhookSendResult = {
  code: "sent" | "failed";
  response: Record<string, unknown>;
};

const SEVERITY_THEME_COLOR: Record<TeamsWebhookAlert["severity"], string> = {
  low: "7A869A",
  medium: "0F6CBD",
  high: "C97A10",
  critical: "C4314B"
};

export async function sendTeamsWebhook(payload: TeamsWebhookDispatchPayload): Promise<TeamsWebhookSendResult> {
  const webhookUrl = payload.route.destination_config.webhook_url;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildTeamsMessageCard(payload)),
    signal: AbortSignal.timeout(config.TEAMS_WEBHOOK_TIMEOUT_MS)
  });

  const responseText = await response.text();
  if (!response.ok) {
    return {
      code: "failed",
      response: {
        status: response.status,
        status_text: response.statusText,
        body: responseText
      }
    };
  }

  return {
    code: "sent",
    response: {
      status: response.status,
      status_text: response.statusText,
      body: responseText
    }
  };
}

function buildTeamsMessageCard(payload: TeamsWebhookDispatchPayload) {
  const facts = payload.alert.facts
    .filter((fact) => fact.label.trim() && fact.value.trim())
    .slice(0, 8)
    .map((fact) => ({
      name: fact.label,
      value: fact.value
    }));

  const potentialAction = payload.alert.deep_link
    ? [
        {
          "@type": "OpenUri",
          name: "Open In Mission Control",
          targets: [
            {
              os: "default",
              uri: payload.alert.deep_link
            }
          ]
        }
      ]
    : [];

  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: payload.alert.summary,
    themeColor: SEVERITY_THEME_COLOR[payload.alert.severity],
    title: payload.alert.title,
    sections: [
      {
        activityTitle: `${humanizeAlertType(payload.alert.type)} - ${humanizeSeverity(payload.alert.severity)}`,
        activitySubtitle: payload.route.destination_label,
        text: payload.alert.summary,
        facts
      }
    ],
    potentialAction
  };
}

function humanizeAlertType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeSeverity(value: TeamsWebhookAlert["severity"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
