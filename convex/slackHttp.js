import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifySlack } from "./lib/bridge.js";
import { loadConfig } from "./lib/config.js";
import { detailsModal, loadingModal, previewFromState, readCompose, readDetails, sendingModal, validateCompose, validateDetails } from "./lib/home.js";
import { templateMeta } from "./lib/inbox.js";
import { makeDeps } from "./runtime.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function empty() {
  return new Response(null, { status: 200 });
}

async function verifiedBody(request) {
  const config = loadConfig();
  const raw = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!config.slackSigningSecret || !(await verifySlack(raw, timestamp, signature, config.slackSigningSecret))) {
    return { ok: false, response: new Response("invalid signature", { status: 401 }) };
  }
  return { ok: true, raw };
}

export const slackEvents = httpAction(async (ctx, request) => {
  const checked = await verifiedBody(request);
  if (!checked.ok) return checked.response;
  let body;
  try {
    body = JSON.parse(checked.raw || "{}");
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (body.type === "url_verification") return json({ challenge: body.challenge });
  await ctx.scheduler.runAfter(0, internal.jobs.onSlackEvent, { body });
  return empty();
});

export const slackInteractivity = httpAction(async (ctx, request) => {
  const checked = await verifiedBody(request);
  if (!checked.ok) return checked.response;
  const payloadRaw = new URLSearchParams(checked.raw).get("payload");
  if (!payloadRaw) return new Response("missing payload", { status: 400 });
  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0]?.action_id || "";
    if (action === "open_new_message") {
      const deps = makeDeps(ctx);
      try {
        const opened = await deps.slack.viewsOpen(payload.trigger_id, loadingModal());
        await ctx.scheduler.runAfter(0, internal.jobs.fillCompose, { viewId: opened.view.id });
      } catch (err) {
        console.error(`[bridge] could not open composer: ${err.message}`);
      }
      return empty();
    }
    if (action === "refresh_preview" && payload.view) {
      const deps = makeDeps(ctx);
      try {
        await deps.slack.viewsUpdate(payload.view.id, previewFromState(payload.view));
      } catch (err) {
        console.error(`[bridge] preview update failed: ${err.message}`);
      }
      return empty();
    }
    return empty();
  }

  if (payload.type !== "view_submission") return empty();
  const callback = payload.view?.callback_id;

  if (callback === "pick_template") {
    const parsed = readCompose(payload.view);
    const errors = validateCompose(parsed);
    if (errors) return json({ response_action: "errors", errors });
    const deps = makeDeps(ctx);
    try {
      const template = await deps.templates.get(parsed.templateUuid);
      const meta = templateMeta(template, {
        name: parsed.name,
        phone: parsed.phone,
        agentsConfigured: deps.config.agentUserIds.length > 0,
      });
      return json({ response_action: "update", view: detailsModal({ meta }) });
    } catch (err) {
      console.error(`[bridge] template fetch failed: ${err.message}`);
      return json({
        response_action: "errors",
        errors: { template: "Couldn't load that template. Try again." },
      });
    }
  }

  if (callback === "send_outbound") {
    const parsed = readDetails(payload.view);
    const errors = validateDetails(parsed);
    if (errors) return json({ response_action: "errors", errors });
    await ctx.scheduler.runAfter(0, internal.jobs.finishSend, {
      viewId: payload.view.id,
      userId: payload.user.id,
      meta: parsed.meta,
      values: parsed.values,
      headerText: parsed.headerText,
      headerMediaUrl: parsed.headerMediaUrl,
      assign: parsed.assign,
    });
    return json({ response_action: "update", view: sendingModal(parsed.meta) });
  }

  return empty();
});
