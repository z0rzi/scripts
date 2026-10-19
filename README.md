# scripts

My personal scripts, the ones I use every day when I code. They're written for my own
setup (NixOS, KDE on Wayland, wezterm, tmux, Neovim) and probably need tweaking
anywhere else.

Most of them run with [Bun](https://bun.sh). Run `bun install` once for the dependencies.

| Script | What it does |
| --- | --- |
| `voice-type.ts` | Records the mic, transcribes it with OpenAI Whisper and pastes the text into the focused window |
| `vim-signal.ts` | Opens a file (at a line and column) in the Neovim running in the focused wezterm pane |
| `open-in-vim.ts` | Small HTTP server so the browser's "open in editor" links open in Neovim |
| `markdown.ts` | Live preview of a Markdown file in the browser |
| `explorer.ts` | Two-pane terminal file explorer |
| `codediff` | Git difftool built on `explorer.ts` and Neovim |
| `listfiles.sh` | Lists files in a directory, sorted by date |
| `datesort.ts` | Sorts file paths from stdin by modification date |

`keyboard.ts`, `InputField.ts`, `icons2.ts` and `shell.ts` are helpers the other
scripts import.
