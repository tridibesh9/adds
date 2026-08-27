// options.js — v2 with tabs: Domains, Keywords, Block Log, Security

// ── DOM ─────────────────────────────────────────────────────────────────────
const passwordGate      = document.getElementById("passwordGate");
const mainSettings      = document.getElementById("mainSettings");
const gateTitle         = document.getElementById("gateTitle");
const gateSubtitle      = document.getElementById("gateSubtitle");
const passwordInput     = document.getElementById("passwordInput");
const confirmInput      = document.getElementById("confirmInput");
const gateBtn           = document.getElementById("gateBtn");
const gateFeedback      = document.getElementById("gateFeedback");
const enabledToggle     = document.getElementById("enabledToggle");
const enabledLabel      = document.getElementById("enabledLabel");
const daysCountEl       = document.getElementById("daysCount");

// Domain tab
const addDomainInput    = document.getElementById("addDomainInput");
const addDomainBtn      = document.getElementById("addDomainBtn");
const addFeedback       = document.getElementById("addFeedback");
const domainListEl      = document.getElementById("domainList");
const totalCountEl      = document.getElementById("totalCount");
const searchInput       = document.getElementById("searchInput");

// Keyword tab
const keywordToggle     = document.getElementById("keywordToggle");
const keywordLabel      = document.getElementById("keywordLabel");
const addKeywordInput   = document.getElementById("addKeywordInput");
const addKeywordBtn     = document.getElementById("addKeywordBtn");
const keywordFeedback   = document.getElementById("keywordFeedback");
const keywordListEl     = document.getElementById("keywordList");
const addWhitelistInput = document.getElementById("addWhitelistInput");
const addWhitelistBtn   = document.getElementById("addWhitelistBtn");
const whitelistListEl   = document.getElementById("whitelistList");

// Log tab
const blockLogEl        = document.getElementById("blockLog");
const clearLogBtn       = document.getElementById("clearLogBtn");

// Security tab
const resetDateBtn      = document.getElementById("resetDateBtn");
const changePasswordBtn = document.getElementById("changePasswordBtn");

let allDomains      = [];
let customKeywords  = [];
let whitelist       = [];

// ── Tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    const pane = document.getElementById("tab-" + tab.dataset.tab);
    if (pane) {
      pane.classList.remove("hidden");
      if (tab.dataset.tab === "log") loadBlockLog();
    }
  });
});

// ── Gate startup ─────────────────────────────────────────────────────────
(async () => {
  const { passwordHash, startDate } = await chrome.storage.local.get([
    "passwordHash", "startDate"
  ]);
  if (!passwordHash) {
    gateTitle.textContent    = "Set Your Password";
    gateSubtitle.textContent = "Choose a strong password to protect your settings. You will need it every time you make changes.";
    confirmInput.style.display = "block";
    gateBtn.textContent      = "Set Password & Enter";
    gateFeedback.style.color = "#6b7280";
    gateFeedback.textContent = "This cannot be recovered if forgotten!";
  } else {
    gateTitle.textContent    = "Enter Password";
    gateSubtitle.textContent = "Enter your blocker password to access settings.";
    confirmInput.style.display = "none";
    gateBtn.textContent      = "Unlock Settings";
  }
  if (startDate) {
    daysCountEl.textContent = Math.floor((Date.now() - startDate) / 86400000);
  }
})();

gateBtn.addEventListener("click", async () => {
  const { passwordHash } = await chrome.storage.local.get("passwordHash");
  const pass = passwordInput.value;
  if (!pass) { showGateFeedback("Please enter a password.", "#ef4444"); return; }

  if (!passwordHash) {
    if (pass !== confirmInput.value) { showGateFeedback("Passwords do not match.", "#ef4444"); return; }
    if (pass.length < 6) { showGateFeedback("Min 6 characters.", "#ef4444"); return; }
    const hash = await hashPassword(pass);
    chrome.runtime.sendMessage({ type: "SET_PASSWORD", hash }, showMainSettings);
  } else {
    const hash = await hashPassword(pass);
    chrome.runtime.sendMessage({ type: "VERIFY_PASSWORD", hash }, (res) => {
      if (res.valid) showMainSettings();
      else { showGateFeedback("Wrong password.", "#ef4444"); passwordInput.value = ""; }
    });
  }
});
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") gateBtn.click(); });

