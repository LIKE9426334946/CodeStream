const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const COOKIE_NAME = "codestream_session";

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(digest(String(left)), digest(String(right)));
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function createAuth({ username = "noart", password, sessionSecret, secureCookie = false } = {}) {
  if (!password) throw new Error("缺少 ADMIN_PASSWORD 环境变量");
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET 必须至少包含 32 个字符");
  }

  const failures = new Map();

  function sign(payload) {
    return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  }

  function createToken() {
    const payload = Buffer.from(JSON.stringify({
      sub: username,
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
    })).toString("base64url");
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (typeof token !== "string") return false;
    const separator = token.indexOf(".");
    if (separator < 1) return false;

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = sign(payload);
    if (!safeEqual(signature, expected)) return false;

    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return session.sub === username && Number.isInteger(session.exp) && session.exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }

  function isAuthenticated(request) {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    return verifyToken(token);
  }

  function cookieAttributes(maxAge) {
    const expires = new Date(Date.now() + Math.max(maxAge, 0) * 1000).toUTCString();
    return [
      `${COOKIE_NAME}=${maxAge > 0 ? createToken() : ""}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      `Expires=${expires}`,
      ...(secureCookie ? ["Secure"] : [])
    ].join("; ");
  }

  function requireAdminPage(request, response, next) {
    if (isAuthenticated(request)) return next();
    response.redirect(302, "/login");
  }

  function requireAdminApi(request, response, next) {
    if (isAuthenticated(request)) return next();
    response.set("Cache-Control", "no-store");
    response.status(401).json({ error: "登录已过期，请重新登录" });
  }

  function login(request, response) {
    response.set("Cache-Control", "no-store");
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = failures.get(key);

    if (record && now - record.startedAt < LOGIN_WINDOW_MS && record.count >= MAX_LOGIN_FAILURES) {
      const retrySeconds = Math.ceil((LOGIN_WINDOW_MS - (now - record.startedAt)) / 1000);
      response.set("Retry-After", String(retrySeconds));
      return response.status(429).json({ error: "尝试次数过多，请稍后再试" });
    }
    if (record && now - record.startedAt >= LOGIN_WINDOW_MS) failures.delete(key);

    const submittedUsername = typeof request.body?.username === "string" ? request.body.username : "";
    const submittedPassword = typeof request.body?.password === "string" ? request.body.password : "";
    const valid = safeEqual(submittedUsername, username) && safeEqual(submittedPassword, password);

    if (!valid) {
      const current = failures.get(key);
      failures.set(key, current
        ? { startedAt: current.startedAt, count: current.count + 1 }
        : { startedAt: now, count: 1 });
      return response.status(401).json({ error: "用户名或密码不正确" });
    }

    failures.delete(key);
    response.set("Set-Cookie", cookieAttributes(SESSION_SECONDS));
    return response.json({ authenticated: true, username });
  }

  function logout(_request, response) {
    response.set("Cache-Control", "no-store");
    response.set("Set-Cookie", cookieAttributes(0));
    response.json({ authenticated: false });
  }

  function status(request, response) {
    response.set("Cache-Control", "no-store");
    const authenticated = isAuthenticated(request);
    response.json(authenticated ? { authenticated, username } : { authenticated });
  }

  return {
    isAuthenticated,
    login,
    logout,
    requireAdminApi,
    requireAdminPage,
    status
  };
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, createAuth };
