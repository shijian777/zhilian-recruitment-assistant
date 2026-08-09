const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("manifest is a scoped MV3 extension", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.zhaopin.com/*"]);
  assert.ok(manifest.content_scripts[0].js.includes("src/content.js"));
  assert.ok(manifest.content_scripts[0].js.includes("src/reply-content.js"));
  assert.equal(manifest.options_page, "options/options.html");
});

test("popup repairs a missing content-script connection before retrying", () => {
  const popup = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");
  assert.match(popup, /Receiving end does not exist/);
  assert.match(popup, /chrome\.scripting\.executeScript/);
  assert.match(popup, /src\/reply-content\.js/);
});

test("content scripts are safe to inject more than once", () => {
  const invitation = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  const reply = fs.readFileSync(path.join(root, "src", "reply-content.js"), "utf8");
  assert.match(invitation, /__ZhaopinInvitationAdapterLoaded/);
  assert.match(reply, /__ZhaopinStrictAutoReplyLoaded/);
});

test("nested button wrappers collapse to one candidate action", () => {
  const invitation = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  assert.match(invitation, /function canonicalActionElement/);
  assert.match(invitation, /new Set\(matches\)/);
  assert.match(invitation, /element\.contains\(other\)/);
  assert.match(invitation, /cardActionCounts/);
});

test("a new dry run clears only old dry-run matches and keeps daily sent count", () => {
  const invitation = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  assert.match(invitation, /item\?\.status !== "dry_run_match"/);
  assert.match(invitation, /previousRuntime\.date === today/);
  assert.match(invitation, /freshRuntime\(\), sent: todaySent/);
});

test("popup keeps live status visible and prevents horizontal detail overflow", () => {
  const html = fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");
  const popup = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");
  assert.match(html, /class="status-sticky"/);
  assert.match(html, /id="currentCandidate"/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(popup, /#currentCandidate/);
});

test("strict auto reply requires direction, fixed rules and post-send verification", () => {
  const replyContent = fs.readFileSync(path.join(root, "src", "reply-content.js"), "utf8");
  const options = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  assert.match(replyContent, /direction === "unknown"/);
  assert.match(replyContent, /发送前来信已变化/);
  assert.match(replyContent, /verifyReply/);
  assert.match(replyContent, /输入框已有未发送草稿/);
  assert.match(options, /chooseReply/);
});

test("formal sending keeps confirmation and fail-closed checks", () => {
  const popup = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  assert.match(popup, /confirm\(/);
  assert.match(content, /actions\.length !== 1/);
  assert.match(content, /需要人工核对/);
  assert.match(content, /安全验证/);
});
