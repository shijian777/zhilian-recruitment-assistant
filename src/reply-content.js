(function startStrictAutoReply() {
  "use strict";

  if (globalThis.__ZhaopinStrictAutoReplyLoaded) return;
  globalThis.__ZhaopinStrictAutoReplyLoaded = true;

  const core = globalThis.ZhaopinCore;
  const replyCore = globalThis.ZhaopinReplyCore;
  const STORAGE = {
    general: "zhaopinSettings",
    settings: "zhaopinReplySettings",
    runtime: "zhaopinReplyRuntime",
    processed: "zhaopinReplyProcessed",
    logs: "zhaopinLogs"
  };
  const RISK_TEXTS = ["验证码", "安全验证", "请完成验证", "操作频繁", "账号异常", "登录异常"];
  const CONVERSATION_SELECTORS = [
    '[data-testid*="conversation"]',
    '[class*="conversation-item"]',
    '[class*="conversationItem"]',
    '[class*="chat-item"]',
    '[class*="session-item"]',
    'li[class*="message"]'
  ];
  const MESSAGE_SELECTORS = [
    '[data-testid*="message-item"]',
    '[class*="message-item"]',
    '[class*="messageItem"]',
    '[class*="chat-message"]',
    '[class*="msg-item"]'
  ];
  const COMPOSER_SELECTORS = [
    'textarea[placeholder*="消息"]',
    'textarea[placeholder*="输入"]',
    '[contenteditable="true"][data-placeholder*="消息"]',
    '[contenteditable="true"][class*="editor"]',
    '[contenteditable="true"][class*="input"]'
  ];
  const HEADER_SELECTORS = ['[class*="chat-header"]', '[class*="conversation-header"]', '[class*="user-name"]', '[class*="name"]'];
  const INCOMING_HINTS = ["incoming", "receive", "received", "left", "other", "candidate", "guest"];
  const OUTGOING_HINTS = ["outgoing", "send", "sent", "right", "self", "mine", "employer", "recruiter"];

  let watching = false;
  let timer = null;
  let generalSettings = core.mergeSettings();
  let replySettings = replyCore.mergeReplySettings();
  let processed = {};
  let runtime = freshRuntime();

  function freshRuntime() {
    return {
      state: "自动回复未启动",
      watching: false,
      date: new Date().toISOString().slice(0, 10),
      todayReplied: 0,
      dryRunMatches: 0,
      manual: 0,
      stopped: 0,
      unverified: 0,
      conversationCounts: {},
      lastReplyAt: 0,
      currentConversation: "-",
      lastDecision: ""
    };
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function pageText() {
    return core.normalize(document.body?.innerText || "").slice(0, 200000);
  }

  function findRisk() {
    const text = pageText();
    return RISK_TEXTS.find((item) => text.includes(core.normalize(item))) || "";
  }

  async function getStorage(keys) {
    return chrome.storage.local.get(keys);
  }

  async function appendLog(message, level = "info") {
    const stored = await getStorage(STORAGE.logs);
    const logs = Array.isArray(stored[STORAGE.logs]) ? stored[STORAGE.logs] : [];
    logs.push({ time: new Date().toISOString(), level, source: "auto_reply", message });
    await chrome.storage.local.set({ [STORAGE.logs]: logs.slice(-300) });
  }

  async function persistRuntime() {
    runtime.watching = watching;
    await chrome.storage.local.set({ [STORAGE.runtime]: runtime });
  }

  async function setState(state, decision = "") {
    runtime.state = state;
    runtime.lastDecision = decision;
    await persistRuntime();
    await appendLog(decision ? `${state}：${decision}` : state);
  }

  function schedule(delay = replySettings.pollSeconds * 1000) {
    clearTimeout(timer);
    if (watching) timer = setTimeout(replyStep, delay);
  }

  async function pause(state, reason = "") {
    watching = false;
    clearTimeout(timer);
    timer = null;
    await setState(state, reason);
  }

  function resetDailyIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (runtime.date !== today) runtime = freshRuntime();
  }

  function unreadConversation() {
    for (const selector of CONVERSATION_SELECTORS) {
      for (const item of document.querySelectorAll(selector)) {
        if (!visible(item)) continue;
        const marker = item.querySelector('[class*="unread"], [class*="badge"], [data-testid*="unread"]');
        const label = core.normalize(item.innerText);
        if (marker && visible(marker) && /\d+|未读/.test(core.normalize(marker.textContent) || label)) return item;
      }
    }
    return null;
  }

  function directionFromElement(element) {
    const tokens = core.normalize(
      `${element.className || ""} ${element.getAttribute("data-direction") || ""} ${element.getAttribute("data-testid") || ""}`
    );
    const incoming = INCOMING_HINTS.some((hint) => tokens.includes(hint));
    const outgoing = OUTGOING_HINTS.some((hint) => tokens.includes(hint));
    if (incoming === outgoing) return "unknown";
    return incoming ? "incoming" : "outgoing";
  }

  function messageElements() {
    const found = [];
    for (const selector of MESSAGE_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        const text = core.normalize(element.innerText);
        if (visible(element) && text && text.length <= 2000) found.push(element);
      }
    }
    const unique = [...new Set(found)];
    return unique.filter((element) => !unique.some((other) => other !== element && element.contains(other)));
  }

  function conversationSnapshot() {
    const messages = messageElements().map((element, index) => ({
      element,
      index,
      direction: directionFromElement(element),
      text: core.normalize(element.innerText)
    }));
    if (!messages.length) return null;
    const header = HEADER_SELECTORS
      .map((selector) => document.querySelector(selector))
      .find((element) => element && visible(element) && core.normalize(element.textContent));
    const label = core.normalize(header?.textContent) || core.normalize(document.title) || "未知会话";
    const conversationKey = core.stableKey(`${location.pathname}|${label}`);
    const last = messages[messages.length - 1];
    return {
      key: conversationKey,
      label,
      messages,
      last,
      incomingKey: core.stableKey(`${conversationKey}|${last.index}|${last.direction}|${last.text}`)
    };
  }

  function processedBlocks(key) {
    const status = processed[key]?.status;
    if (!status) return false;
    if (status === "dry_run_reply") return generalSettings.dryRun !== false;
    return true;
  }

  async function markProcessed(snapshot, status, reason, reply = "") {
    processed[snapshot.incomingKey] = {
      conversationKey: snapshot.key,
      status,
      reason,
      reply,
      time: new Date().toISOString()
    };
    processed = Object.fromEntries(Object.entries(processed).slice(-5000));
    await chrome.storage.local.set({ [STORAGE.processed]: processed });
  }

  function findComposer() {
    const matches = COMPOSER_SELECTORS.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(visible);
    return [...new Set(matches)].length === 1 ? [...new Set(matches)][0] : null;
  }

  function findSendButton(composer) {
    let root = composer?.parentElement;
    for (let depth = 0; root && depth < 6; depth += 1, root = root.parentElement) {
      const buttons = [...root.querySelectorAll('button, [role="button"]')].filter(
        (element) => visible(element) && !element.disabled && core.normalize(element.innerText) === "发送"
      );
      if (buttons.length === 1) return buttons[0];
    }
    return null;
  }

  function composerValue(composer) {
    return core.normalize("value" in composer ? composer.value : composer.textContent);
  }

  function fillComposer(composer, value) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("无法访问输入框原生设值器");
      setter.call(composer, value);
    } else if (composer.getAttribute("contenteditable") === "true") {
      composer.textContent = value;
    } else {
      throw new Error("识别到的控件不是可编辑输入框");
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function verifyReply(reply, composer) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const snapshot = conversationSnapshot();
      if (
        snapshot?.last.direction === "outgoing" &&
        snapshot.last.text === core.normalize(reply) &&
        !composerValue(composer)
      ) {
        return true;
      }
    }
    return false;
  }

  async function processIncoming(snapshot) {
    runtime.currentConversation = snapshot.label;
    if (snapshot.last.direction === "unknown") {
      runtime.manual += 1;
      await markProcessed(snapshot, "manual", "最后一条消息方向无法可靠区分");
      await setState("需要人工处理", "消息方向不明，未回复");
      return;
    }
    if (snapshot.last.direction !== "incoming" || processedBlocks(snapshot.incomingKey)) return;
    const decision = replyCore.chooseReply(snapshot.last.text, replySettings);
    runtime.lastDecision = decision.reason || decision.ruleName || "";
    if (decision.action === "stop") {
      runtime.stopped += 1;
      await markProcessed(snapshot, "stopped", decision.reason);
      await setState("已停止当前会话自动回复", decision.reason);
      return;
    }
    if (decision.action !== "reply") {
      runtime.manual += 1;
      await markProcessed(snapshot, "manual", decision.reason);
      await setState("转人工", decision.reason);
      return;
    }

    const allowance = replyCore.replyAllowed(
      {
        todayCount: runtime.todayReplied,
        conversationCount: Number(runtime.conversationCounts[snapshot.key] || 0),
        lastReplyAt: runtime.lastReplyAt
      },
      replySettings
    );
    if (!allowance.allowed) {
      await setState("已暂停自动回复", allowance.reason);
      return;
    }
    if (generalSettings.dryRun) {
      runtime.dryRunMatches += 1;
      await markProcessed(snapshot, "dry_run_reply", `测试命中话术：${decision.ruleName}`, decision.reply);
      await setState("测试模式命中话术", `${decision.ruleName}（未输入、未发送）`);
      return;
    }

    const composer = findComposer();
    const send = findSendButton(composer);
    if (!composer || !send) {
      await pause("需要人工处理", "未唯一识别到消息输入框和发送按钮");
      return;
    }
    if (composerValue(composer)) {
      await pause("需要人工处理", "输入框已有未发送草稿，未覆盖");
      return;
    }
    const before = conversationSnapshot();
    if (!before || before.incomingKey !== snapshot.incomingKey || before.last.direction !== "incoming") {
      await pause("需要人工处理", "发送前来信已变化，未回复");
      return;
    }
    fillComposer(composer, decision.reply);
    if (composerValue(composer) !== core.normalize(decision.reply)) {
      await pause("需要人工处理", "话术未能完整填入输入框");
      return;
    }
    send.click();
    if (!(await verifyReply(decision.reply, composer))) {
      runtime.unverified += 1;
      await markProcessed(snapshot, "unverified", "点击发送后无法验证发出消息", decision.reply);
      await pause("需要人工核对", "无法确认回复已发送，禁止自动重试");
      return;
    }
    runtime.todayReplied += 1;
    runtime.conversationCounts[snapshot.key] = Number(runtime.conversationCounts[snapshot.key] || 0) + 1;
    runtime.lastReplyAt = Date.now();
    await markProcessed(snapshot, "replied", `命中话术：${decision.ruleName}`, decision.reply);
    await setState("已验证自动回复成功", snapshot.label);
  }

  async function replyStep() {
    if (!watching) return;
    resetDailyIfNeeded();
    const risk = findRisk();
    if (risk) {
      await pause("已暂停自动回复", `检测到页面验证或异常：${risk}`);
      return;
    }
    const unread = unreadConversation();
    if (unread) {
      unread.scrollIntoView({ block: "center", behavior: "instant" });
      unread.click();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const snapshot = conversationSnapshot();
    if (snapshot) await processIncoming(snapshot);
    if (watching) schedule();
  }

  async function start(message) {
    const stored = await getStorage([STORAGE.general, STORAGE.settings, STORAGE.runtime, STORAGE.processed]);
    generalSettings = core.mergeSettings(stored[STORAGE.general]);
    const validated = replyCore.validateReplySettings(stored[STORAGE.settings]);
    if (validated.errors.length) throw new Error(validated.errors.join("；"));
    replySettings = validated.settings;
    if (!replySettings.enabled) throw new Error("请先在话术库中开启自动回复");
    if (!generalSettings.dryRun && message.formalConfirmed !== true) throw new Error("正式自动回复未确认");
    runtime = { ...freshRuntime(), ...(stored[STORAGE.runtime] || {}) };
    processed = stored[STORAGE.processed] || {};
    watching = true;
    await setState(generalSettings.dryRun ? "测试模式正在检测来信" : "正在监听未读来信");
    schedule(50);
    return snapshotStatus();
  }

  function snapshotStatus() {
    return { ...runtime, watching, settingsEnabled: replySettings.enabled, page: { title: document.title, url: location.href } };
  }

  const initialization = getStorage([STORAGE.general, STORAGE.settings, STORAGE.runtime, STORAGE.processed])
    .then((stored) => {
      generalSettings = core.mergeSettings(stored[STORAGE.general]);
      replySettings = replyCore.mergeReplySettings(stored[STORAGE.settings]);
      runtime = { ...freshRuntime(), ...(stored[STORAGE.runtime] || {}) };
      processed = stored[STORAGE.processed] || {};
      resetDailyIfNeeded();
    })
    .catch(() => undefined);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!["ZP_REPLY_START", "ZP_REPLY_PAUSE", "ZP_REPLY_STATUS", "ZP_REPLY_RESET"].includes(message?.type)) return false;
    (async () => {
      await initialization;
      if (message.type === "ZP_REPLY_START") return start(message);
      if (message.type === "ZP_REPLY_PAUSE") {
        await pause("已手动暂停自动回复");
        return snapshotStatus();
      }
      if (message.type === "ZP_REPLY_STATUS") return snapshotStatus();
      runtime = freshRuntime();
      processed = {};
      await chrome.storage.local.set({ [STORAGE.runtime]: runtime, [STORAGE.processed]: processed });
      return snapshotStatus();
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
