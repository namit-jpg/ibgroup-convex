import {
  channelName,
  errorText,
  eventTimeSeconds,
  formatInbound,
  headerNeeds,
  isHumanChannelMessage,
  isWindowClosedError,
  maskPhone,
  phoneFrom,
  renderInbound,
  renderTemplate,
  slackTextToPlain,
  templateVariables,
  wamidFrom,
  windowOpen,
} from "./bridge.js";
import { publishHome } from "./home.js";

const TEMPLATE_FIRST = "WhatsApp won't deliver a free-form reply until they message you. Send another template from the WhatsApp Home tab.";

async function refreshHome(userId, deps) {
  if (!userId) return;
  try {
    await publishHome(userId, deps);
  } catch (err) {
    deps.log.error?.(`[bridge] home refresh failed: ${err.message}`);
  }
}

async function inviteAll(channelId, userIds, deps) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    try {
      await deps.slack.invite(channelId, userId, deps.config.slackTeamId);
    } catch (err) {
      deps.log.error?.(`[bridge] invite ${userId} failed: ${err.code || err.message}`);
    }
  }
}

async function ensureChannel(phone, { name, inviteUserIds, assigneeUserId, origin }, deps) {
  const existing = await deps.store.getContact(phone);
  if (existing?.channel_id) {
    const newcomers = (inviteUserIds || []).filter((id) => id && id !== existing.assignee_user_id);
    await inviteAll(existing.channel_id, newcomers, deps);
    if (name && name !== existing.name) await deps.store.upsertContact(phone, { name });
    if (!existing.assignee_user_id && assigneeUserId) {
      await deps.store.upsertContact(phone, { assigneeUserId });
    }
    return await deps.store.getContact(phone);
  }

  const created = await deps.slack.createChannel({
    name: channelName(name, phone),
    isPrivate: deps.config.privateChannels !== false,
    teamId: deps.config.slackTeamId,
  });
  const channelId = created.id;
  await deps.store.upsertContact(phone, {
    name: name || null,
    channelId,
    assigneeUserId: assigneeUserId || null,
    origin,
  });
  // Everyone on SLACK_AGENT_USER_IDS joins every newly created WhatsApp channel.
  const inviteList = [...(deps.config.agentUserIds || []), ...(inviteUserIds || [])];
  await inviteAll(channelId, inviteList, deps);
  await deps.slack.setPurpose?.(channelId, `WhatsApp +${phone}`, deps.config.slackTeamId);
  const who = name || "WhatsApp contact";
  const intro = origin === "inbound"
    ? `*${who}* · \`+${phone}\`\n${assigneeUserId ? `<@${assigneeUserId}> this one is yours. ` : ""}Reply in this channel and it goes to WhatsApp.`
    : `*${who}* · \`+${phone}\`\nThis chat was started with a template. Their reply will show up here. Answer in this channel after they write back. Until then, send another template from the WhatsApp Home tab.`;
  await deps.slack.postMessage({ channel: channelId, text: intro });
  return await deps.store.getContact(phone);
}

async function assigneeForNewInbound(existing, deps) {
  if (existing?.assignee_user_id) return existing.assignee_user_id;
  if (existing?.channel_id) return null;
  return await deps.store.nextAssignee(deps.config.agentUserIds);
}

async function onReceived(payload, deps) {
  const data = payload.data || {};
  const phone = phoneFrom(data);
  if (!phone) {
    deps.log.warn?.("[bridge] message.received without a phone");
    return;
  }
  const existing = await deps.store.getContact(phone);
  const view = formatInbound(data);
  const assignee = await assigneeForNewInbound(existing, deps);
  const contact = await ensureChannel(
    phone,
    {
      name: view.name,
      inviteUserIds: assignee ? [assignee] : [],
      assigneeUserId: assignee,
      origin: "inbound",
    },
    deps,
  );
  const rendered = renderInbound(view);
  await deps.slack.postMessage({ channel: contact.channel_id, ...rendered });
  const saved = await deps.store.upsertContact(phone, {
    name: view.name,
    conversationId: data.conversation_id != null ? String(data.conversation_id) : undefined,
    lastInboundAt: eventTimeSeconds(payload.timestamp),
    lastMessage: view.body,
    lastDirection: "in",
  });
  deps.log.info?.(`[bridge] inbound ${maskPhone(phone)}`);
  await refreshHome(saved.assignee_user_id, deps);
}

