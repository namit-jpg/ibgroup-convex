import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone } from "./lib/bridge.js";

/**
 * Idempotent upsert of employees, vendors, and mappings.
 * Safe to re-run after editing data/vendor-routing.json (via scripts/seed-vendor-routing.mjs).
 */
export const upsertAll = mutation({
  args: {
    employees: v.array(
      v.object({
        slack_user_id: v.string(),
        name: v.string(),
        email: v.optional(v.union(v.string(), v.null())),
        phone: v.optional(v.union(v.string(), v.null())),
        active: v.optional(v.boolean()),
      }),
    ),
    vendors: v.array(
      v.object({
        name: v.string(),
        phone: v.string(),
        active: v.optional(v.boolean()),
      }),
    ),
    mappings: v.array(
      v.object({
        vendor_phone: v.string(),
        employee_slack_user_id: v.string(),
        active: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { employees, vendors, mappings }) => {
    const now = Date.now();
    let employeeCount = 0;
    let vendorCount = 0;
    let mappingCount = 0;

    for (const entry of employees) {
      const slackUserId = String(entry.slack_user_id || "").trim();
      if (!slackUserId) continue;
      const phone = entry.phone ? normalizePhone(entry.phone) : "";
      if (entry.phone && !phone) {
        throw new Error(`employee ${slackUserId}: phone could not be normalized (${entry.phone})`);
      }
      const prev = await ctx.db
        .query("employees")
        .withIndex("by_slack_user", (q) => q.eq("slackUserId", slackUserId))
        .unique();
      const row = {
        slackUserId,
        name: entry.name,
        email: entry.email ?? null,
        phone: phone || null,
        active: entry.active !== undefined ? Boolean(entry.active) : true,
        updatedAt: now,
      };
      if (prev) await ctx.db.patch(prev._id, row);
      else await ctx.db.insert("employees", row);
      employeeCount += 1;
    }

    for (const entry of vendors) {
      const phone = normalizePhone(entry.phone);
      if (!phone) throw new Error(`vendor ${entry.name}: phone could not be normalized (${entry.phone})`);
      const prev = await ctx.db
        .query("vendors")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .unique();
      const row = {
        phone,
        name: entry.name,
        active: entry.active !== undefined ? Boolean(entry.active) : true,
        updatedAt: now,
      };
      if (prev) await ctx.db.patch(prev._id, row);
      else await ctx.db.insert("vendors", row);
      vendorCount += 1;
    }

    for (const entry of mappings) {
      const vendorPhone = normalizePhone(entry.vendor_phone);
      const employeeSlackUserId = String(entry.employee_slack_user_id || "").trim();
      if (!vendorPhone || !employeeSlackUserId) {
        throw new Error(
          `mapping skipped/invalid: vendor_phone=${entry.vendor_phone} employee=${entry.employee_slack_user_id}`,
        );
      }
      const prev = await ctx.db
        .query("vendorEmployeeMappings")
        .withIndex("by_vendor_employee", (q) =>
          q.eq("vendorPhone", vendorPhone).eq("employeeSlackUserId", employeeSlackUserId),
        )
        .unique();
      const row = {
        vendorPhone,
        employeeSlackUserId,
        active: entry.active !== undefined ? Boolean(entry.active) : true,
        updatedAt: now,
      };
      if (prev) await ctx.db.patch(prev._id, row);
      else await ctx.db.insert("vendorEmployeeMappings", row);
      mappingCount += 1;
    }

    return { employeeCount, vendorCount, mappingCount };
  },
});
