// End-to-end test of open-in-vim: a headless Neovim listening on a temporary
// socket, the server pointed at it through VIM_SIGNAL_SOCKET, real HTTP
// requests in, and Neovim asked over its socket what it ended up showing.
//
// Neovim loads FindAndOpenFile from the live config
// (~/.config/nvim/lua/features/find-and-open-file.lua); set
// FIND_AND_OPEN_FILE_LUA to test another checkout.
//
//   bun test

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const feature =
  process.env.FIND_AND_OPEN_FILE_LUA ??
  join(process.env.HOME!, ".config/nvim/lua/features/find-and-open-file.lua");

const dir = mkdtempSync(join(tmpdir(), "open-in-vim-"));
const socket = join(dir, "nvim.sock");
const project = join(dir, "project");
let nvim: Bun.Subprocess;
let server: Bun.Subprocess;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function until(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error("timed out waiting for " + what);
}

function nvimEval(expr: string): string {
  const out = Bun.spawnSync(["nvim", "--server", socket, "--remote-expr", expr]);
  return out.stdout.toString().trim();
}

beforeAll(async () => {
  mkdirSync(join(project, "src/app"), { recursive: true });
  writeFileSync(
    join(project, "src/app/foo.ts"),
    ["one", "two", "three", "four", "five", "    six"].join("\n") + "\n",
  );

  nvim = Bun.spawn(
    ["nvim", "--headless", "--clean", "--listen", socket, "-c", `luafile ${feature}`],
    { cwd: project, stdin: "ignore", stdout: "ignore", stderr: "inherit" },
  );
  await until(async () => existsSync(socket), "Neovim's socket");

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", join(import.meta.dir, "open-in-vim.ts")], {
    env: { ...process.env, VIM_SIGNAL_SOCKET: socket, OPEN_IN_VIM_PORT: String(port) },
    stdout: "ignore",
    stderr: "inherit",
  });
  await until(
    () => fetch(base).then(() => true, () => false),
    "the open-in-vim server",
  );
}, 15_000);

afterAll(() => {
  server?.kill();
  nvim?.kill();
  rmSync(dir, { recursive: true, force: true });
});

test("a request opens the file at the line in Neovim", async () => {
  const res = await fetch(`${base}/?file=app/foo.ts&line=4`);

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("OK");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

  await until(
    async () => nvimEval("expand('%:p')").endsWith("/src/app/foo.ts"),
    "Neovim to open the file",
  );
  expect(nvimEval("line('.')")).toBe("4");
});

test("a request without a file gives a 400", async () => {
  const res = await fetch(`${base}/?line=3`);

  expect(res.status).toBe(400);
});

test("a request can't type commands into Neovim", async () => {
  const marker = join(dir, "pwned");
  const evil = `x\n:!touch ${marker}\n`;
  for (const file of [evil, evil.replaceAll("\n", "\r"), `x\x1b:!touch ${marker}\r`]) {
    await fetch(`${base}/?file=${encodeURIComponent(file)}&line=1`);
  }
  await fetch(`${base}/?file=app/foo.ts&line=1%0A:!touch%20${encodeURIComponent(marker)}%0A`);

  await Bun.sleep(500);
  expect(existsSync(marker)).toBe(false);
});

test("a request still opens a path with spaces", async () => {
  mkdirSync(join(project, "src/my dir"), { recursive: true });
  writeFileSync(join(project, "src/my dir/bar.ts"), "a\nb\nc\n");

  await fetch(`${base}/?file=${encodeURIComponent("my dir/bar.ts")}&line=2`);

  await until(
    async () => nvimEval("expand('%:p')").endsWith("/src/my dir/bar.ts"),
    "Neovim to open the file",
  );
  expect(nvimEval("line('.')")).toBe("2");
});

test("the server only listens on the loopback interface", async () => {
  const port = new URL(base).port;
  const out = Bun.spawnSync(["ss", "-Hltn"]).stdout.toString();
  const addresses = out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[3])
    .filter((a) => a?.endsWith(`:${port}`));
  expect(addresses.length).toBeGreaterThan(0);
  for (const a of addresses) expect(a).toBe(`127.0.0.1:${port}`);
});
