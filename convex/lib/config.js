export const WEBHOOK_PATH = "/webhooks/sendvise";

export const SENDVISE_SUBSCRIBE = {
  required: ["message.received"],
  recommended: ["message.sent", "opt_in", "opt_out", "contact.created"],
  optional: ["order.paid", "campaign.completed", "message.delivered", "message.read", "message.failed"],
};

const REQUIRED = ["SENDVISE_API_KEY", "SENDVISE_WEBHOOK_SECRET", "SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"];

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  const site = (env.CONVEX_SITE_URL || "").replace(/\/$/, "");
  return {
    missing,
    publicBaseUrl: (env.PUBLIC_BASE_URL || site).replace(/\/$/, ""),
    sendviseApiKey: env.SENDVISE_API_KEY || "",
    sendviseBaseUrl: (env.SENDVISE_BASE_URL || "https://app.sendvise.com/api").replace(/\/$/, ""),
    sendviseWebhookSecret: env.SENDVISE_WEBHOOK_SECRET || "",
    sendviseOutboundWebhookSecret: env.SENDVISE_OUTBOUND_WEBHOOK_SECRET || "",
    sendvisePhoneNumberId: env.SENDVISE_PHONE_NUMBER_ID || "",
    sendviseTemplateLanguage: env.SENDVISE_TEMPLATE_LANGUAGE || "en",
    slackBotToken: env.SLACK_BOT_TOKEN || "",
    slackSigningSecret: env.SLACK_SIGNING_SECRET || "",
    slackTeamId: env.SLACK_TEAM_ID || "",
    agentUserIds: (env.SLACK_AGENT_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    privateChannels: env.SLACK_PRIVATE_CHANNELS !== "false",
  };
}

export function webhookUrl(config) {
  return `${config.publicBaseUrl}${WEBHOOK_PATH}`;
}
