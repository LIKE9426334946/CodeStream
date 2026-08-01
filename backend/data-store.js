const fs = require("node:fs/promises");
const path = require("node:path");

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new ValidationError(message);
  }
}

function validateText(value, field, { min = 0, max = 100_000 } = {}) {
  assert(typeof value === "string", `${field} 必须是字符串`);
  assert(value.length >= min, `${field} 不能为空`);
  assert(value.length <= max, `${field} 不能超过 ${max} 个字符`);
}

function validateData(data) {
  assert(data && typeof data === "object" && !Array.isArray(data), "数据格式无效");
  assert(data.schemaVersion === 1, "不支持的数据版本");
  assert(Array.isArray(data.directories), "directories 必须是数组");
  assert(data.directories.length <= 100, "目录数量不能超过 100 个");

  const ids = new Set();
  const claimId = (id, field) => {
    validateText(id, field, { min: 1, max: 80 });
    assert(!ids.has(id), `${field} 不能重复`);
    ids.add(id);
  };

  data.directories.forEach((directory, directoryIndex) => {
    const base = `directories[${directoryIndex}]`;
    assert(directory && typeof directory === "object" && !Array.isArray(directory), `${base} 格式无效`);
    claimId(directory.id, `${base}.id`);
    validateText(directory.name, `${base}.name`, { min: 1, max: 40 });
    validateText(directory.description ?? "", `${base}.description`, { max: 160 });
    assert(Array.isArray(directory.streams), `${base}.streams 必须是数组`);
    assert(directory.streams.length <= 500, `${base}.streams 不能超过 500 个`);

    directory.streams.forEach((stream, streamIndex) => {
      const streamBase = `${base}.streams[${streamIndex}]`;
      assert(stream && typeof stream === "object" && !Array.isArray(stream), `${streamBase} 格式无效`);
      claimId(stream.id, `${streamBase}.id`);
      validateText(stream.name, `${streamBase}.name`, { min: 1, max: 80 });
      validateText(stream.description ?? "", `${streamBase}.description`, { max: 300 });
      assert(Array.isArray(stream.blocks), `${streamBase}.blocks 必须是数组`);
      assert(stream.blocks.length <= 500, `${streamBase}.blocks 不能超过 500 个`);

      stream.blocks.forEach((block, blockIndex) => {
        const blockBase = `${streamBase}.blocks[${blockIndex}]`;
        assert(block && typeof block === "object" && !Array.isArray(block), `${blockBase} 格式无效`);
        claimId(block.id, `${blockBase}.id`);
        assert(block.type === "code" || block.type === "note", `${blockBase}.type 只能是 code 或 note`);
        validateText(block.content, `${blockBase}.content`, { min: 1, max: 100_000 });
        validateText(block.language ?? "", `${blockBase}.language`, { max: 30 });
      });
    });
  });

  return data;
}

class JsonStore {
  constructor({ dataFile, seedFile }) {
    this.dataFile = dataFile;
    this.seedFile = seedFile;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });

    try {
      await fs.access(this.dataFile);
    } catch {
      await fs.copyFile(this.seedFile, this.dataFile);
    }

    return this.read();
  }

  async read() {
    const raw = await fs.readFile(this.dataFile, "utf8");
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      const error = new Error("JSON 数据文件无法解析，请检查 data/content.json");
      error.status = 500;
      throw error;
    }

    return validateData(data);
  }

  async write(nextData) {
    const data = JSON.parse(JSON.stringify(nextData));
    data.schemaVersion = 1;
    data.updatedAt = new Date().toISOString();
    validateData(data);

    const writeOperation = async () => {
      const temporaryFile = `${this.dataFile}.tmp`;
      const backupFile = `${this.dataFile}.backup`;

      try {
        await fs.copyFile(this.dataFile, backupFile);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      await fs.writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await fs.rename(temporaryFile, this.dataFile);
      return data;
    };

    this.writeQueue = this.writeQueue.catch(() => undefined).then(writeOperation);
    return this.writeQueue;
  }
}

module.exports = {
  JsonStore,
  ValidationError,
  validateData
};
