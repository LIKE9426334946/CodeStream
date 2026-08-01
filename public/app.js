const state = {
  data: null,
  activeDirectoryId: null,
  activeStreamId: null,
  query: ""
};

const elements = {
  body: document.body,
  directoryList: document.querySelector("#directoryList"),
  directoryTitle: document.querySelector("#directoryTitle"),
  directoryDescription: document.querySelector("#directoryDescription"),
  streamList: document.querySelector("#streamList"),
  searchInput: document.querySelector("#searchInput"),
  readerPanel: document.querySelector("#readerPanel"),
  readerPath: document.querySelector("#readerPath"),
  readerTitle: document.querySelector("#readerTitle"),
  readerDescription: document.querySelector("#readerDescription"),
  stepCount: document.querySelector("#stepCount"),
  flowBlocks: document.querySelector("#flowBlocks"),
  backButton: document.querySelector("#backButton"),
  refreshButton: document.querySelector("#refreshButton"),
  toast: document.querySelector("#toast")
};

let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function activeDirectory() {
  return state.data?.directories.find((directory) => directory.id === state.activeDirectoryId) || null;
}

function findStream(streamId) {
  for (const directory of state.data?.directories || []) {
    const stream = directory.streams.find((item) => item.id === streamId);
    if (stream) return { directory, stream };
  }
  return null;
}

function makeEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function renderDirectories() {
  elements.directoryList.replaceChildren();

  if (!state.data.directories.length) {
    elements.directoryList.append(makeEmptyState("还没有目录，请在电脑管理端添加。"));
    return;
  }

  state.data.directories.forEach((directory) => {
    const button = document.createElement("button");
    button.className = "directory-button";
    button.classList.toggle("active", directory.id === state.activeDirectoryId);
    button.type = "button";
    button.setAttribute("aria-pressed", String(directory.id === state.activeDirectoryId));

    const name = document.createElement("span");
    name.textContent = directory.name;
    const count = document.createElement("span");
    count.className = "directory-count";
    count.textContent = String(directory.streams.length);
    button.append(name, count);

    button.addEventListener("click", () => {
      state.activeDirectoryId = directory.id;
      state.activeStreamId = null;
      state.query = "";
      elements.searchInput.value = "";
      elements.body.classList.remove("reader-open");
      history.replaceState(null, "", location.pathname);
      render();
    });

    elements.directoryList.append(button);
  });
}

