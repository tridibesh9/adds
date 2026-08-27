// utils.js — Shared utility functions

/**
 * Hash a password with SHA-256 + fixed salt via Web Crypto API.
 */
async function hashPassword(password) {
  const salt = "!!stay-strong-adult-blocker-2024!!";
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize a user-entered domain:
 * "https://www.Pornhub.com/videos" → "pornhub.com"
 */
function normalizeDomain(input) {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//i, "");
  d = d.replace(/^www\./i, "");
  d = d.split("/")[0];
  d = d.split(":")[0];
  return d;
}

/**
 * Returns true if string looks like a valid domain name.
 */
function isValidDomain(domain) {
  return /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/.test(domain);
}
