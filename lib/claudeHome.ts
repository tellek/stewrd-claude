/// <reference path="../.stewrd/plugin-api.d.ts" />
// Access layer for files under the real ~/.claude folder, outside this
// plugin's own api.fs sandbox. Uses api.shell.exec (PowerShell) as the
// documented escape hatch for that - see the plugin's README for the
// reasoning behind each design choice here (encoding, staging writes,
// per-path mtime checks, exclusive creates).
import type { PluginApi } from "stewrd-plugin-api";

export interface ReadResult {
  text: string;
  exists: boolean;
  crlf: boolean;
  bom: boolean;
}

export type WriteStatus = "ok" | "conflict" | "exists" | "error";

export interface WriteResult {
  status: WriteStatus;
  message?: string;
}

export interface ClaudeHome {
  readFile(relPath: string): Promise<ReadResult>;
  writeFile(relPath: string, text: string, opts: { crlf: boolean; bom: boolean }): Promise<WriteResult>;
  listDir(relDir: string, kind: "file" | "dir"): Promise<string[]>;
  createFile(relPath: string, text: string): Promise<WriteResult>;
  createSkill(name: string, skillMdText: string): Promise<WriteResult>;
}

const ABSENT = "__ABSENT__";

function decodeBase64ToBinaryString(b64: string): string {
  return atob(b64);
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hasBom(binary: string): boolean {
  return binary.length >= 3 && binary.charCodeAt(0) === 0xef && binary.charCodeAt(1) === 0xbb && binary.charCodeAt(2) === 0xbf;
}

function parseLastJsonLine<T>(stdout: string): T {
  const lines = stdout.trim().split(/\r?\n/);
  const line = lines[lines.length - 1] ?? "";
  return JSON.parse(line) as T;
}

export function createClaudeHome(api: PluginApi): ClaudeHome {
  const queues = new Map<string, Promise<void>>();
  const mtimes = new Map<string, string | null>(); // null = known-absent
  let rootPathPromise: Promise<string> | null = null;
  let stagingCounter = 0;

  function getRootPath(): Promise<string> {
    if (!rootPathPromise) rootPathPromise = api.fs.getRootPath();
    return rootPathPromise;
  }

  function enqueue<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prevTail = queues.get(path) ?? Promise.resolve();
    const run = prevTail.then(fn, fn);
    // Keep the stored tail non-rejecting so one failed write never wedges
    // every later write/readFile for this path.
    queues.set(
      path,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async function execPS(script: string, env: Record<string, string>) {
    return api.shell.exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env,
    });
  }

  async function stageContent(text: string): Promise<{ stagingRelPath: string; absSrc: string }> {
    stagingCounter += 1;
    const stagingRelPath = `staging-${Date.now()}-${stagingCounter}.staged`;
    await api.fs.writeTextFile(stagingRelPath, text);
    const rootPath = await getRootPath();
    const absSrc = `${rootPath}\\${stagingRelPath}`;
    return { stagingRelPath, absSrc };
  }

  async function cleanupStaging(stagingRelPath: string) {
    await api.fs.deleteFile(stagingRelPath).catch(() => {});
  }

  async function readFile(relPath: string): Promise<ReadResult> {
    return enqueue(relPath, async () => {
      const script = `
$ErrorActionPreference = 'Stop'
try {
  $dst = Join-Path $env:USERPROFILE ".claude"
  $dst = Join-Path $dst $env:RELPATH
  if (-not (Test-Path -LiteralPath $dst)) {
    Write-Output (@{ exists = $false } | ConvertTo-Json -Compress)
  } else {
    $bytes = [IO.File]::ReadAllBytes($dst)
    $b64 = [Convert]::ToBase64String($bytes)
    $mtime = (Get-Item -LiteralPath $dst).LastWriteTimeUtc.ToString("o")
    Write-Output (@{ exists = $true; content = $b64; mtime = $mtime } | ConvertTo-Json -Compress)
  }
} catch {
  Write-Output (@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}`;
      const result = await execPS(script, { RELPATH: relPath });
      if (result.code !== 0) throw new Error(result.stderr || `Failed To Read ${relPath}`);
      const parsed = parseLastJsonLine<{ exists: boolean; content?: string; mtime?: string; error?: string }>(result.stdout);
      if (!parsed.exists) {
        mtimes.set(relPath, null);
        return { text: "", exists: false, crlf: false, bom: false };
      }
      const binary = decodeBase64ToBinaryString(parsed.content!);
      const bom = hasBom(binary);
      const bytes = binaryStringToBytes(binary);
      const raw = new TextDecoder("utf-8").decode(bom ? bytes.slice(3) : bytes);
      const crlf = raw.includes("\r\n");
      const text = raw.replace(/\r\n/g, "\n");
      mtimes.set(relPath, parsed.mtime ?? null);
      return { text, exists: true, crlf, bom };
    });
  }

  async function writeFile(relPath: string, text: string, opts: { crlf: boolean; bom: boolean }): Promise<WriteResult> {
    return enqueue(relPath, async () => {
      const finalText = (opts.bom ? "﻿" : "") + (opts.crlf ? text.replace(/\n/g, "\r\n") : text);
      const { stagingRelPath, absSrc } = await stageContent(finalText);
      try {
        const expected = mtimes.has(relPath) ? mtimes.get(relPath) : null;
        const expectedStr = expected === null || expected === undefined ? ABSENT : expected;
        const script = `
$ErrorActionPreference = 'Stop'
try {
  $dst = Join-Path $env:USERPROFILE ".claude"
  $dst = Join-Path $dst $env:RELPATH
  $parent = Split-Path $dst -Parent
  if ($env:EXPECTED -eq '${ABSENT}') {
    if (Test-Path -LiteralPath $dst) {
      Write-Output (@{ status = "conflict" } | ConvertTo-Json -Compress)
    } else {
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      Copy-Item -LiteralPath $env:SRC -Destination $dst -Force
      $mtime = (Get-Item -LiteralPath $dst).LastWriteTimeUtc.ToString("o")
      Write-Output (@{ status = "ok"; mtime = $mtime } | ConvertTo-Json -Compress)
    }
  } else {
    if (-not (Test-Path -LiteralPath $dst)) {
      Write-Output (@{ status = "conflict" } | ConvertTo-Json -Compress)
    } else {
      $current = (Get-Item -LiteralPath $dst).LastWriteTimeUtc.ToString("o")
      if ($current -ne $env:EXPECTED) {
        Write-Output (@{ status = "conflict" } | ConvertTo-Json -Compress)
      } else {
        Copy-Item -LiteralPath $env:SRC -Destination $dst -Force
        $newMtime = (Get-Item -LiteralPath $dst).LastWriteTimeUtc.ToString("o")
        Write-Output (@{ status = "ok"; mtime = $newMtime } | ConvertTo-Json -Compress)
      }
    }
  }
} catch {
  Write-Output (@{ status = "error"; message = $_.Exception.Message } | ConvertTo-Json -Compress)
}`;
        const result = await execPS(script, { RELPATH: relPath, SRC: absSrc, EXPECTED: expectedStr });
        if (result.code !== 0) return { status: "error", message: result.stderr || "Write Failed" };
        const parsed = parseLastJsonLine<{ status: WriteStatus; mtime?: string; message?: string }>(result.stdout);
        if (parsed.status === "ok") mtimes.set(relPath, parsed.mtime ?? null);
        return { status: parsed.status, message: parsed.message };
      } finally {
        await cleanupStaging(stagingRelPath);
      }
    });
  }

  async function listDir(relDir: string, kind: "file" | "dir"): Promise<string[]> {
    const flag = kind === "dir" ? "-Directory" : "-File";
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $dir = Join-Path $env:USERPROFILE ".claude"
  $dir = Join-Path $dir $env:RELPATH
  if (-not (Test-Path -LiteralPath $dir)) {
    Write-Output (@{ entries = @() } | ConvertTo-Json -Compress)
  } else {
    $names = @(Get-ChildItem -LiteralPath $dir -Name ${flag})
    Write-Output (@{ entries = @($names) } | ConvertTo-Json -Compress)
  }
} catch {
  Write-Output (@{ entries = @(); error = $_.Exception.Message } | ConvertTo-Json -Compress)
}`;
    const result = await execPS(script, { RELPATH: relDir });
    if (result.code !== 0) throw new Error(result.stderr || `Failed To List ${relDir}`);
    const parsed = parseLastJsonLine<{ entries: string[] }>(result.stdout);
    return parsed.entries ?? [];
  }

  async function createFile(relPath: string, text: string): Promise<WriteResult> {
    const { stagingRelPath, absSrc } = await stageContent(text);
    try {
      const script = `
$ErrorActionPreference = 'Stop'
$dst = Join-Path $env:USERPROFILE ".claude"
$dst = Join-Path $dst $env:RELPATH
try {
  $parent = Split-Path $dst -Parent
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  New-Item -ItemType File -Path $dst -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $env:SRC -Destination $dst -Force
  Write-Output (@{ status = "ok" } | ConvertTo-Json -Compress)
} catch {
  if (Test-Path -LiteralPath $dst) {
    Write-Output (@{ status = "exists" } | ConvertTo-Json -Compress)
  } else {
    Write-Output (@{ status = "error"; message = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
}`;
      const result = await execPS(script, { RELPATH: relPath, SRC: absSrc });
      if (result.code !== 0) return { status: "error", message: result.stderr || "Create Failed" };
      const parsed = parseLastJsonLine<{ status: WriteStatus; message?: string }>(result.stdout);
      if (parsed.status === "ok") mtimes.delete(relPath); // next open re-reads a fresh mtime
      return parsed;
    } finally {
      await cleanupStaging(stagingRelPath);
    }
  }

  async function createSkill(name: string, skillMdText: string): Promise<WriteResult> {
    const script = `
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE ".claude"
$dir = Join-Path $dir "skills"
$dir = Join-Path $dir $env:NAME
try {
  New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
  Write-Output (@{ status = "ok" } | ConvertTo-Json -Compress)
} catch {
  if (Test-Path -LiteralPath $dir) {
    Write-Output (@{ status = "exists" } | ConvertTo-Json -Compress)
  } else {
    Write-Output (@{ status = "error"; message = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
}`;
    const result = await execPS(script, { NAME: name });
    if (result.code !== 0) return { status: "error", message: result.stderr || "Create Failed" };
    const parsed = parseLastJsonLine<{ status: WriteStatus; message?: string }>(result.stdout);
    if (parsed.status !== "ok") return parsed;
    return createFile(`skills/${name}/SKILL.md`, skillMdText);
  }

  return { readFile, writeFile, listDir, createFile, createSkill };
}
