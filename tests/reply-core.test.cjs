const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/core.js");
const reply = require("../src/reply-core.js");

const settings = {
  enabled: true,
  rules: [
    { id: "interest", name: "有意向", keywords: ["有兴趣", "可以了解"], reply: "感谢回复，请问明天下午方便沟通吗？" },
    { id: "location", name: "地点", keywords: ["在哪里"], reply: "工作地点在杭州。" }
  ]
};

test("a unique rule produces its fixed reviewed reply", () => {
  const decision = reply.chooseReply("我有兴趣，可以聊聊", settings);
  assert.equal(decision.action, "reply");
  assert.equal(decision.ruleId, "interest");
});

test("stop words always prevent an automatic reply", () => {
  const decision = reply.chooseReply("我已找到工作，不要联系了", settings);
  assert.equal(decision.action, "stop");
});

test("zero or multiple rule matches fail closed", () => {
  assert.equal(reply.chooseReply("你好", settings).action, "manual");
  assert.equal(reply.chooseReply("有兴趣，但是在哪里", settings).action, "manual");
});

test("duplicate enabled triggers are rejected", () => {
  const duplicate = { ...settings, rules: [...settings.rules, { id: "dup", name: "重复", keywords: ["有兴趣"], reply: "另一条" }] };
  assert.match(reply.validateReplySettings(duplicate).errors.join(";"), /重复/);
});

test("reply limits cover daily, per-conversation and minimum interval", () => {
  assert.equal(reply.replyAllowed({ todayCount: 20, conversationCount: 0, lastReplyAt: 0 }, settings).allowed, false);
  assert.equal(reply.replyAllowed({ todayCount: 0, conversationCount: 3, lastReplyAt: 0 }, settings).allowed, false);
  assert.equal(reply.replyAllowed({ todayCount: 0, conversationCount: 0, lastReplyAt: Date.now() }, settings).allowed, false);
  assert.equal(reply.replyAllowed({ todayCount: 0, conversationCount: 0, lastReplyAt: 0 }, settings).allowed, true);
});
