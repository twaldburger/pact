import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A test file's scratch: one temporary root for the whole file, removed when
// its tests finish, so a run leaves nothing behind in the system temp
// directory and a crashed one leaves a single directory rather than one per
// case. Each call hands out a fresh subdirectory inside that root, which keeps
// every case's own empty directory and its isolation, and keeps the cleanup one
// call per file.
//
// It sits beside test/ rather than in it because node --test runs every file
// under a directory named test as a test file of its own.
export function scratch(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pact-" + label + "-"));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  return function () {
    return fs.mkdtempSync(path.join(root, "case-"));
  };
}
