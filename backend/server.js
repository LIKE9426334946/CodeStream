const path = require("node:path");
const express = require("express");
const { createAuth } = require("./auth");
const { JsonStore } = require("./data-store");

const projectRoot = path.resolve(__dirname, "..");

async function createApp(options = {}) {
  const dataFile = options.dataFile || process.env.DATA_FILE || path.join(projectRoot, "data", "content.json");
  const seedFile = options.seedFile || path.join(projectRoot, "data", "seed.json");
  const store = options.store || new JsonStore({ dataFile, seedFile });
  await store.initialize();
  const authOptions = options.auth || {};
  const auth = createAuth({
    username: authOptions.username || process.env.ADMIN_USERNAME || "noart",
    password: authOptions.password || process.env.ADMIN_PASSWORD,
    sessionSecret: authOptions.sessionSecret || process.env.SESSION_SECRET,
    secureCookie: authOptions.secureCookie ?? process.env.COOKIE_SECURE === "true"
  });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "5mb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok", service: "CodeStream" });
  });

  app.get("/api/data", async (_request, response, next) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await store.read());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/status", auth.status);
  app.post("/api/auth/login", auth.login);
  app.post("/api/auth/logout", auth.logout);

  app.put("/api/data", auth.requireAdminApi, async (request, response, next) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await store.write(request.body));
    } catch (error) {
      next(error);
    }
  });

  const sendLoginPage = (request, response) => {
    response.set("Cache-Control", "no-store");
    if (auth.isAuthenticated(request)) return response.redirect(302, "/admin");
    return response.sendFile(path.join(projectRoot, "public", "login.html"));
  };

  const sendAdminPage = (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.sendFile(path.join(projectRoot, "public", "admin.html"));
  };

  app.get(["/login", "/login.html"], sendLoginPage);
  app.get(["/admin", "/admin.html"], auth.requireAdminPage, sendAdminPage);

  app.use(express.static(path.join(projectRoot, "public"), {
    etag: true,
    maxAge: 0
  }));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "接口不存在" });
  });

  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    response.status(status).json({
      error: status >= 500 ? "服务器暂时无法处理请求" : error.message
    });
  });

  return app;
}

async function startServer() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "3020", 10);
  const app = await createApp();
  const server = app.listen(port, host, () => {
    console.log(`CodeStream listening on http://${host}:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down CodeStream`);
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp, startServer };
