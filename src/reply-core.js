(function attachReplyCore(root, factory) {
  const api = factory(root.ZhaopinCore);
  root.ZhaopinReplyCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildReplyCore(sharedCore) {
  "use strict";

  const normalize = sharedCore?.normalize || ((value) => String(value || "").trim().toLowerCase());
  const splitTerms = sharedCore?.splitTerms || ((value) => String(value || "").split(/[,，\s]+/).filter(Boolean));
  const DEFAULT_REPLY_SETTINGS = Object.freeze({
    enabled: false,
    pollSeconds: 10,
    dailyLimit: 20,
    perConversationLimit: 3,
    intervalSeconds: 10,
    stopKeywords: ["不感兴趣", "不考虑", "不用了", "不要联系", "已找到工作"],
    rules: []
  });

  function mergeReplySettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const rules = Array.isArray(input.rules) ? input.rules : [];
    return {
      ...DEFAULT_REPLY_SETTINGS,
      ...input,
      enabled: input.enabled === true,
      pollSeconds: Number(input.pollSeconds ?? DEFAULT_REPLY_SETTINGS.pollSeconds),
      dailyLimit: Number(input.dailyLimit ?? DEFAULT_REPLY_SETTINGS.dailyLimit),
      perConversationLimit: Number(input.perConversationLimit ?? DEFAULT_REPLY_SETTINGS.perConversationLimit),
      intervalSeconds: Number(input.intervalSeconds ?? DEFAULT_REPLY_SETTINGS.intervalSeconds),
      stopKeywords: splitTerms(input.stopKeywords ?? DEFAULT_REPLY_SETTINGS.stopKeywords),
      rules: rules.map((rule, index) => ({
        id: String(rule.id || `rule-${index + 1}`),
        name: String(rule.name || `话术 ${index + 1}`).trim(),
        keywords: splitTerms(rule.keywords),
        reply: String(rule.reply || "").trim(),
        matchMode: rule.matchMode === "all" ? "all" : "any",
        enabled: rule.enabled !== false
      }))
    };
  }

  function validateReplySettings(raw) {
    const settings = mergeReplySettings(raw);
    const errors = [];
    for (const [name, value, minimum, maximum] of [
      ["检查间隔", settings.pollSeconds, 3, 3600],
      ["每日回复上限", settings.dailyLimit, 1, 200],
      ["单会话上限", settings.perConversationLimit, 1, 20],
      ["回复间隔", settings.intervalSeconds, 1, 3600]
    ]) {
      if (!Number.isInteger(value) || value < minimum || value > maximum) {
        errors.push(`${name}必须是 ${minimum}-${maximum} 的整数`);
      }
    }
    const triggerOwners = new Map();
    settings.rules.forEach((rule, index) => {
      const label = rule.name || `第 ${index + 1} 条`;
      if (!rule.name) errors.push(`${label}缺少名称`);
      if (!rule.keywords.length) errors.push(`${label}至少需要一个触发词`);
      if (!rule.reply) errors.push(`${label}回复内容为空`);
      if (rule.reply.length > 500) errors.push(`${label}回复内容不应超过 500 字`);
      if (!rule.enabled) return;
      for (const keyword of rule.keywords) {
        const owner = triggerOwners.get(keyword);
        if (owner && owner !== rule.id) errors.push(`触发词“${keyword}”在多条已启用话术中重复`);
        triggerOwners.set(keyword, rule.id);
      }
    });
    if (settings.enabled && !settings.rules.some((rule) => rule.enabled)) {
      errors.push("开启自动回复时，至少需要一条已启用话术");
    }
    return { settings, errors: [...new Set(errors)] };
  }

  function chooseReply(message, rawSettings) {
    const settings = mergeReplySettings(rawSettings);
    const text = normalize(message);
    const stop = settings.stopKeywords.find((keyword) => text.includes(normalize(keyword)));
    if (stop) return { action: "stop", reason: `命中停止词：${stop}` };
    const matches = settings.rules.filter((rule) => {
      if (!rule.enabled || !rule.keywords.length) return false;
      const hits = rule.keywords.map((keyword) => text.includes(normalize(keyword)));
      return rule.matchMode === "all" ? hits.every(Boolean) : hits.some(Boolean);
    });
    if (!matches.length) return { action: "manual", reason: "未命中任何已启用话术" };
    if (matches.length > 1) {
      return { action: "manual", reason: `同时命中 ${matches.length} 条话术，为防误发转人工` };
    }
    return { action: "reply", ruleId: matches[0].id, ruleName: matches[0].name, reply: matches[0].reply };
  }

  function replyAllowed({ todayCount, conversationCount, lastReplyAt }, rawSettings, now = Date.now()) {
    const settings = mergeReplySettings(rawSettings);
    if (todayCount >= settings.dailyLimit) return { allowed: false, reason: "已达今日自动回复上限" };
    if (conversationCount >= settings.perConversationLimit) return { allowed: false, reason: "已达当前会话回复上限" };
    if (lastReplyAt && now - lastReplyAt < settings.intervalSeconds * 1000) {
      return { allowed: false, reason: "距上次回复的间隔不足" };
    }
    return { allowed: true, reason: "通过回复限制检查" };
  }

  return { DEFAULT_REPLY_SETTINGS, mergeReplySettings, validateReplySettings, chooseReply, replyAllowed };
});
