const crypto = require("crypto");

function createAdminAuth({ password, cookieName }) {
  function parseCookies(req) {
    const header = req.headers.cookie || "";
    return Object.fromEntries(
      header
        .split(";")
        .map((part) => part.trim().split("="))
        .filter(([key, value]) => key && value)
        .map(([key, value]) => [key, decodeURIComponent(value)])
    );
  }

  function token() {
    return crypto.createHash("sha256").update(`admin:${password}`).digest("hex");
  }

  function isAdmin(req) {
    return parseCookies(req)[cookieName] === token();
  }

  function loginCookie() {
    return `${cookieName}=${encodeURIComponent(token())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;
  }

  function logoutCookie() {
    return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }

  function isPasswordMatch(value) {
    return value === password;
  }

  return { isAdmin, isPasswordMatch, loginCookie, logoutCookie };
}

module.exports = { createAdminAuth };
