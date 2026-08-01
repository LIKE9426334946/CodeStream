const state = {
  data: null,
  activeDirectoryId: null,
  activeStreamId: null,
  saveVersion: 0,
  saveQueue: Promise.resolve()
};

const elements = {
  directoryList: document.querySelector("#adminDirectoryList"),
  streamList: document.querySelector("#adminStreamList"),
  blockList: document.querySelector("#adminBlockList"),
  streamTitle: document.querySelector("#adminStreamTitle"),
  blockTitle: document.querySelector("#adminBlockTitle"),
  blockDescription: document.querySelector("#adminBlockDescription"),
  addDirectory: document.querySelector("#addDirectoryButton"),
  addStream: document.querySelector("#addStreamButton"),
  addBlock: document.querySelector("#addBlockButton"),
  editStream: document.querySelector("#editStreamButton"),
  saveStatus: document.querySelector("#saveStatus"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  importInput: document.querySelector("#importInput"),
  dialog: document.querySelector("#editorDialog"),
  dialogForm: document.querySelector("#editorForm"),
  dialogEyebrow: document.querySelector("#dialogEyebrow"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogFields: document.querySelector("#dialogFields"),
  toast: document.querySelector("#toast")
};

let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function newId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function activeDirectory() {
  return state.data?.directories.find((directory) => directory.id === state.activeDirectoryId) || null;
}

function activeStream() {
  return activeDirectory()?.streams.find((stream) => stream.id === state.activeStreamId) || null;
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function actionButton(label, title, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mini-action ${className || ""}`.trim();
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function sortableItem({ id, title, subtitle, selected, onSelect, onEdit, onDelete }) {
  const item = document.createElement("div");
  item.className = "sortable-item";
  item.classList.toggle("selected", selected);
  item.dataset.id = id;
  item.draggable = true;

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "⠿";
  handle.title = "拖动排序";

  const copy = document.createElement("div");
  copy.className = "sortable-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const detail = document.createElement("span");
  detail.textContent = subtitle;
  copy.append(strong, detail);

  const actions = document.createElement("div");
  actions.className = "item-actions";
  if (onEdit) actions.append(actionButton("改", "修改", "", onEdit));
  if (onDelete) actions.append(actionButton("删", "删除", "danger", onDelete));

  item.append(handle, copy, actions);
  item.addEventListener("click", onSelect);
  return item;
}

function renderDirectories() {
  elements.directoryList.replaceChildren();
  const directories = state.data.directories;

  if (!directories.length) {
    elements.directoryList.append(emptyState("还没有目录，点击右上角 + 创建。"));
    return;
  }

  directories.forEach((directory) => {
    elements.directoryList.append(sortableItem({
      id: directory.id,
      title: directory.name,
      subtitle: `${directory.streams.length} 个代码流`,
      selected: directory.id === state.activeDirectoryId,
      onSelect: () => {
        state.activeDirectoryId = directory.id;
        state.activeStreamId = directory.streams[0]?.id || null;
        renderAll();
      },
      onEdit: () => openDirectoryDialog(directory),
      onDelete: () => deleteDirectory(directory)
    }));
  });

  enableSorting(elements.directoryList, directories, () => {
    renderAll();
    persist();
  });
}

function renderStreams() {
  const directory = activeDirectory();
  elements.streamList.replaceChildren();
  elements.streamTitle.textContent = directory ? directory.name : "代码流";
  elements.addStream.disabled = !directory;

  if (!directory) {
    elements.streamList.append(emptyState("请先创建或选择一个目录。"));
    return;
  }

  if (!directory.streams.length) {
    elements.streamList.append(emptyState("当前目录还没有代码流，点击右上角 + 创建。"));
    return;
  }

  directory.streams.forEach((stream) => {
    elements.streamList.append(sortableItem({
      id: stream.id,
      title: stream.name,
      subtitle: `${stream.blocks.length} 个步骤`,
      selected: stream.id === state.activeStreamId,
      onSelect: () => {
        state.activeStreamId = stream.id;
        renderAll();
      },
      onEdit: () => openStreamDialog(stream),
      onDelete: () => deleteStream(stream)
    }));
  });

  enableSorting(elements.streamList, directory.streams, () => {
    renderAll();
    persist();
  });
}

function renderBlocks() {
  const stream = activeStream();
  elements.blockList.replaceChildren();
  elements.addBlock.disabled = !stream;
  elements.editStream.disabled = !stream;
  elements.blockTitle.textContent = stream?.name || "选择代码流";
  elements.blockDescription.textContent = stream?.description || "选择左侧代码流后，在这里编辑具体步骤。";

  if (!stream) {
    elements.blockList.append(emptyState("请选择一个代码流。"));
    return;
  }

  if (!stream.blocks.length) {
    elements.blockList.append(emptyState("还没有步骤。可以添加代码或说明，并自由混合排序。"));
    return;
  }

  stream.blocks.forEach((block) => {
    const item = document.createElement("div");
    item.className = "sortable-item block-item";
    item.dataset.id = block.id;
    item.draggable = true;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";

    const preview = document.createElement("div");
    preview.className = "block-preview";
    const top = document.createElement("div");
    top.className = "block-preview-top";
    const badge = document.createElement("span");
    badge.className = `type-badge ${block.type}`;
    badge.textContent = block.type === "code" ? "CODE" : "NOTE";
    top.append(badge);
    const languageLabel = block.type === "code" ? (block.language || "").trim() : "说明文字";
    if (languageLabel) {
      const language = document.createElement("span");
      language.className = "drag-hint";
      language.style.margin = "0";
      language.textContent = languageLabel;
      top.append(language);
    }

    const content = document.createElement(block.type === "code" ? "pre" : "p");
    content.textContent = block.content;
    preview.append(top, content);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      actionButton("改", "修改步骤", "", () => openBlockDialog(block)),
      actionButton("删", "删除步骤", "danger", () => deleteBlock(block))
    );

    item.append(handle, preview, actions);
    item.addEventListener("dblclick", () => openBlockDialog(block));
    elements.blockList.append(item);
  });

  enableSorting(elements.blockList, stream.blocks, () => {
    renderBlocks();
    persist();
  });
}

function renderAll() {
  const directories = state.data.directories;
  if (!directories.some((directory) => directory.id === state.activeDirectoryId)) {
    state.activeDirectoryId = directories[0]?.id || null;
  }

  const directory = activeDirectory();
  if (!directory?.streams.some((stream) => stream.id === state.activeStreamId)) {
    state.activeStreamId = directory?.streams[0]?.id || null;
  }

  renderDirectories();
  renderStreams();
  renderBlocks();
}

function enableSorting(container, collection, onSorted) {
  let draggedId = null;

  container.ondragstart = (event) => {
    const item = event.target.closest("[data-id]");
    if (!item) return;
    draggedId = item.dataset.id;
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedId);
  };

  container.ondragover = (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-id]");
    container.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    if (target && target.dataset.id !== draggedId) target.classList.add("drag-over");
  };

  container.ondrop = (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-id]");
    if (!draggedId || !target || target.dataset.id === draggedId) return;

    const sourceIndex = collection.findIndex((item) => item.id === draggedId);
    if (sourceIndex < 0) return;
    const [moved] = collection.splice(sourceIndex, 1);
    let targetIndex = collection.findIndex((item) => item.id === target.dataset.id);
    const rectangle = target.getBoundingClientRect();
    if (event.clientY > rectangle.top + rectangle.height / 2) targetIndex += 1;
    collection.splice(targetIndex, 0, moved);
    onSorted();
  };

  container.ondragend = () => {
    draggedId = null;
    container.querySelectorAll(".dragging, .drag-over").forEach((item) => {
      item.classList.remove("dragging", "drag-over");
    });
  };
}

function setFields(fields) {
  elements.dialogFields.replaceChildren();
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "form-field";
    label.dataset.field = field.name;
    const text = document.createElement("span");
    text.textContent = field.label;
    let input;

    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = field.rows || 4;
      if (field.code) input.className = "code-input";
    } else if (field.type === "select") {
      input = document.createElement("select");
      field.options.forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        input.append(node);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type || "text";
    }

    input.name = field.name;
    input.value = field.value || "";
    input.placeholder = field.placeholder || "";
    input.required = Boolean(field.required);
    if (field.maxLength) input.maxLength = field.maxLength;
    label.append(text, input);
    elements.dialogFields.append(label);
  });
}

function openEditor({ eyebrow, title, fields, onSave, onChange }) {
  elements.dialogEyebrow.textContent = eyebrow;
  elements.dialogTitle.textContent = title;
  setFields(fields);

  elements.dialogFields.onchange = onChange || null;

  elements.dialogForm.onsubmit = async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      elements.dialog.close();
      return;
    }
    if (!elements.dialogForm.reportValidity()) return;

    const values = Object.fromEntries(new FormData(elements.dialogForm));
    await onSave(values);
    elements.dialog.close();
  };

  elements.dialog.showModal();
  window.setTimeout(() => elements.dialogFields.querySelector("input, textarea, select")?.focus(), 40);
}

function commonNameFields(item, nameLabel, { nameMax = 80, descriptionMax = 300 } = {}) {
  return [
    { name: "name", label: nameLabel, value: item?.name, required: true, maxLength: nameMax, placeholder: `例如：${nameLabel === "目录名称" ? "Python" : "部署 Node.js 项目"}` },
    { name: "description", label: "简短说明（可选）", value: item?.description, type: "textarea", rows: 3, maxLength: descriptionMax, placeholder: "用一句话说明这组内容的用途" }
  ];
}

function openDirectoryDialog(directory = null) {
  openEditor({
    eyebrow: "DIRECTORY",
    title: directory ? "修改目录" : "新增目录",
    fields: commonNameFields(directory, "目录名称", { nameMax: 40, descriptionMax: 160 }),
    onSave: async ({ name, description }) => {
      if (directory) {
        directory.name = name.trim();
        directory.description = description.trim();
      } else {
        const item = { id: newId("dir"), name: name.trim(), description: description.trim(), streams: [] };
        state.data.directories.push(item);
        state.activeDirectoryId = item.id;
        state.activeStreamId = null;
      }
      renderAll();
      persist();
    }
  });
}

function openStreamDialog(stream = null) {
  const directory = activeDirectory();
  if (!directory) return;
  openEditor({
    eyebrow: "CODE FLOW",
    title: stream ? "修改代码流" : "新增代码流",
    fields: commonNameFields(stream, "代码流名称"),
    onSave: async ({ name, description }) => {
      if (stream) {
        stream.name = name.trim();
        stream.description = description.trim();
      } else {
        const item = { id: newId("stream"), name: name.trim(), description: description.trim(), blocks: [] };
        directory.streams.push(item);
        state.activeStreamId = item.id;
      }
      renderAll();
      persist();
    }
  });
}

function toggleLanguageField() {
  const type = elements.dialogFields.querySelector('[name="type"]')?.value;
  const languageField = elements.dialogFields.querySelector('[data-field="language"]');
  if (languageField) languageField.hidden = type !== "code";
  const content = elements.dialogFields.querySelector('[name="content"]');
  content?.classList.toggle("code-input", type === "code");
}

function openBlockDialog(block = null) {
  const stream = activeStream();
  if (!stream) return;
  openEditor({
    eyebrow: "CONTENT STEP",
    title: block ? "修改步骤" : "新增步骤",
    fields: [
      {
        name: "type",
        label: "内容类型",
        type: "select",
        value: block?.type || "code",
        options: [
          { value: "code", label: "代码" },
          { value: "note", label: "说明文字" }
        ]
      },
      { name: "language", label: "语言标签", value: block?.language || "", maxLength: 30, placeholder: "例如 bash、python、javascript（可不填）" },
      { name: "content", label: "内容", type: "textarea", code: block?.type !== "note", value: block?.content, required: true, rows: 10, placeholder: "输入代码或复习说明" }
    ],
    onChange: (event) => {
      if (event.target.name === "type") toggleLanguageField();
    },
    onSave: async ({ type, language, content }) => {
      if (block) {
        block.type = type;
        block.language = type === "code" ? language.trim() : "";
        block.content = content;
      } else {
        stream.blocks.push({
          id: newId("block"),
          type,
          language: type === "code" ? language.trim() : "",
          content
        });
      }
      renderBlocks();
      persist();
    }
  });
  toggleLanguageField();
}

function deleteDirectory(directory) {
  if (!confirm(`确定删除目录“${directory.name}”吗？其中的所有代码流也会被删除。`)) return;
  state.data.directories = state.data.directories.filter((item) => item.id !== directory.id);
  state.activeDirectoryId = state.data.directories[0]?.id || null;
  state.activeStreamId = activeDirectory()?.streams[0]?.id || null;
  renderAll();
  persist();
}

function deleteStream(stream) {
  if (!confirm(`确定删除代码流“${stream.name}”吗？`)) return;
  const directory = activeDirectory();
  directory.streams = directory.streams.filter((item) => item.id !== stream.id);
  state.activeStreamId = directory.streams[0]?.id || null;
  renderAll();
  persist();
}

function deleteBlock(block) {
  if (!confirm("确定删除这个步骤吗？")) return;
  const stream = activeStream();
  stream.blocks = stream.blocks.filter((item) => item.id !== block.id);
  renderBlocks();
  persist();
}

function persist() {
  const version = ++state.saveVersion;
  const snapshot = JSON.parse(JSON.stringify(state.data));
  elements.saveStatus.textContent = "正在保存…";

  state.saveQueue = state.saveQueue.catch(() => undefined).then(async () => {
    const response = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败");
    if (version === state.saveVersion) {
      state.data.updatedAt = result.updatedAt;
      elements.saveStatus.textContent = "已保存";
    }
  }).catch((error) => {
    console.error(error);
    elements.saveStatus.textContent = "保存失败";
    showToast(`保存失败：${error.message}`);
    return undefined;
  });

  return state.saveQueue;
}

async function loadData() {
  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取数据");
    state.data = await response.json();
    state.activeDirectoryId = state.data.directories[0]?.id || null;
    state.activeStreamId = activeDirectory()?.streams[0]?.id || null;
    elements.saveStatus.textContent = "已载入";
    renderAll();
  } catch (error) {
    console.error(error);
    elements.saveStatus.textContent = "载入失败";
    showToast("数据载入失败，请检查服务状态");
  }
}

elements.addDirectory.addEventListener("click", () => openDirectoryDialog());
elements.addStream.addEventListener("click", () => openStreamDialog());
elements.addBlock.addEventListener("click", () => openBlockDialog());
elements.editStream.addEventListener("click", () => {
  const stream = activeStream();
  if (stream) openStreamDialog(stream);
});

elements.exportButton.addEventListener("click", () => {
  if (!state.data) return;
  const blob = new Blob([`${JSON.stringify(state.data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `codestream-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", async () => {
  const [file] = elements.importInput.files;
  elements.importInput.value = "";
  if (!file) return;
  if (!confirm("导入会替换服务器上的现有内容，确定继续吗？")) return;

  try {
    const imported = JSON.parse(await file.text());
    await state.saveQueue.catch(() => undefined);
    const response = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(imported)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "导入失败");
    state.data = result;
    state.activeDirectoryId = result.directories[0]?.id || null;
    state.activeStreamId = activeDirectory()?.streams[0]?.id || null;
    renderAll();
    elements.saveStatus.textContent = "已保存";
    showToast("备份导入成功");
  } catch (error) {
    console.error(error);
    showToast(`导入失败：${error.message}`);
  }
});

loadData();
