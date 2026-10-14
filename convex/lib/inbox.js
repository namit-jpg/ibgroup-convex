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

async function ensureMappedMembers(channelId, userIds, deps) {
  const wanted = [...new Set(userIds.filter(Boolean))];
  if (!wanted.length) return { invited: [], missing: [] };

  let memberIds = null;
  if (deps.slack.listMemberIds) {
    try {
      memberIds = await deps.slack.listMemberIds(channelId, deps.config.slackTeamId);
    } catch (err) {
      deps.log.error?.(`[bridge] members list failed: ${err.code || err.message}`);
    }
  }

  const missing = memberIds
    ? wanted.filter((id) => !memberIds.has(id))
    : wanted;
  await inviteAll(channelId, missing, deps);
  return { invited: missing, missing };
}

async function channelExists(channelId, deps) {
  if (!channelId) return false;
  try {
    if (deps.slack.channelInfo) {
      await deps.slack.channelInfo(channelId, deps.config.slackTeamId);
      return true;
    }
    if (deps.slack.listMemberIds) {
      await deps.slack.listMemberIds(channelId, deps.config.slackTeamId);
      return true;
    }
    return true;
  } catch (err) {
    if (err.code === "channel_not_found") return false;
    // missing_scope / other: assume maybe still valid; caller may fail later.
    deps.log.error?.(`[bridge] channel probe failed: ${err.code || err.message}`);
    return true;
  }
}