function streamMatches(stream, query) {
  if (!query) return true;
  const haystack = [
    stream.name,
    stream.description,
    ...stream.blocks.map((block) => block.content)
  ].join("\n").toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function renderStreams() {
  const directory = activeDirectory();
  elements.streamList.replaceChildren();

  if (!directory) {
    elements.directoryTitle.textContent = "还没有目录";
    elements.directoryDescription.textContent = "请前往电脑管理端创建第一个复习目录。";
    elements.streamList.append(makeEmptyState("暂无可学习的代码流。"));
    return;
  }

  elements.directoryTitle.textContent = directory.name;
  elements.directoryDescription.textContent = directory.description || `${directory.streams.length} 个代码流`;
  const streams = directory.streams.filter((stream) => streamMatches(stream, state.query.trim()));

  if (!streams.length) {
    elements.streamList.append(makeEmptyState(state.query ? "没有找到匹配的代码流或代码内容。" : "这个目录还没有代码流。"));
    return;
  }

  streams.forEach((stream) => {
    const card = document.createElement("button");
    card.className = "stream-card";
    card.classList.toggle("active", stream.id === state.activeStreamId);
    card.type = "button";

    const title = document.createElement("h2");
    title.textContent = stream.name;
    const description = document.createElement("p");
    description.textContent = stream.description || "打开查看完整代码流程";
    const meta = document.createElement("span");
    meta.className = "stream-meta";
    meta.textContent = `${stream.blocks.length} 个步骤`;
    card.append(title, description, meta);

    card.addEventListener("click", () => openStream(stream.id));
    elements.streamList.append(card);
  });
}

function renderReader() {
  const result = findStream(state.activeStreamId);
  elements.readerPanel.hidden = !result;
  elements.flowBlocks.replaceChildren();

  if (!result) return;

  const { directory, stream } = result;
  elements.readerPath.textContent = `${directory.name}  /  代码流`;
  elements.readerTitle.textContent = stream.name;
  elements.readerDescription.textContent = stream.description || "按顺序复习下面的内容。";
  elements.stepCount.textContent = `${stream.blocks.length} 个步骤`;

  if (!stream.blocks.length) {
    elements.flowBlocks.append(makeEmptyState("这个代码流还没有步骤。"));
    return;
  }

  stream.blocks.forEach((block, index) => {
    const row = document.createElement("section");
    row.className = "flow-block";
    const number = document.createElement("span");
    number.className = "flow-index";
    number.textContent = String(index + 1).padStart(2, "0");

    if (block.type === "code") {
      const card = document.createElement("div");
      card.className = "code-card";
      const top = document.createElement("div");
      top.className = "code-card-top";
      const language = document.createElement("span");
      language.textContent = block.language || "code";
      const copy = document.createElement("button");
      copy.className = "copy-button";
      copy.type = "button";
      copy.textContent = "复制";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          copy.textContent = "已复制";
          window.setTimeout(() => { copy.textContent = "复制"; }, 1200);
        } catch {
          showToast("复制失败，请长按代码手动复制");
        }
      });
      top.append(language, copy);

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.content;
      pre.append(code);
      card.append(top, pre);
      row.append(number, card);
    } else {
      const note = document.createElement("div");
      note.className = "note-card";
      note.textContent = block.content;
      row.append(number, note);
    }

    elements.flowBlocks.append(row);
  });
}

function render() {
  renderDirectories();
  renderStreams();
  renderReader();
}

function openStream(streamId, { updateHistory = true } = {}) {
  const result = findStream(streamId);
  if (!result) return;
  state.activeDirectoryId = result.directory.id;
  state.activeStreamId = streamId;
  elements.body.classList.add("reader-open");

  if (updateHistory) {
    history.pushState({ streamId }, "", `#stream=${encodeURIComponent(streamId)}`);
  }

  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function closeReader({ updateHistory = true } = {}) {
  state.activeStreamId = null;
  elements.body.classList.remove("reader-open");
  if (updateHistory) history.pushState(null, "", location.pathname);
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function streamIdFromHash() {
  const match = location.hash.match(/^#stream=(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function loadData({ notify = false } = {}) {
  elements.refreshButton.disabled = true;
  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取内容");
    const data = await response.json();
    state.data = data;

    if (!data.directories.some((directory) => directory.id === state.activeDirectoryId)) {
      state.activeDirectoryId = data.directories[0]?.id || null;
    }

    const hashStreamId = streamIdFromHash();
    if (hashStreamId && findStream(hashStreamId)) {
      state.activeStreamId = hashStreamId;
      elements.body.classList.add("reader-open");
    } else if (state.activeStreamId && !findStream(state.activeStreamId)) {
      state.activeStreamId = null;
      elements.body.classList.remove("reader-open");
    } else if (!state.activeStreamId && window.matchMedia("(min-width: 900px)").matches) {
      state.activeStreamId = activeDirectory()?.streams[0]?.id || null;
    }

    render();
    if (notify) showToast("已经加载服务器上的最新内容");
  } catch (error) {
    console.error(error);
    showToast("内容加载失败，请稍后重试");
    if (!state.data) {
      state.data = { schemaVersion: 1, directories: [] };
      render();
    }
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderStreams();
});

elements.backButton.addEventListener("click", () => {
  if (location.hash) history.back();
  else closeReader({ updateHistory: false });
});
elements.refreshButton.addEventListener("click", () => loadData({ notify: true }));

window.addEventListener("popstate", () => {
  const streamId = streamIdFromHash();
  if (streamId && findStream(streamId)) {
    openStream(streamId, { updateHistory: false });
  } else {
    closeReader({ updateHistory: false });
  }
});

loadData();
