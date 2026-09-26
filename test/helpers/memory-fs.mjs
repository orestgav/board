// Тека в пам'яті з тим самим інтерфейсом, що FileSystemDirectoryHandle у
// браузері: рівно те, чим користується storage.js у режимі папки.

function notFound(name) {
  return new DOMException(`${name} не знайдено`, "NotFoundError");
}

class MemoryFile {
  constructor(name, contents = "") {
    this.kind = "file";
    this.name = name;
    this.blob = new Blob([contents]);
    this.writes = 0;
  }

  async getFile() {
    return new File([this.blob], this.name);
  }

  async createWritable() {
    const chunks = [];
    return {
      write: async (contents) => { chunks.push(contents); },
      close: async () => {
        this.blob = new Blob(chunks);
        this.writes += 1;
      },
    };
  }

  async isSameEntry(other) { return other === this; }
}

export class MemoryDirectory {
  constructor(name = "campaign") {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
    this.permission = "granted";
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing?.kind === "directory") return existing;
    if (existing || !create) throw notFound(name);
    const directory = new MemoryDirectory(name);
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing;
    if (existing || !create) throw notFound(name);
    const file = new MemoryFile(name);
    this.children.set(name, file);
    return file;
  }

  async *entries() {
    yield* [...this.children];
  }

  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async isSameEntry(other) { return other === this; }

  // Для тестів: покласти файл за шляхом і прочитати його назад.
  async put(path, contents) {
    const parts = path.split("/");
    const name = parts.pop();
    let directory = this;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
    const file = await directory.getFileHandle(name, { create: true });
    file.blob = new Blob([contents]);
    return file;
  }

  async file(path) {
    const parts = path.split("/");
    const name = parts.pop();
    let directory = this;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    return directory.getFileHandle(name);
  }

  async read(path) {
    return (await (await this.file(path)).getFile()).text();
  }

  async exists(path) {
    try { await this.file(path); return true; } catch { return false; }
  }
}
