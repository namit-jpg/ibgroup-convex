import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

function mapContact(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    name: row.name,
    channel_id: row.channelId,
    conversation_id: row.conversationId,
    last_inbound_at: row.lastInboundAt,
    opted_out: Boolean(row.optedOut),
    assignee_user_id: row.assigneeUserId,
    last_message: row.lastMessage,
    last_direction: row.lastDirection,
    origin: row.origin,
    updated_at: row.updatedAt,
  };
}

function mapOutbound(row) {
  if (!row) return null;
  return {
    wamid: row.wamid,
    phone: row.phone,
    channel_id: row.channelId,
    slack_ts: row.slackTs,
    slack_user_id: row.slackUserId,
    template_name: row.templateName,
    preview: row.preview,
    status: row.status,
    error: row.error,
    created_at: row.createdAt,
  };
}

function keep(next, prev) {
  return next === undefined ? prev ?? null : next;
}

export const getContact = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const row = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    return mapContact(row);
  },
});

export const getByChannel = internalQuery({
  args: { channelId: v.string() },
  handler: async (ctx, { channelId }) => {
    if (!channelId) return null;
    const row = await ctx.db
      .query("contacts")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .unique();
    return mapContact(row);
  },
});

export const getOutbound = internalQuery({
  args: { wamid: v.string() },
  handler: async (ctx, { wamid }) => {
    if (!wamid) return null;
    const row = await ctx.db
      .query("outbound")
      .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
      .unique();
    return mapOutbound(row);
  },
});

export const listHomeCards = internalQuery({
  args: { userId: v.string(), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    const assigned = await ctx.db
      .query("contacts")
      .withIndex("by_assignee", (q) => q.eq("assigneeUserId", userId))
      .collect();
    const sent = await ctx.db
      .query("outbound")
      .withIndex("by_slack_user", (q) => q.eq("slackUserId", userId))
      .collect();
    const seen = new Set(assigned.map((row) => row.phone));
    const rows = [...assigned];
    for (const item of sent) {
      if (seen.has(item.phone)) continue;
      seen.add(item.phone);
      const contact = await ctx.db
        .query("contacts")
        .withIndex("by_phone", (q) => q.eq("phone", item.phone))
        .unique();
      if (contact) rows.push(contact);
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const cards = [];
    for (const row of rows.slice(0, limit)) {
      const latest = await ctx.db
        .query("outbound")
        .withIndex("by_phone", (q) => q.eq("phone", row.phone))
        .order("desc")
        .first();
      cards.push({ ...mapContact(row), latest: mapOutbound(latest) });
    }
    return cards;
  },
});

const patch = v.object({
  name: v.optional(v.union(v.string(), v.null())),
  channelId: v.optional(v.union(v.string(), v.null())),
  conversationId: v.optional(v.union(v.string(), v.null())),
  lastInboundAt: v.optional(v.union(v.number(), v.null())),
  optedOut: v.optional(v.boolean()),
  assigneeUserId: v.optional(v.union(v.string(), v.null())),
  lastMessage: v.optional(v.union(v.string(), v.null())),
  lastDirection: v.optional(v.union(v.string(), v.null())),
  origin: v.optional(v.union(v.string(), v.null())),
});

export const upsertContact = internalMutation({
  args: { phone: v.string(), patch },
  handler: async (ctx, { phone, patch: incoming }) => {
    const prev = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    const row = {
      phone,
      name: keep(incoming.name, prev?.name),
      channelId: keep(incoming.channelId, prev?.channelId),
      conversationId: keep(incoming.conversationId, prev?.conversationId),
      lastInboundAt: keep(incoming.lastInboundAt, prev?.lastInboundAt),
      optedOut: incoming.optedOut !== undefined ? incoming.optedOut : prev?.optedOut ?? false,
      assigneeUserId: keep(incoming.assigneeUserId, prev?.assigneeUserId),
      lastMessage: keep(incoming.lastMessage, prev?.lastMessage),
      lastDirection: keep(incoming.lastDirection, prev?.lastDirection),
      origin: keep(incoming.origin, prev?.origin),
      updatedAt: Date.now(),
    };
    if (prev) await ctx.db.patch(prev._id, row);
    else await ctx.db.insert("contacts", row);
    const saved = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    return mapContact(saved);
  },
});

function coalesce(next, prev) {
  return next == null || next === "" ? prev ?? null : next;
}

function nextStatus(current, incoming) {
  if (incoming == null || incoming === "") return current ?? null;
  if ((current === "read" || current === "delivered") && incoming === "sent") return current;
  return incoming;
}

export const rememberOutbound = internalMutation({
  args: {
    wamid: v.string(),
    phone: v.string(),
    channelId: v.optional(v.union(v.string(), v.null())),
    slackTs: v.optional(v.union(v.string(), v.null())),
    slackUserId: v.optional(v.union(v.string(), v.null())),
    templateName: v.optional(v.union(v.string(), v.null())),
    preview: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.string(), v.null())),
    error: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, entry) => {
    if (!entry.wamid) return;
    const prev = await ctx.db
      .query("outbound")
      .withIndex("by_wamid", (q) => q.eq("wamid", entry.wamid))
      .unique();
    const row = {
      wamid: entry.wamid,
      phone: entry.phone,
      channelId: coalesce(entry.channelId, prev?.channelId),
      slackTs: coalesce(entry.slackTs, prev?.slackTs),
      slackUserId: coalesce(entry.slackUserId, prev?.slackUserId),
      templateName: coalesce(entry.templateName, prev?.templateName),
      preview: coalesce(entry.preview, prev?.preview),
      status: nextStatus(prev?.status, entry.status),
      error: coalesce(entry.error, prev?.error),
      createdAt: prev?.createdAt ?? Date.now(),
    };
    if (prev) await ctx.db.patch(prev._id, row);
    else await ctx.db.insert("outbound", row);
  },
});

export const claim = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    if (!id) return true;
    const existing = await ctx.db
      .query("claims")
      .withIndex("by_claim", (q) => q.eq("claimId", id))
      .unique();
    if (existing) return false;
    await ctx.db.insert("claims", { claimId: id, createdAt: Date.now() });
    return true;
  },
});

export const release = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    if (!id) return;
    const existing = await ctx.db
      .query("claims")
      .withIndex("by_claim", (q) => q.eq("claimId", id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const nextAssignee = internalMutation({
  args: { agentIds: v.array(v.string()) },
  handler: async (ctx, { agentIds }) => {
    const agents = agentIds.filter(Boolean);
    if (!agents.length) return null;
    const row = await ctx.db
      .query("roundRobin")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    const current = row?.idx ?? 0;
    const chosen = agents[current % agents.length];
    const next = (current + 1) % agents.length;
    if (row) await ctx.db.patch(row._id, { idx: next });
    else await ctx.db.insert("roundRobin", { key: "default", idx: next });
    return chosen;
  },
});
