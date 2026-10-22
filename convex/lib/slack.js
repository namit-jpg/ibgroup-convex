function slackError(method, json) {
  const detail = Array.isArray(json.response_metadata?.messages)
    ? json.response_metadata.messages.filter(Boolean).join("; ")
    : "";
  const err = new Error(`${method}: ${json.error || "failed"}${detail ? ` (${detail})` : ""}`);
  err.code = json.error;
  return err;
}

function formBody(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    body.set(key, String(value));
  }
  return body.toString();
}

export function createSlack(token, log = console) {
  async function api(method, body, { form = false } = {}) {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8",
      },
      body: form ? formBody(body) : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) throw slackError(method, json);
    return json;
  }

  return {
    postMessage(args) {
      return api("chat.postMessage", { unfurl_links: true, unfurl_media: false, ...args });
    },
    async download(url) {
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        throw new Error("Missing Slack file link");
      }
      const allowed = host === "files.slack.com" || host.endsWith(".slack.com") || host === "slack-files.com" || host.endsWith(".slack-files.com");
      if (!allowed) throw new Error("Slack file link is not on Slack");
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Slack file download failed (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: (res.headers.get("content-type") || "").split(";")[0].trim(),
      };
    },
    async uploadFile({ channel, filename, title, bytes, altText }) {
      // This method ignores a JSON body and then reports the required fields as missing.
      const started = await api("files.getUploadURLExternal", {
        filename,
        length: bytes.byteLength,
        ...(altText ? { alt_txt: String(altText).slice(0, 1000) } : {}),
      }, { form: true });
      // Slack infers type from the filename. Office MIME types on this POST
      // make Word/Excel land as application/octet-stream (.bin) with no preview.
      const upload = await fetch(started.upload_url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (!upload.ok) throw new Error(`Slack file upload failed (${upload.status})`);
      return api("files.completeUploadExternal", {
        files: [{ id: started.file_id, title: title || filename }],
        channel_id: channel,
      });
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