async function ensureChannel(phone, { name, inviteUserIds, assigneeUserId, origin }, deps) {
  // Always also invite SLACK_AGENT_USER_IDS (e.g. Akshat + Namit) on top of
  // vendor-mapped employees — additive, does not replace the mapping.
  const inviteList = [...(inviteUserIds || []), ...(deps.config.agentUserIds || [])];
  const existing = await deps.store.getContact(phone);
  if (existing?.channel_id) {
    const ok = await channelExists(existing.channel_id, deps);
    if (ok) {
      await ensureMappedMembers(existing.channel_id, inviteList, deps);
      if (name && name !== existing.name) await deps.store.upsertContact(phone, { name });
      if (!existing.assignee_user_id && assigneeUserId) {
        await deps.store.upsertContact(phone, { assigneeUserId });
      }
      return await deps.store.getContact(phone);
    }
    deps.log.warn?.(
      `[bridge] stale channel ${existing.channel_id} for ${maskPhone(phone)}; recreating`,
    );
    await deps.store.upsertContact(phone, { channelId: null });
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
  await ensureMappedMembers(channelId, inviteList, deps);
  await deps.slack.setPurpose?.(channelId, `WhatsApp +${phone}`, deps.config.slackTeamId);
  const who = name || "WhatsApp contact";
  const intro = origin === "inbound"
    ? `*${who}* · \`+${phone}\`\n${assigneeUserId ? `<@${assigneeUserId}> this one is yours. ` : ""}Reply in this channel and it goes to WhatsApp.`
    : `*${who}* · \`+${phone}\`\nThis chat was started with a template. Their reply will show up here. Answer in this channel after they write back. Until then, send another template from the WhatsApp Home tab.`;
  await deps.slack.postMessage({ channel: channelId, text: intro });
  return await deps.store.getContact(phone);
}

async function logInbound(deps, entry) {
  if (!deps.store.logMessage) return;
  try {
    await deps.store.logMessage(entry);
  } catch (err) {
    deps.log.error?.(`[bridge] message log failed: ${err.message}`);
  }
}

function assigneeForMappedInbound(existing, employees) {
  // Outbound-first: keep the Slack user who sent the template.
  if (existing?.assignee_user_id) return existing.assignee_user_id;
  // Pure inbound: one of the mapped employees (stable: first in mapping order).
  return employees[0]?.slack_user_id || null;
}

async function onReceived(payload, deps) {
  const data = payload.data || {};
  const rawPhone = data.contact?.phone || data.phone || data.from || data.to || "";
  const phone = phoneFrom(data);
  const eventTs = eventTimeSeconds(payload.timestamp);
  const payloadJson = JSON.stringify(payload).slice(0, 20_000);

  if (!phone) {
    deps.log.warn?.(`[bridge] inbound unmapped: invalid phone (${rawPhone || "missing"})`);
    await logInbound(deps, {
      phone: String(rawPhone || ""),
      status: "unmapped",
      timestamp: eventTs,
      payload: payloadJson,
      deliveryResult: "invalid_phone",
    });
    return;
  }

  const routing = deps.store.getVendorRouting
    ? await deps.store.getVendorRouting(phone)
    : null;
  const employees = routing?.employees || [];
  if (!routing?.vendor || !employees.length) {
    const reason = !routing?.vendor ? "unknown_vendor" : "no_mapped_employees";
    deps.log.info?.(
      `[bridge] inbound unmapped ${maskPhone(phone)} reason=${reason}`,
    );
    await logInbound(deps, {
      phone,
      status: "unmapped",
      timestamp: eventTs,
      payload: payloadJson,
      vendorName: routing?.vendor?.name ?? null,
      employeeSlackIds: "[]",
      deliveryResult: reason,
    });
    return;
  }

  const existing = await deps.store.getContact(phone);
  const view = formatInbound(data);
  const mappedIds = employees.map((employee) => employee.slack_user_id);
  const assignee = assigneeForMappedInbound(existing, employees);
  const inviteUserIds = [...mappedIds];
  // Keep the outbound starter in the channel even if they are not on the map.
  if (assignee && !inviteUserIds.includes(assignee)) inviteUserIds.push(assignee);

  deps.log.info?.(
    `[bridge] inbound ${maskPhone(phone)} vendor=${routing.vendor.name} employees=${mappedIds.join(",")}`,
  );

  let contact;
  try {
    contact = await ensureChannel(
      phone,
      {
        name: view.name || routing.vendor.name,
        inviteUserIds,
        assigneeUserId: assignee,
        origin: "inbound",
      },
      deps,
    );
  } catch (err) {
    deps.log.error?.(`[bridge] channel ensure failed: ${err.code || err.message}`);
    await logInbound(deps, {
      phone,
      status: "error",
      timestamp: eventTs,
      payload: payloadJson,
      vendorName: routing.vendor.name,
      employeeSlackIds: JSON.stringify(mappedIds),
      deliveryResult: `channel_failed:${err.code || err.message}`,
    });
    throw err;
  }

  const rendered = renderInbound(view);
  let deliveryResult = "posted";
  try {
    await deps.slack.postMessage({ channel: contact.channel_id, ...rendered });
  } catch (err) {
    if (err.code === "channel_not_found" && contact.channel_id) {
      deps.log.warn?.(
        `[bridge] post channel_not_found ${contact.channel_id}; clearing and recreating`,
      );
      await deps.store.upsertContact(phone, { channelId: null });
      contact = await ensureChannel(
        phone,
        {
          name: view.name || routing.vendor.name,
          inviteUserIds,
          assigneeUserId: assignee,
          origin: "inbound",
        },
        deps,
      );
      try {
        await deps.slack.postMessage({ channel: contact.channel_id, ...rendered });
      } catch (retryErr) {
        deliveryResult = `post_failed:${retryErr.code || retryErr.message}`;
        deps.log.error?.(`[bridge] slack post failed: ${retryErr.code || retryErr.message}`);
        await logInbound(deps, {
          phone,
          status: "error",
          timestamp: eventTs,
          payload: payloadJson,
          vendorName: routing.vendor.name,
          employeeSlackIds: JSON.stringify(mappedIds),
          deliveryResult,
        });
        throw retryErr;
      }
    } else {
      deliveryResult = `post_failed:${err.code || err.message}`;
      deps.log.error?.(`[bridge] slack post failed: ${err.code || err.message}`);
      await logInbound(deps, {
        phone,
        status: "error",
        timestamp: eventTs,
        payload: payloadJson,
        vendorName: routing.vendor.name,
        employeeSlackIds: JSON.stringify(mappedIds),
        deliveryResult,
      });
      throw err;
    }
  }

  const saved = await deps.store.upsertContact(phone, {
    name: view.name || routing.vendor.name,
    conversationId: data.conversation_id != null ? String(data.conversation_id) : undefined,
    lastInboundAt: eventTs,
    lastMessage: view.body,
    lastDirection: "in",
  });
  await logInbound(deps, {
    phone,
    status: "delivered",
    timestamp: eventTs,
    payload: payloadJson,
    vendorName: routing.vendor.name,
    employeeSlackIds: JSON.stringify(mappedIds),
    deliveryResult,
  });
  deps.log.info?.(
    `[bridge] inbound delivered ${maskPhone(phone)} vendor=${routing.vendor.name} channel=${contact.channel_id} result=${deliveryResult}`,
  );
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
