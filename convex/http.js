import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { SENDVISE_SUBSCRIBE, loadConfig, webhookUrl } from "./lib/config.js";
import { slackEvents, slackInteractivity } from "./slackHttp.js";
import { sendviseWebhook } from "./sendviseHttp.js";

const health = httpAction(async () => {
  const config = loadConfig();
  return Response.json({
    ok: config.missing.length === 0,
    sendvise_webhook_url: webhookUrl(config),
    slack_events_url: `${config.publicBaseUrl}/slack/events`,
    slack_interactivity_url: `${config.publicBaseUrl}/slack/interactivity`,
    subscribe: SENDVISE_SUBSCRIBE,
    missing: config.missing,
  });
});

const explain = httpAction(async () => {
  return new Response("Sendvise webhook endpoint. Register this URL with a POST subscription.", {
    headers: { "Content-Type": "text/plain" },
  });
});

const http = httpRouter();
http.route({ path: "/health", method: "GET", handler: health });
http.route({ path: "/webhooks/sendvise", method: "GET", handler: explain });
http.route({ path: "/webhooks/sendvise", method: "POST", handler: sendviseWebhook });
http.route({ path: "/slack/events", method: "POST", handler: slackEvents });
http.route({ path: "/slack/interactivity", method: "POST", handler: slackInteractivity });

export default http;
