export function createSlack(token, log = console) {
  async function api(method, body) {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) {
      const err = new Error(`${method}: ${json.error || "failed"}`);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  return {
    postMessage(args) {
      return api("chat.postMessage", { unfurl_links: true, unfurl_media: false, ...args });
    },
    async addReaction(args) {
      try {
        await api("reactions.add", args);
      } catch (err) {
        if (err.code === "already_reacted" || err.code === "message_not_found") return;
        log.error?.(`[bridge] reaction failed: ${err.code || err.message}`);
      }
    },
    async createChannel({ name, isPrivate, teamId }) {
      const base = { name, is_private: Boolean(isPrivate) };
      if (teamId) base.team_id = teamId;
      try {
        const created = await api("conversations.create", base);
        return created.channel;
      } catch (err) {
        if (err.code !== "name_taken") throw err;
        const created = await api("conversations.create", {
          ...base,
          name: `${name.slice(0, 72)}-${Date.now().toString().slice(-4)}`,
        });
        return created.channel;
      }
    },
    async invite(channel, userId, teamId) {
      if (!userId) return;
      const body = { channel, users: userId };
      if (teamId) body.team_id = teamId;
      try {
        await api("conversations.invite", body);
      } catch (err) {
        if (["already_in_channel", "cant_invite_self", "cant_invite"].includes(err.code)) return;
        throw err;
      }
    },
    async channelInfo(channel, teamId) {
      const body = { channel };
      if (teamId) body.team_id = teamId;
      const json = await api("conversations.info", body);
      return json.channel;
    },
    async listMemberIds(channel, teamId) {
      const members = new Set();
      let cursor;
      do {
        const body = { channel, limit: 200 };
        if (teamId) body.team_id = teamId;
        if (cursor) body.cursor = cursor;
        const json = await api("conversations.members", body);
        for (const id of json.members || []) members.add(id);
        cursor = json.response_metadata?.next_cursor || "";
      } while (cursor);
      return members;
    },
    async setPurpose(channel, purpose, teamId) {
      const body = { channel, purpose: String(purpose).slice(0, 250) };
      if (teamId) body.team_id = teamId;
      try {
        await api("conversations.setPurpose", body);
      } catch (err) {
        log.error?.(`[bridge] channel purpose not set: ${err.code || err.message}`);
      }
    },
    publishView(userId, view) {
      return api("views.publish", { user_id: userId, view });
    },
    viewsOpen(triggerId, view) {
      return api("views.open", { trigger_id: triggerId, view });
    },
    viewsUpdate(viewId, view) {
      return api("views.update", { view_id: viewId, view });
    },
  };
}
