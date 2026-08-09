const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../backend/server");

const seedFile = path.resolve(__dirname, "../data/seed.json");
const testAuth = {
  username: "noart",
  password: "test-only-password",
  sessionSecret: "test-only-session-secret-with-32-characters",
  secureCookie: false
};

async function startTestServer(t) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "codestream-test-"));
  const dataFile = path.join(tempDirectory, "content.json");
  const app = await createApp({ dataFile, seedFile, auth: testAuth });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  return {
    dataFile,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function login(baseUrl, credentials = testAuth) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: credentials.username, password: credentials.password })
  });
  return { response, cookie: response.headers.get("set-cookie") };
}

test("health endpoint reports the service status", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/healthz`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "CodeStream" });
});

test("seed data is created and returned on first start", async (t) => {
  const { baseUrl, dataFile } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/data`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.schemaVersion, 1);
  assert.ok(data.directories.length >= 2);
  assert.equal(data.directories[0].name, "Bash");
  const codeBlocks = data.directories.flatMap((directory) =>
    directory.streams.flatMap((stream) => stream.blocks.filter((block) => block.type === "code"))
  );
  assert.ok(codeBlocks.every((block) => block.language === ""));
  assert.equal((await fs.stat(dataFile)).isFile(), true);
});

test("admin page and data writes require a login", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const adminResponse = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  const adminFileResponse = await fetch(`${baseUrl}/admin.html`, { redirect: "manual" });
  const writeResponse = await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, directories: [] })
  });

  assert.equal(adminResponse.status, 302);
  assert.equal(adminResponse.headers.get("location"), "/login");
  assert.equal(adminFileResponse.status, 302);
  assert.equal(adminFileResponse.headers.get("location"), "/login");
  assert.equal(writeResponse.status, 401);
  assert.match((await writeResponse.json()).error, /登录/);
});

test("only the configured account can log in", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const { response, cookie } = await login(baseUrl, {
    username: testAuth.username,
    password: "incorrect-password"
  });

  assert.equal(response.status, 401);
  assert.equal(cookie, null);
  assert.deepEqual(await response.json(), { error: "用户名或密码不正确" });
});

test("successful login creates a 30-day session and unlocks admin", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const { response, cookie } = await login(baseUrl);

  assert.equal(response.status, 200);
  assert.match(cookie, /^codestream_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=2592000/);

  const adminResponse = await fetch(`${baseUrl}/admin`, { headers: { Cookie: cookie } });
  const statusResponse = await fetch(`${baseUrl}/api/auth/status`, { headers: { Cookie: cookie } });
  assert.equal(adminResponse.status, 200);
  const adminHtml = await adminResponse.text();
  assert.match(adminHtml, /id="adminViewButton"/);
  assert.match(adminHtml, /id="adminCopyButton"/);
  assert.deepEqual(await statusResponse.json(), { authenticated: true, username: "noart" });
});

test("logout expires the session cookie", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const { cookie } = await login(baseUrl);
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie }
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("updated directory order is persisted to JSON", async (t) => {
  const { baseUrl, dataFile } = await startTestServer(t);
  const initial = await (await fetch(`${baseUrl}/api/data`)).json();
  initial.directories.reverse();
  const { cookie } = await login(baseUrl);

  const response = await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(initial)
  });
  const saved = await response.json();
  const fileData = JSON.parse(await fs.readFile(dataFile, "utf8"));

  assert.equal(response.status, 200);
  assert.equal(saved.directories[0].name, "Python");
  assert.equal(fileData.directories[0].name, "Python");
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("invalid content is rejected without replacing the JSON file", async (t) => {
  const { baseUrl, dataFile } = await startTestServer(t);
  const before = await fs.readFile(dataFile, "utf8");
  const { cookie } = await login(baseUrl);

  const response = await fetch(`${baseUrl}/api/data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ schemaVersion: 1, directories: [{ id: "bad" }] })
  });
  const result = await response.json();
  const after = await fs.readFile(dataFile, "utf8");

  assert.equal(response.status, 400);
  assert.match(result.error, /name/);
  assert.equal(after, before);
});
