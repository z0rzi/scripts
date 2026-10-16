#!/usr/bin/env bun
// HTTP server for the browser's "open in editor": GET /?file=<path>&line=<n>
// opens the file in Neovim through vim-signal. Port 63342 unless
// OPEN_IN_VIM_PORT says otherwise (for tests).

import { sendSignal } from "./vim-signal";

const port = Number(process.env.OPEN_IN_VIM_PORT ?? 63342);
const headers = { "Access-Control-Allow-Origin": "*" };

Bun.serve({
  port,
  async fetch(req) {
    const query = new URL(req.url).searchParams;
    const file = query.get("file");
    if (!file) return new Response("Missing file", { status: 400, headers });

    try {
      await sendSignal(file, Number(query.get("line") ?? 1));
    } catch (err) {
      console.error(err);
    }
    return new Response("OK", { headers });
  },
});

console.log(`open-in-vim listening on http://localhost:${port}`);
