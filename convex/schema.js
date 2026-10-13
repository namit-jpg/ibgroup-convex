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

  employees: defineTable({
    slackUserId: v.string(),
    name: v.string(),
    email: nullableString,
    phone: nullableString,
    active: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_slack_user", ["slackUserId"])
    .index("by_phone", ["phone"]),

  vendors: defineTable({
    phone: v.string(),
    name: v.string(),
    active: v.boolean(),
    updatedAt: v.number(),
  }).index("by_phone", ["phone"]),

  vendorEmployeeMappings: defineTable({
    vendorPhone: v.string(),
    employeeSlackUserId: v.string(),
    active: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_vendor", ["vendorPhone"])
    .index("by_vendor_employee", ["vendorPhone", "employeeSlackUserId"]),

  messageLogs: defineTable({
    phone: v.string(),
    status: v.string(),
    timestamp: v.number(),
    payload: v.string(),
    vendorName: nullableString,
    employeeSlackIds: nullableString,
    deliveryResult: nullableString,
    createdAt: v.number(),
  })
    .index("by_phone", ["phone", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  claims: defineTable({
    claimId: v.string(),
    createdAt: v.number(),
  }).index("by_claim", ["claimId"]),

  roundRobin: defineTable({
    key: v.string(),
    idx: v.number(),
  }).index("by_key", ["key"]),
});
