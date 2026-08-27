// popup.js — Extension popup logic

const domainCountEl = document.getElementById("domainCount");
const daysStrongEl  = document.getElementById("daysStrong");
const statusBadge   = document.getElementById("statusBadge");
const addInput      = document.getElementById("addInput");
const addBtn        = document.getElementById("addBtn");
const addFeedback   = document.getElementById("addFeedback");
const settingsBtn   = document.getElementById("settingsBtn");

// ── Load status on open ──────────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (data) => {
  if (!data) return;
  domainCountEl.textContent = (data.domains || []).length;

  if (data.startDate) {
    const days = Math.floor((Date.now() - data.startDate) / 86400000);
    daysStrongEl.textContent = days;
  }

  if (data.enabled === false) {
    statusBadge.textContent = "OFF";
    statusBadge.classList.add("off");
  }
});

// ── Add domain from popup ────────────────────────────────────────────────────
async function addDomain() {
  const raw = addInput.value.trim();
  if (!raw) return;

  // Require password if one is set
  const { passwordHash } = await chrome.storage.local.get("passwordHash");
  if (passwordHash) {
    const pass = prompt("Enter your blocker password to add a domain:");
    if (pass === null) return;
    const hash = await hashPassword(pass);
    if (hash !== passwordHash) {
      showFeedback("❌ Wrong password", "error");
      return;
    }
  }

  chrome.runtime.sendMessage({ type: "ADD_DOMAIN", domain: raw }, (res) => {
    if (res.success) {
      showFeedback("✅ Blocked!", "success");
      addInput.value = "";
      domainCountEl.textContent = res.domains.length;
    } else {
      showFeedback("⚠️ " + res.error, "error");
    }
  });
}

addBtn.addEventListener("click", addDomain);
addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addDomain(); });

// ── Open settings/options page ───────────────────────────────────────────────
settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// ── Helper ───────────────────────────────────────────────────────────────────
function showFeedback(msg, type) {
  addFeedback.textContent = msg;
  addFeedback.className = "add-feedback " + type;
  setTimeout(() => {
    addFeedback.textContent = "";
    addFeedback.className = "add-feedback";
  }, 2500);
}
