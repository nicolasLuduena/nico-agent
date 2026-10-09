/** One file of a unified diff, as the Review partner's tab lists it; shared with the app, so nothing here reaches the disk. */
export interface DiffFile {
  /** Its path after the change; the path it had, for a deleted file. */
  path: string;
  /** The path it was renamed from. */
  from?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  /** git shows no lines of a binary file. */
  binary?: true;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` line, with the context git names after it. */
  header: string;
  lines: DiffLine[];
}

/** A line of a hunk, with its number in the old file, the new one, or both. */
export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  old?: number;
  new?: number;
}

/** The files of `git diff`'s output, in its order. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let old = 0;
  let now = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // The header's paths stand until `---`/`+++` or `rename` lines name them exactly.
      const paths = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
      file = { path: paths?.[2] ?? line.slice(11), status: "modified", additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (hunk) {
      const kind = line[0] === "+" ? "add" : line[0] === "-" ? "del" : line[0] === " " ? "context" : null;
      if (kind) {
        const body = line.slice(1);
        if (kind === "add") {
          hunk.lines.push({ kind, text: body, new: now++ });
          file.additions++;
        } else if (kind === "del") {
          hunk.lines.push({ kind, text: body, old: old++ });
          file.deletions++;
        } else {
          hunk.lines.push({ kind, text: body, old: old++, new: now++ });
        }
        continue;
      }
      // `\ No newline at end of file` belongs to the line before it.
      if (line.startsWith("\\")) continue;
    }
    const range = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (range) {
      old = Number(range[1]);
      now = Number(range[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (line.startsWith("new file mode")) {
      file.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
    } else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.from = line.slice(12);
    } else if (line.startsWith("rename to ")) {
      file.path = line.slice(10);
    } else if (line.startsWith("Binary files ")) {
      file.binary = true;
    } else if (line.startsWith("--- a/") && file.status === "deleted") {
      file.path = line.slice(6);
    } else if (line.startsWith("+++ b/")) {
      file.path = line.slice(6);
    }
  }
  return files;
}

/** `3 files, +12 −4`: how big a diff is. */
export function diffSize(files: DiffFile[]) {
  const sum = (count: (f: DiffFile) => number) => files.reduce((n, f) => n + count(f), 0);
  return `${files.length} ${files.length === 1 ? "file" : "files"}, +${sum((f) => f.additions)} −${sum((f) => f.deletions)}`;
}