async function onSent(payload, deps) {
  const data = payload.data || {};
  const wamid = wamidFrom(data);
  if (wamid && await deps.store.getOutbound(wamid)) return;
  const phone = phoneFrom(data);
  if (!phone) return;
  const body = data.message || data.text || data.body || "Outbound WhatsApp message";
  const existing = await deps.store.getContact(phone);
  const assignee = existing?.assignee_user_id || await deps.store.nextAssignee(deps.config.agentUserIds);
  const contact = await ensureChannel(
    phone,
    {
      name: data.contact?.name || existing?.name,
      inviteUserIds: assignee ? [assignee] : [],
      assigneeUserId: assignee,
      origin: "outbound",
    },
    deps,
  );
  const posted = await deps.slack.postMessage({
    channel: contact.channel_id,
    text: `Sent outside Slack to +${phone}\n${body}`,
  });
  await deps.store.upsertContact(phone, { lastMessage: body, lastDirection: "out" });
  if (wamid) {
    await deps.store.rememberOutbound({
      wamid,
      phone,
      channelId: contact.channel_id,
      slackTs: posted.ts,
      templateName: data.template_name || null,
      preview: body,
      status: data.status || "sent",
    });
  }
  await refreshHome(contact.assignee_user_id, deps);
}

async function onReceipt(event, payload, deps) {
  const data = payload.data || {};
  const known = await deps.store.getOutbound(wamidFrom(data));
  const phone = phoneFrom(data) || known?.phone;
  const status = event === "message.failed" ? "failed" : event === "message.read" ? "read" : "delivered";
  if (known?.wamid) {
    await deps.store.rememberOutbound({
      wamid: known.wamid,
      phone: known.phone,
      channelId: known.channel_id,
      slackTs: known.slack_ts,
      slackUserId: known.slack_user_id,
      templateName: known.template_name,
      preview: known.preview,
      status,
      error: status === "failed" ? errorText(data) : null,
    });
  }
  if (event === "message.failed") {
    const reason = errorText(data);
    const channel = known?.channel_id || (phone && (await deps.store.getContact(phone))?.channel_id);
    if (channel) await deps.slack.postMessage({ channel, text: `WhatsApp delivery failed: ${reason}` });
    if (known?.slack_ts && known.channel_id) {
      await deps.slack.addReaction({ channel: known.channel_id, timestamp: known.slack_ts, name: "x" });
    }
  } else if (known?.slack_ts && known.channel_id) {
    const name = event === "message.read" ? "eyes" : "ballot_box_with_check";
    await deps.slack.addReaction({ channel: known.channel_id, timestamp: known.slack_ts, name });
  }
  await refreshHome(known?.slack_user_id, deps);
}

async function onConsent(event, payload, deps) {
  const data = payload.data || {};
  const phone = phoneFrom(data);
  const optedOut = event === "opt_out";
  const text = optedOut
    ? `+${phone || "contact"} opted out. WhatsApp sends stay blocked until they opt in.`
    : `+${phone || "contact"} opted in.`;
  if (!phone) return;
  const existing = await deps.store.getContact(phone);
  await deps.store.upsertContact(phone, { name: data.contact?.name, optedOut });
  if (existing?.channel_id) {
    await deps.slack.postMessage({ channel: existing.channel_id, text });
  }
  await refreshHome(existing?.assignee_user_id, deps);
}

async function onContactCreated(payload, deps) {
  const data = payload.data || {};
  const phone = phoneFrom(data);
  if (!phone) return;
  const name = data.contact?.name || data.name;
  if (name) await deps.store.upsertContact(phone, { name });
}

async function onOps(event, payload, deps) {
  deps.log.info?.(`[bridge] ${event} ${JSON.stringify(payload.data || {}).slice(0, 300)}`);
}

export async function handleSendvise(payload, deliveryId, deps) {
  const event = payload?.event || "";
  if (deliveryId && !(await deps.store.claim(deliveryId))) return { duplicate: true };
  try {
    switch (event) {
      case "message.received":
        await onReceived(payload, deps);
        break;
      case "message.sent":
        await onSent(payload, deps);
        break;
      case "message.delivered":
      case "message.read":
      case "message.failed":
        await onReceipt(event, payload, deps);
        break;
      case "opt_in":
      case "opt_out":
        await onConsent(event, payload, deps);
        break;
      case "contact.created":
        await onContactCreated(payload, deps);
        break;
      case "order.paid":
      case "campaign.completed":
        await onOps(event, payload, deps);
        break;
      default:
        deps.log.info?.(`[bridge] ignored Sendvise event ${event || "(none)"}`);
    }
    return { ok: true };
  } catch (err) {
    if (deliveryId) await deps.store.release(deliveryId);
    throw err;
  }
}

async function say(channel, text, deps) {
  await deps.slack.postMessage({ channel, text });
}

