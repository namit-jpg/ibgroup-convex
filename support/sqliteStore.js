import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function ensureColumn(db, table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export function createStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY,
      name TEXT,
      channel_id TEXT,
      conversation_id TEXT,
      last_inbound_at INTEGER,
      opted_out INTEGER NOT NULL DEFAULT 0,
      assignee_user_id TEXT,
      last_message TEXT,
      last_direction TEXT,
      origin TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbound (
      wamid TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      channel_id TEXT,
      slack_ts TEXT,
      slack_user_id TEXT,
      template_name TEXT,
      preview TEXT,
      status TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS round_robin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      idx INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      slack_user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendors (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendor_employee_mappings (
      vendor_phone TEXT NOT NULL,
      employee_slack_user_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (vendor_phone, employee_slack_user_id)
    );
    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL,
      vendor_name TEXT,
      employee_slack_ids TEXT,
      delivery_result TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS claims_created ON claims(created_at);
    CREATE INDEX IF NOT EXISTS contacts_channel ON contacts(channel_id);
    CREATE INDEX IF NOT EXISTS outbound_phone ON outbound(phone, created_at);
    CREATE INDEX IF NOT EXISTS message_logs_phone ON message_logs(phone, created_at);
  `);
  ensureColumn(db, "contacts", "assignee_user_id", "TEXT");
  ensureColumn(db, "contacts", "last_message", "TEXT");
  ensureColumn(db, "contacts", "last_direction", "TEXT");
  ensureColumn(db, "contacts", "origin", "TEXT");
  ensureColumn(db, "outbound", "slack_user_id", "TEXT");
  ensureColumn(db, "outbound", "template_name", "TEXT");
  ensureColumn(db, "outbound", "preview", "TEXT");
  ensureColumn(db, "outbound", "status", "TEXT");
  ensureColumn(db, "outbound", "error", "TEXT");

  const insertClaim = db.prepare("INSERT OR IGNORE INTO claims (id, created_at) VALUES (?, ?)");
  const deleteClaim = db.prepare("DELETE FROM claims WHERE id = ?");
  const pruneClaims = db.prepare("DELETE FROM claims WHERE created_at < ?");
  const selectContact = db.prepare("SELECT * FROM contacts WHERE phone = ?");
  const selectChannel = db.prepare("SELECT * FROM contacts WHERE channel_id = ?");
  const upsert = db.prepare(`
    INSERT INTO contacts (
      phone, name, channel_id, conversation_id, last_inbound_at, opted_out,
      assignee_user_id, last_message, last_direction, origin, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      channel_id = excluded.channel_id,
      conversation_id = excluded.conversation_id,
      last_inbound_at = excluded.last_inbound_at,
      opted_out = excluded.opted_out,
      assignee_user_id = excluded.assignee_user_id,
      last_message = excluded.last_message,
      last_direction = excluded.last_direction,
      origin = excluded.origin,
      updated_at = excluded.updated_at
  `);
  const insertOutbound = db.prepare(`
    INSERT INTO outbound (
      wamid, phone, channel_id, slack_ts, slack_user_id, template_name, preview, status, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wamid) DO UPDATE SET
      phone = excluded.phone,
      channel_id = COALESCE(excluded.channel_id, outbound.channel_id),
      slack_ts = COALESCE(excluded.slack_ts, outbound.slack_ts),
      slack_user_id = COALESCE(excluded.slack_user_id, outbound.slack_user_id),
      template_name = COALESCE(excluded.template_name, outbound.template_name),
      preview = COALESCE(excluded.preview, outbound.preview),
      status = CASE
        WHEN excluded.status IS NULL OR excluded.status = '' THEN outbound.status
        WHEN outbound.status IN ('read', 'delivered') AND excluded.status = 'sent' THEN outbound.status
        ELSE excluded.status
      END,
      error = COALESCE(excluded.error, outbound.error)
  `);
  const selectOutbound = db.prepare("SELECT * FROM outbound WHERE wamid = ?");
  const selectLatestOutbound = db.prepare(
    "SELECT * FROM outbound WHERE phone = ? ORDER BY created_at DESC LIMIT 1",
  );
  const selectHome = db.prepare(`
    SELECT * FROM contacts
    WHERE assignee_user_id = ?
       OR phone IN (SELECT phone FROM outbound WHERE slack_user_id = ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const selectRota = db.prepare("SELECT idx FROM round_robin WHERE id = 1");
  const upsertRota = db.prepare(`
    INSERT INTO round_robin (id, idx) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET idx = excluded.idx
  `);
  // Keep prepared statements on the store object so node:sqlite does not GC-finalize them.
  const sql = {
    insertClaim,
    deleteClaim,
    pruneClaims,
    selectContact,
    selectChannel,
    upsert,
    insertOutbound,
    selectOutbound,
    selectLatestOutbound,
    selectHome,
    selectRota,
    upsertRota,
    upsertEmployeeStmt: db.prepare(`
      INSERT INTO employees (slack_user_id, name, email, phone, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slack_user_id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        active = excluded.active,
        updated_at = excluded.updated_at
    `),
    upsertVendorStmt: db.prepare(`
      INSERT INTO vendors (phone, name, active, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = excluded.name,
        active = excluded.active,
        updated_at = excluded.updated_at
    `),
    upsertMappingStmt: db.prepare(`
      INSERT INTO vendor_employee_mappings (vendor_phone, employee_slack_user_id, active, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(vendor_phone, employee_slack_user_id) DO UPDATE SET
        active = excluded.active,
        updated_at = excluded.updated_at
    `),
    selectVendor: db.prepare("SELECT * FROM vendors WHERE phone = ?"),
    selectMappings: db.prepare(
      "SELECT * FROM vendor_employee_mappings WHERE vendor_phone = ? AND active = 1",
    ),
    selectEmployee: db.prepare("SELECT * FROM employees WHERE slack_user_id = ?"),
    insertMessageLog: db.prepare(`
      INSERT INTO message_logs (
        phone, status, timestamp, payload, vendor_name, employee_slack_ids, delivery_result, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectMessageLogs: db.prepare(
      "SELECT * FROM message_logs WHERE phone = ? ORDER BY created_at DESC",
    ),
  };

  function mapContact(row) {
    if (!row) return null;
    return { ...row, opted_out: Boolean(row.opted_out) };
  }

  function writeContact(phone, patch) {
    const prev = sql.selectContact.get(phone);
    const row = {
      phone,
      name: patch.name !== undefined ? patch.name : prev?.name ?? null,
      channel_id: patch.channelId !== undefined ? patch.channelId : prev?.channel_id ?? null,
      conversation_id:
        patch.conversationId !== undefined ? patch.conversationId : prev?.conversation_id ?? null,
      last_inbound_at:
        patch.lastInboundAt !== undefined ? patch.lastInboundAt : prev?.last_inbound_at ?? null,
      opted_out: patch.optedOut !== undefined ? (patch.optedOut ? 1 : 0) : prev?.opted_out ?? 0,
      assignee_user_id:
        patch.assigneeUserId !== undefined ? patch.assigneeUserId : prev?.assignee_user_id ?? null,
      last_message: patch.lastMessage !== undefined ? patch.lastMessage : prev?.last_message ?? null,
      last_direction:
        patch.lastDirection !== undefined ? patch.lastDirection : prev?.last_direction ?? null,
      origin: patch.origin !== undefined ? patch.origin : prev?.origin ?? null,
      updated_at: Date.now(),
    };
    sql.upsert.run(
      row.phone,
      row.name,
      row.channel_id,
      row.conversation_id,
      row.last_inbound_at,
      row.opted_out,
      row.assignee_user_id,
      row.last_message,
      row.last_direction,
      row.origin,
      row.updated_at,
    );
    return mapContact(sql.selectContact.get(phone));
  }

  const store = {
    _db: db,
    _sql: sql,
    claim(id) {
      if (!id) return true;
      sql.pruneClaims.run(Date.now() - WEEK_MS);
      return sql.insertClaim.run(id, Date.now()).changes === 1;
    },
    release(id) {
      if (!id) return;
      sql.deleteClaim.run(id);
    },
    getContact(phone) {
      return mapContact(sql.selectContact.get(phone));
    },
    getByChannel(channelId) {
      if (!channelId) return null;
      return mapContact(sql.selectChannel.get(channelId));
    },
    upsertContact(phone, patch = {}) {
      return writeContact(phone, patch);
    },
    nextAssignee(agentIds) {
      const agents = (agentIds || []).filter(Boolean);
      if (!agents.length) return null;
      const current = sql.selectRota.get()?.idx ?? 0;
      const chosen = agents[current % agents.length];
      sql.upsertRota.run((current + 1) % agents.length);
      return chosen;
    },
    rememberOutbound(entry) {
      if (!entry?.wamid) return;
      sql.insertOutbound.run(
        entry.wamid,
        entry.phone,
        entry.channelId ?? null,
        entry.slackTs ?? null,
        entry.slackUserId ?? null,
        entry.templateName ?? null,
        entry.preview ?? null,
        entry.status ?? null,
        entry.error ?? null,
        Date.now(),
      );
    },
    getOutbound(wamid) {
      if (!wamid) return null;
      return sql.selectOutbound.get(wamid) ?? null;
    },
    listHomeCards(userId, limit = 8) {
      return sql.selectHome.all(userId, userId, limit).map((row) => ({
        ...mapContact(row),
        latest: sql.selectLatestOutbound.get(row.phone) ?? null,
      }));
    },
    upsertEmployee({ slackUserId, name, email = null, phone = null, active = true }) {
      sql.upsertEmployeeStmt.run(slackUserId, name, email, phone, active ? 1 : 0, Date.now());
    },
    upsertVendor({ phone, name, active = true }) {
      sql.upsertVendorStmt.run(phone, name, active ? 1 : 0, Date.now());
    },
    upsertVendorEmployeeMapping({ vendorPhone, employeeSlackUserId, active = true }) {
      sql.upsertMappingStmt.run(vendorPhone, employeeSlackUserId, active ? 1 : 0, Date.now());
    },
    getVendorRouting(phone) {
      if (!phone) return null;
      const vendor = sql.selectVendor.get(phone);
      if (!vendor || !vendor.active) return null;
      const employees = [];
      for (const mapping of sql.selectMappings.all(phone)) {
        const employee = sql.selectEmployee.get(mapping.employee_slack_user_id);
        if (employee?.active) {
          employees.push({
            slack_user_id: employee.slack_user_id,
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
          });
        }
      }
      return {
        vendor: { phone: vendor.phone, name: vendor.name },
        employees,
      };
    },
    logMessage(entry) {
      sql.insertMessageLog.run(
        entry.phone || "",
        entry.status,
        entry.timestamp,
        entry.payload || "",
        entry.vendorName ?? null,
        entry.employeeSlackIds ?? null,
        entry.deliveryResult ?? null,
        Date.now(),
      );
    },
    listMessageLogs(phone) {
      return sql.selectMessageLogs.all(phone);
    },
  };
  return store;
}
