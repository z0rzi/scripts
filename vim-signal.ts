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

export async function sendSignal(file: string, line = 1, col = 1): Promise<boolean> {
  if (!Number.isInteger(line) || line < 1) line = 1;
  if (!Number.isInteger(col) || col < 1) col = 1;

  const target = findTarget();
  if (!target) {
    console.error("No Neovim found in the focused wezterm pane");
    return false;
  }

  const path = file.replaceAll("<", "<lt>");
  const column = col > 1 ? `0${col - 1}l` : "0";
  run([
    "nvim",
    "--server",
    target.socket,
    "--remote-send",
    `<C-\\><C-n>:FindAndOpenFile ${path} ${line}<CR>${column}zz`,
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
