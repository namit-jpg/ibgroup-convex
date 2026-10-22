import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { SENDVISE_SUBSCRIBE, loadConfig, webhookUrl } from "./lib/config.js";
import { contentDisposition, extensionOf, whatsappContentType } from "./lib/files.js";
import { slackEvents, slackInteractivity } from "./slackHttp.js";
import { sendviseWebhook } from "./sendviseHttp.js";

const serveStoredFile = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "files" || parts.length < 3) return new Response("Not found", { status: 404 });
  const storageId = parts[1];
  const filename = decodeURIComponent(parts.slice(2).join("/")) || "file";
  let blob;
  try {
    blob = await ctx.storage.get(storageId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!blob) return new Response("Not found", { status: 404 });
  const type = whatsappContentType(extensionOf(filename), blob.type);
  return new Response(blob, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

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
http.route({ pathPrefix: "/files/", method: "GET", handler: serveStoredFile });

export default http;
