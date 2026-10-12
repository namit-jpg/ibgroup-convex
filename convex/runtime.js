import { internal } from "./_generated/api";
import { loadConfig } from "./lib/config.js";
import { createSendvise, createTemplateSource } from "./lib/sendvise.js";
import { createSlack } from "./lib/slack.js";

function defined(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined) clean[key] = value;
  }
  return clean;
}

export function makeDeps(ctx) {
  const config = loadConfig();
  const store = {
    claim: (id) => ctx.runMutation(internal.store.claim, { id: id || "" }),
    release: (id) => ctx.runMutation(internal.store.release, { id: id || "" }),
    getContact: (phone) => ctx.runQuery(internal.store.getContact, { phone }),
    getByChannel: (channelId) => ctx.runQuery(internal.store.getByChannel, { channelId: channelId || "" }),
    upsertContact: (phone, patch) => ctx.runMutation(internal.store.upsertContact, { phone, patch: defined(patch) }),
    nextAssignee: (agentIds) => ctx.runMutation(internal.store.nextAssignee, { agentIds: agentIds || [] }),
    rememberOutbound: (entry) => {
      if (!entry?.wamid) return Promise.resolve();
      return ctx.runMutation(internal.store.rememberOutbound, {
        wamid: entry.wamid,
        phone: entry.phone,
        channelId: entry.channelId ?? null,
        slackTs: entry.slackTs ?? null,
        slackUserId: entry.slackUserId ?? null,
        templateName: entry.templateName ?? null,
        preview: entry.preview ?? null,
        status: entry.status ?? null,
        error: entry.error ?? null,
      });
    },
    getOutbound: (wamid) => ctx.runQuery(internal.store.getOutbound, { wamid: wamid || "" }),
    listHomeCards: (userId, limit = 8) => ctx.runQuery(internal.store.listHomeCards, { userId, limit }),
  };
  const sendvise = createSendvise({
    apiKey: config.sendviseApiKey,
    baseUrl: config.sendviseBaseUrl,
    phoneNumberId: config.sendvisePhoneNumberId,
  });
  return {
    store,
    sendvise,
    slack: createSlack(config.slackBotToken),
    templates: createTemplateSource(sendvise),
    config,
    log: console,
  };
}
