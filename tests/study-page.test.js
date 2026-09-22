const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const cacheKey = "codestream:study-data:v1";
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Only browser primitives are stubbed; the real app handles loading and rendering.
function element() {
  const node = new EventTarget();
  const classes = new Set();
  Object.assign(node, {
    children: [], textContent: "", hidden: false, disabled: false, value: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name)
    },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}
  });
  return node;
}

function studyPage({ cached, serverData, hash = "", desktop = true, offline = false, delay } = {}) {
  const nodes = new Map();
  const storage = new Map(cached ? [[cacheKey, JSON.stringify(cached)]] : []);
  const requests = [];
  const document = new EventTarget();
  Object.assign(document, {
    body: element(), visibilityState: "visible", createElement: element,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
  });
  const window = new EventTarget();
  Object.assign(window, {
    clearTimeout() {}, setTimeout() {}, scrollTo() {},
    matchMedia: (query) => ({ matches: query.includes("min-width") ? desktop : true })
  });
  const page = { nodes, storage, requests, document, window, serverData, offline, delay };
  vm.runInNewContext(source, {
    document, window, location: { hash, pathname: "/" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    console: { error() {}, warn() {} },
    async fetch(url, options) {
      requests.push({ url, options });
      if (page.delay) await page.delay;
      if (page.offline) throw new Error("Offline");
      return { ok: true, json: async () => structuredClone(page.serverData) };
    }
  });
  return page;
}

function data(label) {
  return {
    schemaVersion: 1,
    directories: ["one", "two"].map((id) => ({
      id, name: `${label}-${id}`, description: "",
      streams: [{
        id: `stream-${id}`, name: `${label}-stream-${id}`, description: "",
        blocks: [{ id: `block-${id}`, type: "code", language: "说明", content: `${label}-code-${id}` }]
      }]
    }))
  };
}

test("a cached study page still fetches the latest directory order, streams and content", async () => {
  const latest = data("new");
  latest.directories.reverse();
  const page = studyPage({ cached: data("old"), serverData: latest });
  assert.equal(page.nodes.get("#directoryTitle").textContent, "old-one");
  await settle();

  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, "/api/data");
  assert.equal(page.requests[0].options.cache, "no-store");
  assert.equal(page.nodes.get("#directoryList").children[0].children[0].textContent, "new-two");
  assert.equal(page.nodes.get("#directoryTitle").textContent, "new-one");
  assert.equal(page.nodes.get("#streamList").children[0].children[0].textContent, "new-stream-one");
  assert.equal(page.nodes.get("#readerTitle").textContent, "new-stream-one");
  assert.deepEqual(JSON.parse(page.storage.get(cacheKey)), latest);
  assert.equal(page.nodes.get("#refreshButton").hidden, false);
});

test("a link to a stream selects its actual directory", async () => {
  const page = studyPage({ serverData: data("latest"), hash: "#stream=stream-two" });
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "latest-two");
  assert.equal(page.nodes.get("#readerTitle").textContent, "latest-stream-two");
  assert.equal(page.nodes.get("#directoryList").children[1].classList.contains("active"), true);
});

test("returning from admin refreshes the current stream and preserves View mode and search", async () => {
  const page = studyPage({ serverData: data("before") });
  await settle();
  page.nodes.get("#viewModeButton").dispatchEvent(new Event("click"));
  page.nodes.get("#searchInput").value = "stream-one";
  page.nodes.get("#searchInput").dispatchEvent(new Event("input"));
  page.serverData = data("after");
  page.window.dispatchEvent(new Event("focus"));
  await settle();

  assert.equal(page.requests.length, 2);
  assert.equal(page.nodes.get("#readerTitle").textContent, "after-stream-one");
  assert.equal(page.nodes.get("#viewModeButton").textContent, "Cancel");
  assert.equal(page.nodes.get("#searchInput").value, "stream-one");
  assert.equal(page.nodes.get("#flowBlocks").children[0].children[0].children[0].textContent, "after-code-one");

  const card = page.nodes.get("#flowBlocks").children[0];
  page.window.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(page.nodes.get("#flowBlocks").children[0], card, "unchanged data must not rebuild the reader");
});

test("overlapping page events do not issue concurrent data requests", async () => {
  let release;
  const delay = new Promise((resolve) => { release = resolve; });
  const page = studyPage({ cached: data("old"), serverData: data("new"), delay });
  page.window.dispatchEvent(new Event("focus"));
  page.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(page.requests.length, 1);
  release();
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "new-one");
  assert.equal(page.nodes.get("#refreshButton").disabled, false);
});

test("offline refresh preserves content, reports staleness and recovers when online", async () => {
  const cached = data("cached");
  const page = studyPage({ cached, serverData: data("online"), offline: true });
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "cached-one");
  assert.deepEqual(JSON.parse(page.storage.get(cacheKey)), cached);
  assert.match(page.nodes.get("#toast").textContent, /之前加载/);
  assert.equal(page.nodes.get("#refreshButton").disabled, false);

  page.offline = false;
  page.window.dispatchEvent(new Event("online"));
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "online-one");
});

test("mobile tab and back-forward restoration refresh without opening a reader", async () => {
  const page = studyPage({ serverData: data("initial"), desktop: false });
  await settle();
  assert.equal(page.nodes.get("#readerPanel").hidden, true);
  page.document.visibilityState = "hidden";
  page.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(page.requests.length, 1);

  page.serverData = data("visible");
  page.document.visibilityState = "visible";
  page.document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "visible-one");

  page.serverData = data("restored");
  const event = new Event("pageshow");
  event.persisted = true;
  page.window.dispatchEvent(event);
  await settle();
  assert.equal(page.nodes.get("#directoryTitle").textContent, "restored-one");
  assert.equal(page.nodes.get("#readerPanel").hidden, true);
});
