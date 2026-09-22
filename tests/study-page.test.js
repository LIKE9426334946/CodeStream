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
    children: [], textContent: "", hidden: false, disabled: false, value: "", style: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name)
    },
    append(...children) {
      children.forEach((child) => { child.parentNode = this; });
      this.children.push(...children);
    },
    replaceChildren(...children) { this.children = children; },
    remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); },
    focus() {}, select() {}, setSelectionRange() {},
    setAttribute() {}
  });
  return node;
}

function studyPage({ cached, serverData, hash = "", desktop = true, offline = false, delay, clipboard, execCommand } = {}) {
  const nodes = new Map();
  const storage = new Map(cached ? [[cacheKey, JSON.stringify(cached)]] : []);
  const requests = [];
  const timers = [];
  const document = new EventTarget();
  Object.assign(document, {
    body: element(), visibilityState: "visible", createElement: element, execCommand,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
  });
  const window = new EventTarget();
  Object.assign(window, {
    clearTimeout() {}, setTimeout(callback, ms) { timers.push({ callback, ms }); }, scrollTo() {},
    matchMedia: (query) => ({ matches: query.includes("min-width") ? desktop : true })
  });
  const page = { nodes, storage, requests, timers, document, window, serverData, offline, delay };
  vm.runInNewContext(source, {
    document, window, navigator: { clipboard }, location: { hash, pathname: "/" },
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
  assert.equal(page.nodes.get("#flowBlocks").children[0].children[1].children[0].textContent, "after-code-one");

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

function copyButtons(node) {
  return [
    ...(node.className === "study-copy-button" ? [node] : []),
    ...node.children.flatMap(copyButtons)
  ];
}

test("Copy copies only the selected code block and resets its success feedback", async () => {
  const latest = data("copy");
  const blocks = latest.directories[0].streams[0].blocks;
  blocks[0].content = "if ready:\n    print('你好')\n";
  blocks.push({ id: "second", type: "code", language: "", content: "\tgit status\n" });
  blocks.push({ id: "note", type: "note", language: "说明", content: "这是一段说明文字" });
  const copied = [];
  const page = studyPage({ serverData: latest, clipboard: { writeText: async (text) => copied.push(text) } });
  await settle();
  const buttons = copyButtons(page.nodes.get("#flowBlocks"));
  assert.equal(buttons.length, 2, "only code steps have a copy button");

  buttons[0].dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(copied, [blocks[0].content]);
  assert.equal(buttons[0].textContent, "Copied");
  assert.equal(buttons[1].textContent, "Copy");
  page.timers.find((timer) => timer.ms === 1400).callback();
  assert.equal(buttons[0].textContent, "Copy");
  assert.equal(buttons[0].disabled, false);

  buttons[1].dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(copied, blocks.slice(0, 2).map((block) => block.content));
});

test("mobile merged View copies all displayed content without description labels", async () => {
  const latest = data("merge");
  latest.directories[0].streams[0].blocks.push({ id: "note", type: "note", language: "省略标签", content: "保留正文" });
  const copied = [];
  const page = studyPage({ serverData: latest, desktop: false, hash: "#stream=stream-one", clipboard: { writeText: async (text) => copied.push(text) } });
  await settle();
  page.nodes.get("#viewModeButton").dispatchEvent(new Event("click"));
  const [button] = copyButtons(page.nodes.get("#flowBlocks"));
  button.dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(copied, ["merge-code-one\n\n保留正文"]);
});

for (const rejectedClipboard of [false, true]) {
  test(`Copy falls back to HTTP-compatible copying when clipboard is ${rejectedClipboard ? "denied" : "unavailable"}`, async () => {
    let copied;
    let restoredFocus = false;
    const page = studyPage({
      serverData: data("fallback"),
      clipboard: rejectedClipboard ? { writeText: async () => { throw new Error("Denied"); } } : undefined,
      execCommand(command) {
        assert.equal(command, "copy");
        copied = page.document.body.children[0].value;
        return true;
      }
    });
    page.document.activeElement = { focus: () => { restoredFocus = true; } };
    await settle();
    const [button] = copyButtons(page.nodes.get("#flowBlocks"));
    button.dispatchEvent(new Event("click"));
    await settle();
    assert.equal(copied, "fallback-code-one");
    assert.equal(button.textContent, "Copied");
    assert.equal(page.document.body.children.length, 0, "temporary textarea must be removed");
    assert.equal(restoredFocus, true);
  });
}

test("failed copying keeps the button usable and shows a failure message", async () => {
  const page = studyPage({ serverData: data("failure"), execCommand: () => false });
  await settle();
  const [button] = copyButtons(page.nodes.get("#flowBlocks"));
  button.dispatchEvent(new Event("click"));
  await settle();
  assert.equal(button.textContent, "Copy");
  assert.equal(button.disabled, false);
  assert.match(page.nodes.get("#toast").textContent, /复制失败/);
  assert.equal(page.document.body.children.length, 0);
});
