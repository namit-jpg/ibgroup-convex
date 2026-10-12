import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());

export default defineSchema({
  contacts: defineTable({
    phone: v.string(),
    name: nullableString,
    channelId: nullableString,
    conversationId: nullableString,
    lastInboundAt: nullableNumber,
    optedOut: v.boolean(),
    assigneeUserId: nullableString,
    lastMessage: nullableString,
    lastDirection: nullableString,
    origin: nullableString,
    updatedAt: v.number(),
  })
    .index("by_phone", ["phone"])
    .index("by_channel", ["channelId"])
    .index("by_assignee", ["assigneeUserId", "updatedAt"]),

  outbound: defineTable({
    wamid: v.string(),
    phone: v.string(),
    channelId: nullableString,
    slackTs: nullableString,
    slackUserId: nullableString,
    templateName: nullableString,
    preview: nullableString,
    status: nullableString,
    error: nullableString,
    createdAt: v.number(),
  })
    .index("by_wamid", ["wamid"])
    .index("by_phone", ["phone", "createdAt"])
    .index("by_slack_user", ["slackUserId"]),

  claims: defineTable({
    claimId: v.string(),
    createdAt: v.number(),
  }).index("by_claim", ["claimId"]),

  roundRobin: defineTable({
    key: v.string(),
    idx: v.number(),
  }).index("by_key", ["key"]),
});
