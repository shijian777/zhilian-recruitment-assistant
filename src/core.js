(function attachCore(root, factory) {
  const api = factory();
  root.ZhaopinCore = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCore() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    dryRun: true,
    sessionLimit: 20,
    dailyLimit: 100,
    intervalSeconds: 5,
    keywords: [],
    cities: [],
    salaryMinK: null,
    salaryMaxK: null,
    autoScroll: true
  });

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("zh-CN");
  }

  function splitTerms(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(/[\s,，;；、]+/);
    return [...new Set(values.map(normalize).filter(Boolean))];
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function mergeSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    return {
      ...DEFAULT_SETTINGS,
      ...input,
      dryRun: input.dryRun !== false,
      autoScroll: input.autoScroll !== false,
      keywords: splitTerms(input.keywords),
      cities: splitTerms(input.cities),
      salaryMinK: numberOrNull(input.salaryMinK),
      salaryMaxK: numberOrNull(input.salaryMaxK)
    };
  }

  function validateSettings(raw) {
    const settings = mergeSettings(raw);
    const errors = [];
    for (const [name, value, minimum, maximum] of [
      ["本次人数", settings.sessionLimit, 1, 200],
      ["每日上限", settings.dailyLimit, 1, 500],
      ["发送间隔", settings.intervalSeconds, 1, 3600]
    ]) {
      if (!Number.isInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
        errors.push(`${name}必须是 ${minimum}-${maximum} 的整数`);
      }
    }
    if (settings.salaryMinK !== null && settings.salaryMinK < 0) errors.push("最低薪资不能为负数");
    if (settings.salaryMaxK !== null && settings.salaryMaxK < 0) errors.push("最高薪资不能为负数");
    if (
      settings.salaryMinK !== null &&
      settings.salaryMaxK !== null &&
      settings.salaryMinK > settings.salaryMaxK
    ) {
      errors.push("最低薪资不能高于最高薪资");
    }
    return { settings, errors };
  }

  function parseSalaryRanges(text) {
    const source = normalize(text).replace(/,/g, "");
    const ranges = [];
    const patterns = [
      { regex: /(\d+(?:\.\d+)?)\s*[-~–—至]\s*(\d+(?:\.\d+)?)\s*k(?:\/月)?/gi, scale: 1 },
      { regex: /(\d+(?:\.\d+)?)\s*[-~–—至]\s*(\d+(?:\.\d+)?)\s*千(?:\/月)?/gi, scale: 1 },
      { regex: /(\d+(?:\.\d+)?)\s*[-~–—至]\s*(\d+(?:\.\d+)?)\s*万(?:\/月)?/gi, scale: 10 }
    ];
    for (const { regex, scale } of patterns) {
      let match;
      while ((match = regex.exec(source)) !== null) {
        const minimum = Number(match[1]) * scale;
        const maximum = Number(match[2]) * scale;
        if (minimum <= maximum) ranges.push({ minimum, maximum });
      }
    }
    return ranges;
  }

  function evaluateCandidate(candidate, rawSettings) {
    const settings = mergeSettings(rawSettings);
    const text = normalize(candidate.text);
    const city = normalize(candidate.city || candidate.text);
    if (settings.keywords.length && !settings.keywords.some((term) => text.includes(term))) {
      return { matched: false, reason: "未命中任一关键词" };
    }
    if (settings.cities.length && !settings.cities.some((term) => city.includes(term))) {
      return { matched: false, reason: "未命中任一城市" };
    }
    if (settings.salaryMinK !== null || settings.salaryMaxK !== null) {
      const ranges = parseSalaryRanges(candidate.salaryText || candidate.text);
      if (!ranges.length) return { matched: false, reason: "已设置薪资筛选，但候选人未识别到薪资" };
      const wantedMin = settings.salaryMinK === null ? 0 : settings.salaryMinK;
      const wantedMax = settings.salaryMaxK === null ? Number.POSITIVE_INFINITY : settings.salaryMaxK;
      if (!ranges.some((range) => range.maximum >= wantedMin && range.minimum <= wantedMax)) {
        return { matched: false, reason: "薪资区间不相交" };
      }
    }
    return { matched: true, reason: "符合当前筛选条件" };
  }

  function stableKey(value) {
    const text = normalize(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `zp-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function handledBlocks(status, dryRun) {
    if (["sent", "manual", "unverified"].includes(status)) return true;
    if (status === "dry_run_match") return dryRun !== false;
    return false;
  }

  return {
    DEFAULT_SETTINGS,
    normalize,
    splitTerms,
    mergeSettings,
    validateSettings,
    parseSalaryRanges,
    evaluateCandidate,
    stableKey,
    handledBlocks
  };
});