function showGateFeedback(msg, color) {
  gateFeedback.textContent = msg;
  gateFeedback.style.color = color;
}

// ── Show main UI ──────────────────────────────────────────────────────────
function showMainSettings() {
  passwordGate.classList.add("hidden");
  mainSettings.classList.remove("hidden");
  loadSettings();
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "domains", "enabled", "startDate",
    "keywordBlockingEnabled", "customKeywords", "whitelist"
  ]);
  allDomains     = data.domains || [];
  customKeywords = data.customKeywords || [];
  whitelist      = data.whitelist || [];

  enabledToggle.checked = data.enabled !== false;
  updateEnabledLabel();

  keywordToggle.checked = data.keywordBlockingEnabled !== false;
  updateKeywordLabel();

  if (data.startDate) {
    daysCountEl.textContent = Math.floor((Date.now() - data.startDate) / 86400000);
  }

  renderDomainList(allDomains);
  renderKeywordList();
  renderWhitelistList();
}

// ── Domain tab ───────────────────────────────────────────────────────────
function renderDomainList(domains) {
  totalCountEl.textContent = allDomains.length;
  domainListEl.innerHTML = "";
  if (domains.length === 0) {
    domainListEl.innerHTML = '<p class="empty-msg">No sites blocked yet.</p>'; return;
  }
  domains.forEach((domain) => {
    const item = document.createElement("div");
    item.className = "domain-item";
    item.innerHTML = `<span class="domain-name">🚫 ${domain}</span>
      <button class="btn-remove" data-domain="${domain}">Remove</button>`;
    domainListEl.appendChild(item);
  });
  domainListEl.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeDomain(btn.dataset.domain));
  });
}

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  renderDomainList(q ? allDomains.filter((d) => d.includes(q)) : allDomains);
});

addDomainBtn.addEventListener("click", addDomain);
addDomainInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addDomain(); });

function addDomain() {
  const raw = addDomainInput.value.trim();
  if (!raw) return;
  chrome.runtime.sendMessage({ type: "ADD_DOMAIN", domain: raw }, (res) => {
    if (res.success) {
      allDomains = res.domains;
      renderDomainList(allDomains);
      addDomainInput.value = "";
      showFeedback(addFeedback, "✅ " + normalizeDomain(raw) + " blocked.", "success");
    } else {
      showFeedback(addFeedback, "⚠️ " + res.error, "error");
    }
  });
}

function removeDomain(domain) {
  if (!confirm(`Remove "${domain}" from the block list?`)) return;
  chrome.runtime.sendMessage({ type: "REMOVE_DOMAIN", domain }, (res) => {
    if (res.success) { allDomains = res.domains; renderDomainList(allDomains); }
  });
}

// ── Keyword tab ───────────────────────────────────────────────────────────
keywordToggle.addEventListener("change", saveKeywordSettings);
function updateKeywordLabel() {
  keywordLabel.textContent = keywordToggle.checked ? "Keyword blocking ON" : "Keyword blocking OFF";
  keywordLabel.style.color = keywordToggle.checked ? "#22c55e" : "#ef4444";
}

addKeywordBtn.addEventListener("click", addKeyword);
addKeywordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addKeyword(); });

function addKeyword() {
  const kw = addKeywordInput.value.trim().toLowerCase();
  if (!kw) return;
  if (customKeywords.includes(kw)) { showFeedback(keywordFeedback, "Already added", "error"); return; }
  customKeywords.push(kw);
  saveKeywordSettings();
  renderKeywordList();
  addKeywordInput.value = "";
  showFeedback(keywordFeedback, `✅ "${kw}" added to keyword list`, "success");
}

function renderKeywordList() {
  keywordListEl.innerHTML = "";
  if (customKeywords.length === 0) {
    keywordListEl.innerHTML = '<p class="empty-msg">No custom keywords (built-in list always active).</p>'; return;
  }
  customKeywords.forEach((kw) => {
    const item = document.createElement("div");
    item.className = "domain-item";
    item.innerHTML = `<span class="domain-name"><span class="tag tag-keyword">keyword</span> ${kw}</span>
      <button class="btn-remove" data-kw="${kw}">Remove</button>`;
    keywordListEl.appendChild(item);
  });
  keywordListEl.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      customKeywords = customKeywords.filter((k) => k !== btn.dataset.kw);
      saveKeywordSettings();
      renderKeywordList();
    });
  });
}

