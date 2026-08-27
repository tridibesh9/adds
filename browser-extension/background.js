// background.js — Service Worker (Core Blocking Engine)
// Runs in the background, manages declarativeNetRequest rules.

importScripts("utils.js");

// ── Default blocklist (pre-seeded) ──────────────────────────────────────────
const DEFAULT_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "tube8.com",
  "spankbang.com",
  "brazzers.com",
  "naughtyamerica.com",
  "bangbros.com",
  "realitykings.com",
  "mofos.com",
  "onlyfans.com",
  "fansly.com",
  "chaturbate.com",
  "livejasmin.com",
  "cam4.com",
  "myfreecams.com",
  "stripchat.com",
  "bongacams.com",
  "camsoda.com",
  "nhentai.net",
  "hentaifoundry.com",
  "rule34.xxx",
  "e621.net",
  "gelbooru.com",
  "danbooru.donmai.us",
  "sankakucomplex.com",
  "literotica.com",
  "sexstories.com",
  "asstr.org",
  "eroticstories.com",
  "adultfriendfinder.com",
  "ashleymadison.com",
  "fapello.com",
  "eporner.com",
  "porntrex.com",
  "hclips.com",
  "txxx.com",
  "fuq.com",
  "porndig.com",
  "faphouse.com",
  "hentai2read.com",
  "hanime.tv",
  "9anime.to"
];

// ── On Install / Update ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const stored = await chrome.storage.local.get("domains");
    if (!stored.domains) {
      await chrome.storage.local.set({
        domains: DEFAULT_DOMAINS,
        enabled: true,
        passwordHash: null,      // Set on first options page visit
        startDate: Date.now()    // Day 1 counter
      });
    }
    await rebuildRules();
    // Open options so user sets a password immediately
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  } else if (details.reason === "update") {
    await rebuildRules();
  }
});

// Rebuild rules on browser startup too (service workers can restart)
chrome.runtime.onStartup.addListener(async () => {
  await rebuildRules();
});

// ── Core: Build declarativeNetRequest rules from stored domain list ──────────
async function rebuildRules() {
  const { domains = [], enabled = true } = await chrome.storage.local.get([
    "domains",
    "enabled"
  ]);

  // Clear all existing dynamic rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((r) => r.id);

  if (!enabled || domains.length === 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    console.log("[Blocker] Disabled — all rules removed.");
    return;
  }

  // One rule per domain — ||domain matches domain + all subdomains
  const newRules = domains.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        extensionPath: `/blocked.html?site=${encodeURIComponent(domain)}`
      }
    },
    condition: {
      urlFilter: `||${domain}^`,          // ^ anchors end of domain — precise match
      resourceTypes: ["main_frame", "sub_frame"]
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: newRules
  });

  console.log(`[Blocker] ${newRules.length} domains blocked.`);
}

// ── Message Handler (popup & options communicate via messages) ───────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      // --- Status ---
      case "GET_STATUS": {
        const data = await chrome.storage.local.get([
          "domains", "enabled", "passwordHash", "startDate"
        ]);
        sendResponse(data);
        break;
      }

      // --- Add a domain ---
      case "ADD_DOMAIN": {
        const { domains = [] } = await chrome.storage.local.get("domains");
        const domain = normalizeDomain(msg.domain);
        if (!domain || !isValidDomain(domain) || domain.includes(" ")) {
          sendResponse({ success: false, error: "Invalid domain" });
          break;
        }
        if (domains.includes(domain)) {
          sendResponse({ success: false, error: "Already blocked" });
          break;
        }
        domains.push(domain);
        await chrome.storage.local.set({ domains });
        await rebuildRules();
        sendResponse({ success: true, domains });
        break;
      }

      // --- Remove a domain ---
      case "REMOVE_DOMAIN": {
        const { domains = [] } = await chrome.storage.local.get("domains");
        const updated = domains.filter((d) => d !== msg.domain);
        await chrome.storage.local.set({ domains: updated });
        await rebuildRules();
        sendResponse({ success: true, domains: updated });
        break;
      }

      // --- Toggle enabled/disabled ---
      case "SET_ENABLED": {
        await chrome.storage.local.set({ enabled: msg.enabled });
        await rebuildRules();
        sendResponse({ success: true });
        break;
      }

      // --- Save password hash ---
      case "SET_PASSWORD": {
        await chrome.storage.local.set({ passwordHash: msg.hash });
        sendResponse({ success: true });
        break;
      }

      // --- Verify entered password ---
      case "VERIFY_PASSWORD": {
        const { passwordHash } = await chrome.storage.local.get("passwordHash");
        sendResponse({ valid: passwordHash === msg.hash });
        break;
      }

      // --- Force rebuild (anti-tamper) ---
      case "REBUILD_RULES": {
        await rebuildRules();
        sendResponse({ success: true });
        break;
      }

      // --- Log a keyword block event (from content script) ---
      case "KEYWORD_BLOCK_EVENT": {
        const { blockLog = [] } = await chrome.storage.local.get("blockLog");
        blockLog.unshift({
          url: msg.url,
          reason: msg.reason,
          keyword: msg.keyword,
          time: Date.now()
        });
        // Keep only last 100 events
        if (blockLog.length > 100) blockLog.length = 100;
        await chrome.storage.local.set({ blockLog });
        sendResponse({ success: true });
        break;
      }

      // --- Save keyword blocking settings ---
      case "SET_KEYWORD_SETTINGS": {
        await chrome.storage.local.set({
          keywordBlockingEnabled: msg.enabled,
          customKeywords: msg.customKeywords || [],
          whitelist: msg.whitelist || []
        });
        sendResponse({ success: true });
        break;
      }

      // --- Get block log ---
      case "GET_BLOCK_LOG": {
        const { blockLog = [] } = await chrome.storage.local.get("blockLog");
        sendResponse({ blockLog });
        break;
      }

      default:
        sendResponse({ error: "Unknown message type" });
    }
  })();
  return true; // Keep channel open for async response
});

// ── Anti-Tamper Alarm: Re-check rules every 2 minutes ───────────────────────
chrome.alarms.create("anti-tamper-check", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "anti-tamper-check") {
    await rebuildRules();
  }
});
