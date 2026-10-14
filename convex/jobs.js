import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { handleSendvise, handleSlackMessage, startOutbound } from "./lib/inbox.js";
import { composeModal, detailsModal, publishHome, successModal } from "./lib/home.js";
import { makeDeps } from "./runtime.js";

export const processSendvise = internalAction({
  args: { payload: v.any(), deliveryId: v.string() },
  handler: async (ctx, { payload, deliveryId }) => {
    const deps = makeDeps(ctx);
    await handleSendvise(payload, deliveryId, deps);
  },
});

export const onSlackEvent = internalAction({
  args: { body: v.any() },
  handler: async (ctx, { body }) => {
    if (body?.type !== "event_callback") return;
    const deps = makeDeps(ctx);
    const event = body.event || {};
    if (event.type === "app_home_opened") {
      console.log(`[bridge] app_home_opened user=${event.user}`);
      await publishHome(event.user, deps);
      return;
    }
    if (event.type === "message") {
      await handleSlackMessage({ message: event, eventId: body.event_id || "" }, deps);
    }
  },
});

export const fillCompose = internalAction({
  args: { viewId: v.string() },
  handler: async (ctx, { viewId }) => {
    const deps = makeDeps(ctx);
    try {
      const approved = await deps.templates.approved();
      await deps.slack.viewsUpdate(viewId, composeModal(approved));
    } catch (err) {
      console.error(`[bridge] template list failed: ${err.message}`);
      await deps.slack.viewsUpdate(viewId, {
        type: "modal",
        title: { type: "plain_text", text: "New message" },
        close: { type: "plain_text", text: "Close" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `Couldn't load templates. ${err.message}` },
          },
        ],
      });
    }
  },
});

export const finishSend = internalAction({
  args: {
    viewId: v.string(),
    userId: v.string(),
    meta: v.any(),
    values: v.any(),
    headerText: v.string(),
    headerMediaUrl: v.string(),
    assign: v.string(),
  },
  handler: async (ctx, args) => {
    const deps = makeDeps(ctx);
    try {
      const result = await startOutbound(
        {
          userId: args.userId,
          meta: args.meta,
          values: args.values,
          headerText: args.headerText,
          headerMediaUrl: args.headerMediaUrl,
          assign: args.assign,
        },
        deps,
      );
      await deps.slack.viewsUpdate(args.viewId, successModal(result));
    } catch (err) {
      console.error(`[bridge] outbound failed: ${err.message}`);
      try {
        await deps.slack.viewsUpdate(
          args.viewId,
          detailsModal({
            meta: args.meta,
            values: args.values,
            headerText: args.headerText,
            headerMediaUrl: args.headerMediaUrl,
            assign: args.assign,
            error: err.message,
          }),
        );
      } catch (updateErr) {
        console.error(`[bridge] could not show the send error: ${updateErr.message}`);
      }
    }
  },
});