addWhitelistBtn.addEventListener("click", addWhitelist);
addWhitelistInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addWhitelist(); });

function addWhitelist() {
  const d = normalizeDomain(addWhitelistInput.value);
  if (!d) return;
  if (whitelist.includes(d)) return;
  whitelist.push(d);
  saveKeywordSettings();
  renderWhitelistList();
  addWhitelistInput.value = "";
}

function renderWhitelistList() {
  whitelistListEl.innerHTML = "";
  if (whitelist.length === 0) {
    whitelistListEl.innerHTML = '<p class="empty-msg">No whitelisted domains.</p>'; return;
  }
  whitelist.forEach((d) => {
    const item = document.createElement("div");
    item.className = "domain-item";
    item.innerHTML = `<span class="domain-name"><span class="tag tag-whitelist">allowed</span> ${d}</span>
      <button class="btn-remove" data-d="${d}">Remove</button>`;
    whitelistListEl.appendChild(item);
  });
  whitelistListEl.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      whitelist = whitelist.filter((x) => x !== btn.dataset.d);
      saveKeywordSettings();
      renderWhitelistList();
    });
  });
}

function saveKeywordSettings() {
  updateKeywordLabel();
  chrome.runtime.sendMessage({
    type: "SET_KEYWORD_SETTINGS",
    enabled: keywordToggle.checked,
    customKeywords,
    whitelist
  });
}

// ── Block Log tab ─────────────────────────────────────────────────────────
function loadBlockLog() {
  chrome.runtime.sendMessage({ type: "GET_BLOCK_LOG" }, ({ blockLog }) => {
    blockLogEl.innerHTML = "";
    if (!blockLog || blockLog.length === 0) {
      blockLogEl.innerHTML = '<p class="empty-msg">No block events yet.</p>'; return;
    }
    blockLog.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "log-item";
      const t = new Date(entry.time).toLocaleString();
      item.innerHTML = `
        <div class="log-url" title="${entry.url}">${entry.url}</div>
        <div class="log-meta">
          <span class="log-keyword">🔍 "${entry.keyword}"</span>
          &nbsp;via ${entry.reason} &nbsp;·&nbsp;
          <span class="log-time">${t}</span>
        </div>`;
      blockLogEl.appendChild(item);
    });
  });
}

clearLogBtn.addEventListener("click", () => {
  if (!confirm("Clear all block log entries?")) return;
  chrome.storage.local.set({ blockLog: [] }, loadBlockLog);
});

// ── Security tab ──────────────────────────────────────────────────────────
resetDateBtn.addEventListener("click", () => {
  if (!confirm("Reset your 'days strong' counter to today?")) return;
  chrome.storage.local.set({ startDate: Date.now() }, () => {
    daysCountEl.textContent = 0;
    alert("Counter reset to Day 0. Stay strong! 💪");
  });
});

changePasswordBtn.addEventListener("click", async () => {
  const oldPass = prompt("Enter your CURRENT password:");
  if (oldPass === null) return;
  const oldHash = await hashPassword(oldPass);
  const { passwordHash } = await chrome.storage.local.get("passwordHash");
  if (oldHash !== passwordHash) { alert("❌ Wrong current password."); return; }
  const newPass = prompt("New password (min 6 chars):");
  if (!newPass || newPass.length < 6) { alert("Too short."); return; }
  if (newPass !== prompt("Confirm new password:")) { alert("Passwords don't match."); return; }
  const newHash = await hashPassword(newPass);
  chrome.runtime.sendMessage({ type: "SET_PASSWORD", hash: newHash }, () => {
    alert("✅ Password changed.");
  });
});

// ── Global toggle ─────────────────────────────────────────────────────────
enabledToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: enabledToggle.checked }, updateEnabledLabel);
});
function updateEnabledLabel() {
  enabledLabel.textContent = enabledToggle.checked ? "Enabled" : "Disabled";
  enabledLabel.style.color = enabledToggle.checked ? "#22c55e" : "#ef4444";
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showFeedback(el, msg, type) {
  el.textContent = msg;
  el.className = "feedback " + type;
  setTimeout(() => { el.textContent = ""; el.className = "feedback"; }, 3000);
}
