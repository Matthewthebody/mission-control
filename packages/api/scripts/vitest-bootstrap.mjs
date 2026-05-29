import { EventEmitter } from "node:events";
import { syncBuiltinESMExports, createRequire } from "node:module";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalExec = childProcess.exec;

function createNoopChildProcess() {
  const child = new EventEmitter();
  child.pid = 0;
  child.stdin = null;
  child.stdout = null;
  child.stderr = null;
  child.kill = () => true;
  return child;
}

childProcess.exec = function patchedExec(command, ...args) {
  if (process.platform === "win32" && command === "net use") {
    const callback = typeof args.at(-1) === "function" ? args.at(-1) : undefined;
    if (callback) {
      queueMicrotask(() => callback(new Error("Disabled during local vitest bootstrap"), "", ""));
    }
    return createNoopChildProcess();
  }
  return originalExec.call(this, command, ...args);
};

syncBuiltinESMExports();