export async function handleSlackMessage({ message, eventId }, deps) {
  if (!isHumanChannelMessage(message)) return;
  const contact = await deps.store.getByChannel(message.channel);
  if (!contact) return;

  const files = message.files?.length || 0;
  const text = slackTextToPlain(message.text || "");
  if (eventId && !(await deps.store.claim(eventId))) return;

  try {
    if (!text && files) {
      await say(message.channel, "Files stay in Slack. Send the text here, or send a template with a file link from the WhatsApp Home tab.", deps);
      return;
    }
    if (!text) return;
    if (contact.opted_out) {
      await say(message.channel, `+${contact.phone} opted out. WhatsApp sends stay blocked until they opt in.`, deps);
      return;
    }
    if (!contact.last_inbound_at || !windowOpen(contact.last_inbound_at)) {
      const note = contact.last_inbound_at
        ? `The 24-hour WhatsApp window is closed for +${contact.phone}. Send another template from the WhatsApp Home tab.`
        : TEMPLATE_FIRST;
      await say(message.channel, note, deps);
      return;
    }

    const data = await deps.sendvise.sendText(contact.phone, text);
    const wamid = data.message_id || data.wamid;
    if (wamid) {
      await deps.store.rememberOutbound({
        wamid,
        phone: contact.phone,
        channelId: message.channel,
        slackTs: message.ts,
        slackUserId: message.user,
        preview: text,
        status: "sent",
      });
    }
    await deps.store.upsertContact(contact.phone, { lastMessage: text, lastDirection: "out" });
    await deps.slack.addReaction({ channel: message.channel, timestamp: message.ts, name: "white_check_mark" });
  } catch (err) {
    if (eventId) await deps.store.release(eventId);
    const note = isWindowClosedError(err) ? TEMPLATE_FIRST : `WhatsApp send failed: ${err.message}`;
    await say(message.channel, note, deps);
  }
}

export function templateMeta(template, { name, phone, agentsConfigured }) {
  const header = headerNeeds(template);
  return {
    name: name || "WhatsApp contact",
    phone,
    template_uuid: template.uuid,
    template_name: template.name,
    template_body: template.body || "",
    language: template.language || "en",
    var_keys: templateVariables(template),
    needs_header_text: header.text,
    needs_header_media: header.media,
    header_format: header.format,
    agents_configured: Boolean(agentsConfigured),
  };
}

export async function startOutbound({ userId, meta, values, headerText, headerMediaUrl, assign }, deps) {
  const phone = meta.phone;
  const existing = await deps.store.getContact(phone);
  if (existing?.opted_out) {
    throw new Error(`+${phone} has opted out. WhatsApp sends stay blocked until they opt in.`);
  }

  const ordered = (meta.var_keys || []).map((key) => String(values[key] || "").trim());
  const rendered = renderTemplate(meta.template_body, values);
  const data = await deps.sendvise.sendTemplate(phone, meta.template_name, ordered, meta.language, {
    headerText: headerText.trim(),
    headerMediaUrl: headerMediaUrl.trim(),
    headerMediaType: meta.needs_header_media ? String(meta.header_format || "").toLowerCase() : "",
  });
  const wamid = data.message_id || data.wamid;
  const alreadyMirrored = Boolean(wamid && await deps.store.getOutbound(wamid));
  if (wamid && !alreadyMirrored) {
    await deps.store.rememberOutbound({
      wamid,
      phone,
      slackUserId: userId,
      templateName: meta.template_name,
      preview: rendered,
      status: data.status || "sent",
      channelId: existing?.channel_id || null,
    });
  }

  const rota = assign === "round_robin" ? await deps.store.nextAssignee(deps.config.agentUserIds) : null;
  const assignee = existing?.assignee_user_id || rota || userId;
  const contact = await ensureChannel(
    phone,
    {
      name: meta.name,
      inviteUserIds: [assignee, userId],
      assigneeUserId: assignee,
      origin: "outbound",
    },
    deps,
  );

  let slackTs = null;
  if (!alreadyMirrored) {
    const posted = await deps.slack.postMessage({
      channel: contact.channel_id,
      text: `Template ${meta.template_name} sent by <@${userId}>\n${rendered}`,
    });
    slackTs = posted.ts;
  }
  if (wamid) {
    await deps.store.rememberOutbound({
      wamid,
      phone,
      channelId: contact.channel_id,
      slackTs,
      slackUserId: userId,
      templateName: meta.template_name,
      preview: rendered,
      status: data.status || "sent",
    });
  }
  await deps.store.upsertContact(phone, { name: meta.name, lastMessage: rendered, lastDirection: "out" });
  await refreshHome(userId, deps);
  if (assignee !== userId) await refreshHome(assignee, deps);

  return {
    channelId: contact.channel_id,
    rendered,
    name: meta.name,
    phone,
    assigneeUserId: assignee,
    handedOff: assignee !== userId ? `<@${assignee}>` : "",
  };
}
