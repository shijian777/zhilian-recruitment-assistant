const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("empty filters allow a candidate", () => {
  const decision = core.evaluateCandidate({ text: "张三 杭州 销售经理 10-15K" }, {});
  assert.equal(decision.matched, true);
});

test("filled filter categories are AND while values inside a category are OR", () => {
  const settings = {
    keywords: ["销售", "客户开发"],
    cities: ["上海", "杭州"],
    salaryMinK: 12,
    salaryMaxK: 20
  };
  assert.equal(core.evaluateCandidate({ text: "杭州 销售经理 10-15K" }, settings).matched, true);
  assert.equal(core.evaluateCandidate({ text: "苏州 销售经理 10-15K" }, settings).matched, false);
});

test("salary parsing handles K, thousand and ten-thousand monthly units", () => {
  assert.deepEqual(core.parseSalaryRanges("12-20K"), [{ minimum: 12, maximum: 20 }]);
  assert.deepEqual(core.parseSalaryRanges("8-12千/月"), [{ minimum: 8, maximum: 12 }]);
  assert.deepEqual(core.parseSalaryRanges("1.5-2万/月"), [{ minimum: 15, maximum: 20 }]);
});

test("missing salary fails closed when salary filter is enabled", () => {
  const decision = core.evaluateCandidate({ text: "杭州 销售经理" }, { salaryMinK: 10 });
  assert.equal(decision.matched, false);
  assert.match(decision.reason, /未识别到薪资/);
});

test("settings default to dry run and validate limits", () => {
  assert.equal(core.mergeSettings({}).dryRun, true);
  assert.ok(core.validateSettings({ sessionLimit: 0 }).errors.length > 0);
  assert.equal(core.validateSettings({ sessionLimit: 10, dailyLimit: 100, intervalSeconds: 5 }).errors.length, 0);
});

test("candidate keys are deterministic", () => {
  assert.equal(core.stableKey("张三 | 销售"), core.stableKey("  张三  |  销售 "));
  assert.notEqual(core.stableKey("张三"), core.stableKey("李四"));
});

test("dry-run matches do not block a later formal run", () => {
  assert.equal(core.handledBlocks("dry_run_match", true), true);
  assert.equal(core.handledBlocks("dry_run_match", false), false);
  assert.equal(core.handledBlocks("filtered", false), false);
  assert.equal(core.handledBlocks("sent", false), true);
});
