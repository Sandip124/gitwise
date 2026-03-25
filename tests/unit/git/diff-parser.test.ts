import { describe, it, expect } from "vitest";
import { parseDiff } from "../../../src/git/diff-parser.js";

describe("parseDiff", () => {
  it("parses a simple file modification diff", () => {
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -5,3 +5,4 @@ function helper() {
   const x = 1;
   const y = 2;
+  const z = 3;
   return x + y;
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].oldPath).toBe("src/utils.ts");
    expect(files[0].newPath).toBe("src/utils.ts");
    expect(files[0].isNew).toBe(false);
    expect(files[0].isDeleted).toBe(false);
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].newStart).toBe(5);
    expect(files[0].hunks[0].newCount).toBe(4);
  });

  it("parses a new file diff", () => {
    const diff = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return "world";
+}
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].isNew).toBe(true);
    expect(files[0].newPath).toBe("src/new-file.ts");
    expect(files[0].hunks[0].lines.filter((l) => l.type === "add")).toHaveLength(3);
  });

  it("parses a deleted file diff", () => {
    const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return "gone";
-}
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].isDeleted).toBe(true);
  });

  it("parses multiple files in one diff", () => {
    const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 const x = 10;
+const y = 20;
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].newPath).toBe("file1.ts");
    expect(files[1].newPath).toBe("file2.ts");
  });

  it("parses multiple hunks in one file", () => {
    const diff = `diff --git a/src/big.ts b/src/big.ts
--- a/src/big.ts
+++ b/src/big.ts
@@ -5,3 +5,4 @@ function first() {
   const x = 1;
+  const y = 2;
   return x;
@@ -20,3 +21,4 @@ function second() {
   const a = 10;
+  const b = 20;
   return a;
`;

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[0].newStart).toBe(5);
    expect(files[0].hunks[1].newStart).toBe(21);
  });

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });
});
