// content/content_blocker.js
// Injected into every page — scans for adult keywords and blocks the page if found.
// This catches sites that slip past domain-based blocking (e.g. search results, new domains).

(function () {
  "use strict";

  // ── Keywords that signal adult content ────────────────────────────────────
  // These are checked against the page title, URL, and visible headings.
  const ADULT_KEYWORDS = [
    "porn", "xxx", "nude", "naked", "nsfw", "hentai", "onlyfans",
    "camgirl", "webcam sex", "erotic", "escort", "sex video",
    "adult video", "masturbat", "fetish", "hardcore", "softcore",
    "blowjob", "handjob", "cumshot", "creampie", "gangbang",
    "milf", "teen sex", "incest", "bdsm", "bondage", "dildo",
    "vibrator", "stripper", "lap dance", "strip club",
    "sexual content", "explicit content", "18+", "adult content"
  ];

  // ── Config loaded from chrome.storage ─────────────────────────────────────
  let keywordBlockingEnabled = true;
  let customKeywords = [];
  let whitelist = []; // domains user has whitelisted

  chrome.storage.local.get(
    ["keywordBlockingEnabled", "customKeywords", "whitelist"],
    (data) => {
      keywordBlockingEnabled = data.keywordBlockingEnabled !== false;
      customKeywords = data.customKeywords || [];
      whitelist = data.whitelist || [];

      if (keywordBlockingEnabled) {
        checkPage();
      }
    }
  );

  // ── Main check ─────────────────────────────────────────────────────────────
  function checkPage() {
    const hostname = window.location.hostname.replace(/^www\./, "");

    // Skip if this domain is whitelisted
    if (whitelist.includes(hostname)) return;

    const allKeywords = [...ADULT_KEYWORDS, ...customKeywords].map((k) =>
      k.toLowerCase()
    );

    // Check 1: URL itself
    const urlText = window.location.href.toLowerCase();
    const urlMatch = allKeywords.find((kw) => urlText.includes(kw));
    if (urlMatch) {
      blockPage("URL pattern", urlMatch);
      return;
    }

    // Check 2: Page title
    const titleText = document.title.toLowerCase();
    const titleMatch = allKeywords.find((kw) => titleText.includes(kw));
    if (titleMatch) {
      blockPage("Page title", titleMatch);
      return;
    }

    // Check 3: Meta description and keywords tags
    const metaTags = document.querySelectorAll("meta[name='description'], meta[name='keywords']");
    for (const meta of metaTags) {
      const content = (meta.getAttribute("content") || "").toLowerCase();
      const metaMatch = allKeywords.find((kw) => content.includes(kw));
      if (metaMatch) {
        blockPage("Page metadata", metaMatch);
        return;
      }
    }

    // Check 4: H1 and H2 headings (most reliable signal)
    const headings = document.querySelectorAll("h1, h2");
    for (const h of headings) {
      const text = h.textContent.toLowerCase();
      const headingMatch = allKeywords.find((kw) => text.includes(kw));
      if (headingMatch) {
        blockPage("Page heading", headingMatch);
        return;
      }
    }
  }

  // ── Block the current page by replacing its content ───────────────────────
  function blockPage(reason, keyword) {
    // Immediately stop page execution
    window.stop();

    // Replace entire document with block page
    document.open();
    document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Blocked — Stay Strong</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f0f1a;
      color: #e2e8f0;
      font-family: "Segoe UI", system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: #1a1a2e;
      border: 1px solid #2d2d50;
      border-radius: 1.5rem;
      padding: 3rem 2rem;
      text-align: center;
      box-shadow: 0 0 60px rgba(99,102,241,0.15);
    }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.8rem; color: #6366f1; margin-bottom: 0.5rem; }
    .reason {
      font-size: 0.8rem;
      color: #4b5563;
      margin-bottom: 1.5rem;
      font-family: monospace;
    }
    .msg { color: #94a3b8; line-height: 1.7; margin-bottom: 2rem; }
    .tips {
      background: rgba(34,197,94,0.05);
      border: 1px solid rgba(34,197,94,0.2);
      border-radius: 0.75rem;
      padding: 1.2rem;
      text-align: left;
      margin-bottom: 2rem;
    }
    .tips p { color: #a7f3d0; font-size: 0.9rem; margin-bottom: 0.5rem; }
    .tips li { color: #6ee7b7; font-size: 0.85rem; padding-left: 1rem; list-style: none; }
    .tips li::before { content: "→ "; color: #22c55e; }
    .btn {
      background: #1e1e38;
      color: #94a3b8;
      border: 1px solid #374151;
      border-radius: 0.75rem;
      padding: 0.75rem 2rem;
      font-size: 0.9rem;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h1>Content Blocked</h1>
    <p class="reason">Triggered by ${reason}: "${keyword}"</p>
    <p class="msg">You are stronger than this urge.<br>This too shall pass. Take a breath.</p>
    <div class="tips">
      <p>💡 Do something else right now:</p>
      <ul>
        <li>Go for a 10-minute walk</li>
        <li>Drink a glass of cold water</li>
        <li>Do 20 push-ups</li>
        <li>Call a friend</li>
      </ul>
    </div>
    <button class="btn" onclick="history.back()">← Go Back</button>
  </div>
</body>
</html>`);
    document.close();

    // Notify background of a keyword block event
    chrome.runtime.sendMessage({
      type: "KEYWORD_BLOCK_EVENT",
      url: window.location.href,
      reason,
      keyword
    });
  }

  // ── Re-check when SPA navigates (React/Vue/Angular sites) ─────────────────
  // Many modern adult sites are SPAs — they change content without a full page load
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (keywordBlockingEnabled) {
        // Small delay to let SPA render its content
        setTimeout(checkPage, 600);
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

})();
