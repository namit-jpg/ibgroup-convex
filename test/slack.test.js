import assert from "node:assert/strict";
import test from "node:test";
import { createSlack } from "../convex/lib/slack.js";

test("Slack file uploads send raw bytes as octet-stream so Word stays Word", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    calls.push({ href, opts });
    if (href.endsWith("files.getUploadURLExternal")) {
      return {
        json: async () => ({ ok: true, upload_url: "https://files.slack.com/upload/v1/x", file_id: "F1" }),
      };
    }
    if (href.endsWith("files.completeUploadExternal")) {
      return { json: async () => ({ ok: true, files: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const slack = createSlack("xoxb-test");
    await slack.uploadFile({
      channel: "C1",
      filename: "po.docx",
      title: "po.docx",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } finally {
    globalThis.fetch = original;
  }

  const started = calls.find((call) => call.href.endsWith("files.getUploadURLExternal"));
  assert.match(started.opts.headers["Content-Type"], /application\/x-www-form-urlencoded/);
  const startedBody = new URLSearchParams(started.opts.body);
  assert.equal(startedBody.get("filename"), "po.docx");
  assert.equal(startedBody.get("length"), "3");
  const posted = calls.find((call) => call.href === "https://files.slack.com/upload/v1/x");
  assert.equal(posted.opts.headers["Content-Type"], "application/octet-stream");
  assert.equal(posted.opts.body.byteLength, 3);
  const finished = calls.find((call) => call.href.endsWith("files.completeUploadExternal"));
  assert.equal(JSON.parse(finished.opts.body).files[0].title, "po.docx");
});

test("Slack user lookup is form encoded so the sender name is returned", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    if (href.endsWith("users.info")) {
      const body = new URLSearchParams(opts.body);
      if (body.get("user") !== "U1") {
        return { json: async () => ({ ok: false, error: "user_not_found" }) };
      }
      return {
        json: async () => ({ ok: true, user: { profile: { display_name: "Namit D", real_name: "Namit Dasappanavar" } } }),
      };
    }
    return { json: async () => ({ ok: false, error: "unexpected" }) };
  };
  try {
    const slack = createSlack("xoxb-test");
    assert.equal(await slack.userName("U1"), "Namit D");
    assert.equal(await slack.userName("U1"), "Namit D");
  } finally {
    globalThis.fetch = original;
  }
});
