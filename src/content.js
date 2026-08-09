(function startZhaopinAdapter() {
  "use strict";

  if (globalThis.__ZhaopinInvitationAdapterLoaded) return;
  globalThis.__ZhaopinInvitationAdapterLoaded = true;

  const core = globalThis.ZhaopinCore;
  const ACTION_TEXTS = [
    "打招呼",
    "打个招呼",
    "立即沟通",
    "发起沟通",
    "沟通一下",
    "邀请沟通",
    "去沟通",
    "和TA聊聊",
    "联系TA",
    "聊一聊",
    "发消息",
    "邀约"
  ];
  const SENT_TEXTS = ["继续沟通", "已沟通", "已打招呼", "去聊天", "沟通中"];
  const SUCCESS_TEXTS = ["沟通成功", "打招呼成功", "已发送", "已向候选人发起沟通"];
  const BLOCKED_TEXTS = ["权益不足", "沟通次数已用完", "去购买", "去充值", "暂无沟通权益"];
  const RISK_TEXTS = ["验证码", "安全验证", "请完成验证", "操作频繁", "账号异常", "登录异常", "行为异常"];
  const CARD_SELECTORS = [
    '[data-testid*="candidate"]',
    '[data-testid*="talent"]',
    '[class*="resume-card"]',
    '[class*="talent-card"]',
    '[class*="candidate-card"]',
    '[class*="recommend-card"]',
    '[class*="resume-item"]',
    '[class*="resumeItem"]',
    '[class*="talent-item"]',
    '[class*="recommend-item"]',
    '[data-resume-id]',
    '[data-candidate-id]',
    'li[class*="candidate"]'
  ];
  const NAME_SELECTORS = ['[class*="name"]', '[data-testid*="name"]', "h3", "h4"];
  const CITY_SELECTORS = ['[class*="city"]', '[class*="location"]', '[data-testid*="city"]'];
  const SALARY_SELECTORS = ['[class*="salary"]', '[data-testid*="salary"]'];
  const STORAGE = {
    settings: "zhaopinSettings",
    runtime: "zhaopinRuntime",
    handled: "zhaopinHandled",
    logs: "zhaopinLogs"
  };

  let running = false;
  let timer = null;
  let settings = core.mergeSettings();
  let runtime = freshRuntime();
  let handled = {};
  let sessionSeen = new Set();
  let emptyScrolls = 0;

  function freshRuntime() {
    return {
      state: "未启动",
      running: false,
      date: new Date().toISOString().slice(0, 10),
      sessionContacted: 0,
      scanned: 0,
      matched: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      unverified: 0,
      currentCandidate: "-",
      lastReason: ""
    };
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function exactText(element, values) {
    const label = core.normalize(element.innerText || element.textContent);
    return values.some((value) => label === core.normalize(value));
  }

  function canonicalActionElement(element, root) {
    const nativeSelector = 'button, a, [role="button"]';
    const native = element.closest(nativeSelector);
    if (native && root.contains(native) && exactText(native, ACTION_TEXTS)) return native;

    const descendants = [...element.querySelectorAll(nativeSelector)].filter(
      (child) => visible(child) && exactText(child, ACTION_TEXTS)
    );
    return descendants.length === 1 ? descendants[0] : element;
  }

  function actionElements(root = document) {
    const matches = [...root.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]')]
      .filter(
        (element) =>
          visible(element) &&
          !element.disabled &&
          element.getAttribute("aria-disabled") !== "true" &&
          exactText(element, ACTION_TEXTS)
      )
      .map((element) => canonicalActionElement(element, root));

    const unique = [...new Set(matches)].filter(
      (element) =>
        visible(element) &&
        !element.disabled &&
        element.getAttribute("aria-disabled") !== "true" &&
        exactText(element, ACTION_TEXTS)
    );
    return unique.filter(
      (element) => !unique.some((other) => other !== element && element.contains(other))
    );
  }

  function pruneNested(elements) {
    const unique = [...new Set(elements)];
    return unique.filter(
      (element) => !unique.some((other) => other !== element && element.contains(other))
    );
  }

  function findCandidateCards() {
    const semantic = [];
    for (const selector of CARD_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element) && core.normalize(element.innerText).length >= 12 && actionElements(element).length) {
          semantic.push(element);
        }
      }
    }
    if (semantic.length) return pruneNested(semantic);

    const fallback = [];
    for (const action of actionElements()) {
      let current = action.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const length = core.normalize(current.innerText).length;
        if (length >= 12 && length <= 2500 && actionElements(current).length === 1) {
          fallback.push(current);
          break;
        }
      }
    }
    return pruneNested(fallback);
  }

  function firstText(card, selectors) {
    for (const selector of selectors) {
      const value = core.normalize(card.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function candidateFromCard(card) {
    const text = core.normalize(card.innerText);
    const name = firstText(card, NAME_SELECTORS) || text.split(" ").find((part) => part.length >= 2) || "未知候选人";
    const city = firstText(card, CITY_SELECTORS);
    const salaryText = firstText(card, SALARY_SELECTORS) || text;
    return {
      name,
      city,
      salaryText,
      text,
      key: core.stableKey(`${location.pathname}|${name}|${text.slice(0, 500)}`)
    };
  }

  function pageText() {
    return core.normalize(document.body?.innerText || "").slice(0, 200000);
  }

  function findPresent(values) {
    const text = pageText();
    return values.find((value) => text.includes(core.normalize(value))) || "";
  }

  async function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  async function persistRuntime() {
    runtime.running = running;
    await chrome.storage.local.set({ [STORAGE.runtime]: runtime });
  }

  async function appendLog(message, level = "info") {
    const stored = await storageGet(STORAGE.logs);
    const logs = Array.isArray(stored[STORAGE.logs]) ? stored[STORAGE.logs] : [];
    logs.push({ time: new Date().toISOString(), level, message });
    await chrome.storage.local.set({ [STORAGE.logs]: logs.slice(-300) });
  }

  async function setState(state, reason = "") {
    runtime.state = state;
    runtime.lastReason = reason;
    await persistRuntime();
    await appendLog(reason ? `${state}：${reason}` : state, state.includes("失败") ? "error" : "info");
  }

  function schedule(delayMs) {
    clearTimeout(timer);
    if (running) timer = setTimeout(runStep, delayMs);
  }

  async function pause(state, reason = "") {
    running = false;
    clearTimeout(timer);
    timer = null;
    await setState(state, reason);
  }

  function dailyResetIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (runtime.date !== today) {
      runtime = freshRuntime();
      runtime.date = today;
    }
  }

  async function markHandled(candidate, status, reason) {
    handled[candidate.key] = {
      status,
      reason,
      name: candidate.name,
      time: new Date().toISOString()
    };
    const entries = Object.entries(handled).slice(-5000);
    handled = Object.fromEntries(entries);
    await chrome.storage.local.set({ [STORAGE.handled]: handled });
  }

  function alreadyHandled(candidate) {
    return core.handledBlocks(handled[candidate.key]?.status, settings.dryRun);
  }

  function successVisible(card, previousPageText) {
    const cardText = core.normalize(card?.innerText || "");
    if (SENT_TEXTS.some((value) => cardText.includes(core.normalize(value)))) return true;
    const current = pageText();
    return SUCCESS_TEXTS.some(
      (value) => current.includes(core.normalize(value)) && !previousPageText.includes(core.normalize(value))
    );
  }

  async function verifySend(card, previousPageText) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (findPresent(BLOCKED_TEXTS)) return { success: false, blocked: true, reason: findPresent(BLOCKED_TEXTS) };
      if (successVisible(card, previousPageText)) return { success: true, blocked: false, reason: "页面已出现发送成功状态" };
    }
    return { success: false, blocked: false, reason: "点击后未读到明确成功状态" };
  }

  async function processCandidate(card) {
    const candidate = candidateFromCard(card);
    runtime.scanned += 1;
    runtime.currentCandidate = candidate.name;
    if (sessionSeen.has(candidate.key) || alreadyHandled(candidate)) {
      runtime.skipped += 1;
      await persistRuntime();
      return false;
    }
    sessionSeen.add(candidate.key);
    const decision = core.evaluateCandidate(candidate, settings);
    if (!decision.matched) {
      runtime.skipped += 1;
      await appendLog(`跳过 ${candidate.name}：${decision.reason}`);
      await persistRuntime();
      return true;
    }
    runtime.matched += 1;
    if (settings.dryRun) {
      runtime.sessionContacted += 1;
      await markHandled(candidate, "dry_run_match", "测试模式不点击");
      await appendLog(`测试命中 ${candidate.name}（未点击、未发送）`);
      await persistRuntime();
      return true;
    }

    const actions = actionElements(card);
    if (actions.length !== 1) {
      runtime.unverified += 1;
      await markHandled(candidate, "manual", `候选人卡片中识别到 ${actions.length} 个沟通按钮`);
      await pause("需要人工处理", "沟通按钮数量异常，未执行点击");
      return true;
    }
    const action = actions[0];
    if (!document.contains(action) || !visible(action) || !exactText(action, ACTION_TEXTS)) {
      runtime.failed += 1;
      await pause("需要人工处理", "发送前按钮已变化，未执行点击");
      return true;
    }
    const before = pageText();
    action.scrollIntoView({ block: "center", behavior: "instant" });
    action.click();
    const result = await verifySend(card, before);
    if (result.success) {
      runtime.sent += 1;
      runtime.sessionContacted += 1;
      await markHandled(candidate, "sent", result.reason);
      await appendLog(`已验证发送成功：${candidate.name}`);
      await persistRuntime();
      return true;
    }
    if (result.blocked) {
      runtime.failed += 1;
      await pause("已暂停", `平台权益或频次限制：${result.reason}`);
      return true;
    }
    runtime.unverified += 1;
    await markHandled(candidate, "unverified", result.reason);
    await pause("需要人工核对", result.reason);
    return true;
  }

  async function runStep() {
    if (!running) return;
    dailyResetIfNeeded();
    const risk = findPresent(RISK_TEXTS);
    if (risk) {
      await pause("已暂停", `检测到页面验证或异常提示：${risk}`);
      return;
    }
    if (runtime.sessionContacted >= Number(settings.sessionLimit)) {
      await pause("本次任务完成", `已达本次上限 ${settings.sessionLimit}`);
      return;
    }
    if (runtime.sent >= Number(settings.dailyLimit)) {
      await pause("已暂停", `已达每日上限 ${settings.dailyLimit}`);
      return;
    }

    const cards = findCandidateCards();
    for (const card of cards) {
      const candidate = candidateFromCard(card);
      if (!sessionSeen.has(candidate.key) && !alreadyHandled(candidate)) {
        emptyScrolls = 0;
        const processed = await processCandidate(card);
        if (running) schedule(settings.dryRun ? 300 : Number(settings.intervalSeconds) * 1000);
        return processed;
      }
    }

    if (settings.autoScroll && emptyScrolls < 6) {
      emptyScrolls += 1;
      window.scrollBy({ top: Math.max(500, Math.floor(window.innerHeight * 0.72)), behavior: "smooth" });
      await setState("正在自动加载更多候选人", `第 ${emptyScrolls} 次滚动`);
      schedule(1200);
      return;
    }
    await pause("当前候选人已处理完毕", "多次滚动后没有新候选人");
  }

  async function start(message) {
    if (!location.hostname.endsWith("zhaopin.com")) throw new Error("当前不是智联招聘页面");
    const stored = await storageGet([STORAGE.settings, STORAGE.runtime, STORAGE.handled]);
    const validated = core.validateSettings(stored[STORAGE.settings]);
    if (validated.errors.length) throw new Error(validated.errors.join("；"));
    settings = validated.settings;
    if (!settings.dryRun && message.formalConfirmed !== true) throw new Error("正式发送未确认");
    handled = stored[STORAGE.handled] || {};
    if (settings.dryRun) {
      handled = Object.fromEntries(
        Object.entries(handled).filter(([, item]) => item?.status !== "dry_run_match")
      );
      await chrome.storage.local.set({ [STORAGE.handled]: handled });
    }
    const previousRuntime = stored[STORAGE.runtime] || {};
    const today = new Date().toISOString().slice(0, 10);
    const todaySent = previousRuntime.date === today ? Number(previousRuntime.sent || 0) : 0;
    runtime = { ...freshRuntime(), sent: todaySent, date: today };
    sessionSeen = new Set();
    running = true;
    emptyScrolls = 0;
    await setState(settings.dryRun ? "测试模式正在扫描" : "正式模式正在运行");
    schedule(50);
    return snapshot();
  }

  function snapshot() {
    const clickableTexts = [...document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]')]
      .filter(visible)
      .map((element) => core.normalize(element.innerText || element.textContent))
      .filter(Boolean);
    const selectorMatches = Object.fromEntries(
      CARD_SELECTORS.map((selector) => [selector, document.querySelectorAll(selector).length])
    );
    return {
      ...runtime,
      running,
      page: { title: document.title, url: location.href },
      diagnosis: {
        candidateCards: findCandidateCards().length,
        actionButtons: actionElements().length,
        cardActionCounts: findCandidateCards().slice(0, 20).map((card) => actionElements(card).length),
        recognizedActionTexts: [...new Set(actionElements().map((element) => core.normalize(element.innerText)))],
        visibleClickableTexts: [...new Set(clickableTexts)].slice(0, 80),
        selectorMatches,
        risk: findPresent(RISK_TEXTS)
      }
    };
  }

  const initialization = storageGet([STORAGE.runtime, STORAGE.handled])
    .then((stored) => {
      runtime = { ...freshRuntime(), ...(stored[STORAGE.runtime] || {}) };
      handled = stored[STORAGE.handled] || {};
      dailyResetIfNeeded();
    })
    .catch(() => undefined);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!["ZP_START", "ZP_PAUSE", "ZP_STATUS", "ZP_DIAGNOSE", "ZP_RESET"].includes(message?.type)) {
      return false;
    }
    (async () => {
      await initialization;
      if (message?.type === "ZP_START") return start(message);
      if (message?.type === "ZP_PAUSE") {
        await pause("已手动暂停");
        return snapshot();
      }
      if (message?.type === "ZP_STATUS" || message?.type === "ZP_DIAGNOSE") return snapshot();
      if (message?.type === "ZP_RESET") {
        runtime = freshRuntime();
        handled = {};
        sessionSeen = new Set();
        await chrome.storage.local.set({
          [STORAGE.runtime]: runtime,
          [STORAGE.handled]: handled,
          [STORAGE.logs]: []
        });
        return snapshot();
      }
      throw new Error("未知扩展指令");
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
