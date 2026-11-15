import fs from "node:fs";
import path from "node:path";

export class FileStorage {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.tempCounter = 0;
  }

  pathFor(key) {
    const filename = Buffer.from(key, "utf8").toString("base64url");
    return path.join(this.root, `${filename}.snapshot`);
  }

  getItem(key) {
    try {
      return fs.readFileSync(this.pathFor(key), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  setItem(key, value) {
    const target = this.pathFor(key);
    const temporary = `${target}.tmp-${process.pid}-${this.tempCounter++}`;
    fs.writeFileSync(temporary, String(value), "utf8");
    fs.renameSync(temporary, target);
  }

  removeItem(key) {
    try {
      fs.unlinkSync(this.pathFor(key));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  snapshotFiles() {
    return fs
      .readdirSync(this.root)
      .filter((name) => name.endsWith(".snapshot"))
      .map((name) => path.join(this.root, name));
  }
}
