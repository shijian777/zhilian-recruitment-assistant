(function startReplyOptions() {
  "use strict";
  const replyCore = globalThis.ZhaopinReplyCore;
  let rules = [];
  let editingId = null;
  const byId = (id) => document.getElementById(id);

  function readSettings() {
    return {
      enabled: byId("enabled").checked,
      pollSeconds: Number(byId("pollSeconds").value),
      dailyLimit: Number(byId("dailyLimit").value),
      perConversationLimit: Number(byId("perConversationLimit").value),
      intervalSeconds: Number(byId("intervalSeconds").value),
      stopKeywords: byId("stopKeywords").value,
      rules
    };
  }

  function fillSettings(raw) {
    const settings = replyCore.mergeReplySettings(raw);
    byId("enabled").checked = settings.enabled;
    byId("pollSeconds").value = settings.pollSeconds;
    byId("dailyLimit").value = settings.dailyLimit;
    byId("perConversationLimit").value = settings.perConversationLimit;
    byId("intervalSeconds").value = settings.intervalSeconds;
    byId("stopKeywords").value = settings.stopKeywords.join("，");
    rules = settings.rules;
    renderRules();
  }

  function renderRules() {
    const list = byId("ruleList");
    list.textContent = "";
    byId("ruleCount").textContent = `${rules.length} 条`;
    if (!rules.length) {
      const empty = document.createElement("p");
      empty.textContent = "还没有话术。自动回复默认保持关闭。";
      list.appendChild(empty);
      return;
    }
    for (const rule of rules) {
      const row = document.createElement("div");
      row.className = "rule";
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${rule.enabled ? "已启用" : "已停用"} · ${rule.name}`;
      const triggers = document.createElement("span");
      triggers.textContent = `触发词：${rule.keywords.join("、")}（${rule.matchMode === "all" ? "全部命中" : "任一命中"}）`;
      const reply = document.createElement("span");
      reply.className = "reply";
      reply.textContent = `回复：${rule.reply}`;
      content.append(title, triggers, reply);
      const actions = document.createElement("div");
      actions.className = "rule-actions";
      const edit = document.createElement("button");
      edit.className = "secondary";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => editRule(rule.id));
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "删除";
      remove.addEventListener("click", () => deleteRule(rule.id));
      actions.append(edit, remove);
      row.append(content, actions);
      list.appendChild(row);
    }
  }

  function clearEditor() {
    editingId = null;
    byId("editorTitle").textContent = "新增话术";
    byId("ruleName").value = "";
    byId("ruleKeywords").value = "";
    byId("ruleReply").value = "";
    byId("matchMode").value = "any";
    byId("ruleEnabled").checked = true;
    byId("addRule").textContent = "添加话术";
    byId("cancelEdit").hidden = true;
  }

  function editRule(id) {
    const rule = rules.find((item) => item.id === id);
    if (!rule) return;
    editingId = id;
    byId("editorTitle").textContent = `编辑话术：${rule.name}`;
    byId("ruleName").value = rule.name;
    byId("ruleKeywords").value = rule.keywords.join("，");
    byId("ruleReply").value = rule.reply;
    byId("matchMode").value = rule.matchMode;
    byId("ruleEnabled").checked = rule.enabled;
    byId("addRule").textContent = "保存这条话术";
    byId("cancelEdit").hidden = false;
    document.querySelector(".editor").scrollIntoView({ behavior: "smooth" });
  }

  function deleteRule(id) {
    const rule = rules.find((item) => item.id === id);
    if (!rule || !confirm(`确认删除“${rule.name}”吗？`)) return;
    rules = rules.filter((item) => item.id !== id);
    if (editingId === id) clearEditor();
    renderRules();
  }

  function saveEditor() {
    const candidate = {
      id: editingId || `rule-${Date.now()}`,
      name: byId("ruleName").value.trim(),
      keywords: globalThis.ZhaopinCore.splitTerms(byId("ruleKeywords").value),
      reply: byId("ruleReply").value.trim(),
      matchMode: byId("matchMode").value,
      enabled: byId("ruleEnabled").checked
    };
    const next = editingId ? rules.map((item) => item.id === editingId ? candidate : item) : [...rules, candidate];
    const validation = replyCore.validateReplySettings({ ...readSettings(), enabled: false, rules: next });
    if (validation.errors.length) {
      byId("notice").textContent = validation.errors.join("；");
      return;
    }
    rules = validation.settings.rules;
    clearEditor();
    renderRules();
    byId("notice").textContent = "话术已加入列表，请点击底部“保存话术库”。";
  }

  byId("addRule").addEventListener("click", saveEditor);
  byId("cancelEdit").addEventListener("click", clearEditor);
  byId("testMatch").addEventListener("click", () => {
    const decision = replyCore.chooseReply(byId("testMessage").value, readSettings());
    byId("testResult").textContent = decision.action === "reply"
      ? `唯一命中“${decision.ruleName}”：${decision.reply}`
      : `${decision.action === "stop" ? "停止回复" : "转人工"}：${decision.reason}`;
  });
  byId("save").addEventListener("click", async () => {
    const validation = replyCore.validateReplySettings(readSettings());
    if (validation.errors.length) {
      byId("notice").textContent = validation.errors.join("；");
      return;
    }
    if (validation.settings.enabled && !confirm("开启后，扩展只会使用列表中已启用的固定话术。\n无命中、冲突和停止词都不发送。\n\n确认保存吗？")) return;
    await chrome.storage.local.set({ zhaopinReplySettings: validation.settings });
    fillSettings(validation.settings);
    byId("notice").textContent = "话术库已保存。";
  });

  chrome.storage.local.get("zhaopinReplySettings").then((stored) => fillSettings(stored.zhaopinReplySettings));
})();
