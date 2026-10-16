#!/usr/bin/env bun
// Opens a file (at a line and column) in the Neovim running in the focused
// wezterm pane, through Neovim's own server socket, then focuses that pane.
//
//   vim-signal <file>[:line[:col]]
//
// The file can be the end of a path: Neovim's :FindAndOpenFile looks it up.
// VIM_SIGNAL_SOCKET=<socket> sends to that Neovim instead and skips wezterm.

import { existsSync } from "node:fs";

type Target = { socket: string; paneId?: number };

function run(cmd: string[]): string {
  const out = Bun.spawnSync(cmd, { stderr: "pipe" });
  if (!out.success) {
    throw new Error(`${cmd.join(" ")} failed: ${out.stderr.toString().trim()}`);
  }
  return out.stdout.toString();
}

// Terminals a Neovim in this wezterm pane could be attached to: the pane's own
// tty and, when the pane runs a tmux client, that client's active tmux pane.
function paneTtys(paneTty: string): string[] {
  const ttys = [paneTty];
  try {
    for (const line of run(["tmux", "list-clients", "-F", "#{client_tty} #{pane_tty}"]).split("\n")) {
      const [client, pane] = line.split(" ");
      if (client === paneTty && pane) ttys.push(pane);
    }
  } catch {
    // No tmux server running.
  }
  return ttys;
}

function findTarget(): Target | null {
  const env = process.env.VIM_SIGNAL_SOCKET;
  if (env) return { socket: env };

  const [client] = JSON.parse(run(["wezterm", "cli", "list-clients", "--format", "json"]));
  const panes: { pane_id: number; tty_name: string }[] = JSON.parse(
    run(["wezterm", "cli", "list", "--format", "json"]),
  );
  const pane = panes.find((p) => p.pane_id === client?.focused_pane_id);
  if (!pane) return null;

  const ttys = paneTtys(pane.tty_name);
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;
  // Not run(): ps exits 1 when no nvim is running.
  const nvims = Bun.spawnSync(["ps", "-C", "nvim", "-o", "pid=,tty="]).stdout.toString();
  for (const line of nvims.split("\n")) {
    const [pid, tty] = line.trim().split(/\s+/);
    const socket = `${runtimeDir}/nvim.${pid}.0`;
    // The TUI process and its embedded server share the tty; only the server has a socket.
    if (pid && ttys.includes(`/dev/${tty}`) && existsSync(socket)) {
      return { socket, paneId: pane.pane_id };
    }
  }
  return null;
}

// Control characters (newline, CR, ESC...) have no business in a path and
// could act as keys in Neovim.
export function isSafePath(file: string): boolean {
  return file !== "" && !/[\x00-\x1f\x7f]/.test(file);
}

// The file and position travel as data in an expression (a quoted string and
// numbers), never as typed keys, so nothing in them can run as a command.
const openLua = `(function(file, line, col)
  vim.cmd.FindAndOpenFile({ args = { file, tostring(line) } })
  if col > 1 then
    vim.api.nvim_win_set_cursor(0, { vim.fn.line("."), col - 1 })
  end
  vim.cmd("normal! zz")
  return 0
end)(unpack(_A))`;

function vimString(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

export async function sendSignal(file: string, line = 1, col = 1): Promise<boolean> {
  if (!isSafePath(file)) throw new Error(`Refusing unsafe path: ${JSON.stringify(file)}`);
  if (!Number.isInteger(line) || line < 1) line = 1;
  if (!Number.isInteger(col) || col < 1) col = 1;

  const target = findTarget();
  if (!target) {
    console.error("No Neovim found in the focused wezterm pane");
    return false;
  }

  // Leave insert/visual/command-line mode first (fixed keys, nothing from the caller).
  run(["nvim", "--server", target.socket, "--remote-send", "<C-\\><C-n>"]);
  run([
    "nvim",
    "--server",
    target.socket,
    "--remote-expr",
    `luaeval(${vimString(openLua)}, [${vimString(file)}, ${line}, ${col}])`,
  ]);

  if (target.paneId !== undefined) {
    run(["wezterm", "cli", "activate-pane", "--pane-id", String(target.paneId)]);
  }
  return true;
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: vim-signal <file>[:line[:col]]");
    process.exit(1);
  }
  const [file, line, col] = arg.split(":");
  process.exit((await sendSignal(file, Number(line), Number(col))) ? 0 : 1);
}
