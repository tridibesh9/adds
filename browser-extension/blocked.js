// blocked.js — Populates the blocked page with site name and day counter

// Show which site was blocked
const params = new URLSearchParams(window.location.search);
const site = params.get("site") || "this site";
document.getElementById("siteName").textContent = `🚫 ${site}`;

// Calculate days strong
chrome.storage.local.get("startDate", ({ startDate }) => {
  if (startDate) {
    const days = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
    document.getElementById("daysCount").textContent = days;
  }
});
