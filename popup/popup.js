(function startPopup() {
  "use strict";

  const core = globalThis.ZhaopinCore;
  const fields = {
    formalMode: document.querySelector("#formalMode"),
    sessionLimit: document.querySelector("#sessionLimit"),
    intervalSeconds: document.querySelector("#intervalSeconds"),
    dailyLimit: document.querySelector("#dailyLimit"),
    keywords: document.querySelector("#keywords"),
    cities: document.querySelector("#cities"),
    salaryMinK: document.querySelector("#salaryMinK"),
    salaryMaxK: document.querySelector("#salaryMaxK"),
    autoScroll: document.querySelector("#autoScroll")
  };
  const notice = document.querySelector("#notice");
  let settings = core.mergeSettings();

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !String(tab.url || "").startsWith("https://") || !new URL(tab.url).hostname.endsWith("zhaopin.com")) {
      throw new Error("请先打开并登录智联招聘企业页面");
    }
    return tab;
  }

  async function send(type, extra = {}) {
    const tab = await activeTab();
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.includes("Receiving end does not exist") && !message.includes("Could not establish connection")) {
        throw error;
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/core.js", "src/reply-core.js", "src/content.js", "src/reply-content.js"]
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      response = await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    }
    if (!response?.ok) throw new Error(response?.error || "扩展页面通信失败");
    return response.result;
  }

  function readForm() {
    return {
      dryRun: !fields.formalMode.checked,
      sessionLimit: Number(fields.sessionLimit.value),
      intervalSeconds: Number(fields.intervalSeconds.value),
      dailyLimit: Number(fields.dailyLimit.value),
      keywords: fields.keywords.value,
      cities: fields.cities.value,
      salaryMinK: fields.salaryMinK.value,
      salaryMaxK: fields.salaryMaxK.value,
      autoScroll: fields.autoScroll.checked
    };
  }

  function fillForm(value) {
    settings = core.mergeSettings(value);
    fields.formalMode.checked = !settings.dryRun;
    fields.sessionLimit.value = settings.sessionLimit;
    fields.intervalSeconds.value = settings.intervalSeconds;
    fields.dailyLimit.value = settings.dailyLimit;
    fields.keywords.value = settings.keywords.join("，");
    fields.cities.value = settings.cities.join("，");
    fields.salaryMinK.value = settings.salaryMinK ?? "";
    fields.salaryMaxK.value = settings.salaryMaxK ?? "";
    fields.autoScroll.checked = settings.autoScroll;
    updateMode();
  }

  function updateMode() {
    const formal = fields.formalMode.checked;
    const badge = document.querySelector("#modeBadge");
    badge.textContent = formal ? "正式" : "测试";
    badge.classList.toggle("formal", formal);
  }

  async function saveSettings({ requireFormalConfirmation = true } = {}) {
    const validated = core.validateSettings(readForm());
    if (validated.errors.length) throw new Error(validated.errors.join("；"));
    if (
      requireFormalConfirmation &&
      !validated.settings.dryRun &&
      !confirm("正式模式会在当前智联账号中真实发起沟通。\n\n确认保存正式发送设置吗？")
    ) {
      fields.formalMode.checked = false;
      updateMode();
      throw new Error("已取消开启正式发送");
    }
    settings = validated.settings;
    await chrome.storage.local.set({ zhaopinSettings: settings });
    return settings;
  }

  function renderStatus(status) {
    document.querySelector("#state").textContent = status.state || "未启动";
    for (const id of ["scanned", "matched", "sent", "unverified"]) {
      document.querySelector(`#${id}`).textContent = String(status[id] || 0);
    }
    document.querySelector("#currentCandidate").textContent = status.currentCandidate || "-";
    document.querySelector("#lastReason").textContent = status.lastReason || "正在等待运行";
    document.querySelector("#details").textContent = JSON.stringify(
      {
        当前候选人: status.currentCandidate,
        最后原因: status.lastReason,
        页面: status.page,
        诊断: status.diagnosis
      },
      null,
      2
    );
    document.querySelector("#start").disabled = Boolean(status.running);
    document.querySelector("#pause").disabled = !status.running;
  }

  function renderReplyStatus(status) {
    document.querySelector("#replyState").textContent = status.state || "自动回复未启动";
    document.querySelector("#todayReplied").textContent = String(status.todayReplied || 0);
    document.querySelector("#startReply").disabled = Boolean(status.watching);
    document.querySelector("#stopReply").disabled = !status.watching;
  }

  async function guard(action) {
    notice.textContent = "";
    try {
      await action();
    } catch (error) {
      notice.textContent = String(error?.message || error);
    }
  }

  document.querySelector("#save").addEventListener("click", () => guard(async () => {
    await saveSettings();
    notice.textContent = "设置已保存";
  }));
  document.querySelector("#start").addEventListener("click", () => guard(async () => {
    const saved = await saveSettings();
    if (!saved.dryRun && !confirm(`即将开始真实沟通。\n本次 ${saved.sessionLimit} 人，间隔 ${saved.intervalSeconds} 秒。\n\n确认开始吗？`)) {
      throw new Error("已取消运行");
    }
    await send("ZP_REPLY_PAUSE");
    renderStatus(await send("ZP_START", { formalConfirmed: !saved.dryRun }));
  }));
  document.querySelector("#pause").addEventListener("click", () => guard(async () => {
    renderStatus(await send("ZP_PAUSE"));
  }));
  document.querySelector("#diagnose").addEventListener("click", () => guard(async () => {
    const result = await send("ZP_DIAGNOSE");
    renderStatus(result);
    document.querySelector("details").open = true;
  }));
  document.querySelector("#openRules").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#startReply").addEventListener("click", () => guard(async () => {
    const saved = await saveSettings();
    if (!saved.dryRun && !confirm("正式模式下，扩展会对唯一命中话术的对方新消息真实回复。\n\n确认开启吗？")) {
      throw new Error("已取消开启自动回复");
    }
    await send("ZP_PAUSE");
    renderReplyStatus(await send("ZP_REPLY_START", { formalConfirmed: !saved.dryRun }));
  }));
  document.querySelector("#stopReply").addEventListener("click", () => guard(async () => {
    renderReplyStatus(await send("ZP_REPLY_PAUSE"));
  }));
  fields.formalMode.addEventListener("change", updateMode);

  async function initialize() {
    const stored = await chrome.storage.local.get(["zhaopinSettings"]);
    fillForm(stored.zhaopinSettings);
    await guard(async () => renderStatus(await send("ZP_STATUS")));
    await guard(async () => renderReplyStatus(await send("ZP_REPLY_STATUS")));
    setInterval(() => guard(async () => {
      renderStatus(await send("ZP_STATUS"));
      renderReplyStatus(await send("ZP_REPLY_STATUS"));
    }), 1000);
  }

  initialize();
})();
