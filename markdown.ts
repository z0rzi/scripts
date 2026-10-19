#!/usr/bin/env bun

import { $ } from "bun";
import fs from "fs";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import http from "http";
import path from "path";

const CURSOR_MARKER = "<!-- @cursor@ -->";

const md = new MarkdownIt({
  html: true,
  // breaks: true, // Convert '\n' in paragraphs into <br>
  linkify: true, // Autoconvert URL-like text to links
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }

    return ""; // use external default escaping
  },
});

// ```mermaid fences become <pre class="mermaid"> blocks rendered client-side
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim().split(/\s+/)[0] !== "mermaid") {
    return defaultFence(tokens, idx, options, env, self);
  }
  // The cursor marker must not end up inside the diagram source
  let content = token.content;
  let marker = "";
  if (content.includes(CURSOR_MARKER)) {
    content = content.replace(CURSOR_MARKER, "");
    marker = CURSOR_MARKER;
  }
  return `<pre class="mermaid">${md.utils.escapeHtml(content)}</pre>${marker}\n`;
};

const MERMAID_PATH = path.join(
  import.meta.dir,
  "node_modules/mermaid/dist/mermaid.min.js"
);

const markdownFile = path.resolve(process.argv[2]);

const css = `
html {
    height: 100%;
}
html, body {
    font-family: sans;
    color: #000000bf;
    background: #f3f3f3;
    line-height: 1.67;
    tab-size: 4;
    text-rendering: auto;
}
body {
    padding: 50px;
    max-width: 800px;
    margin: auto;
}
h1 {
    font-size: 2em;
    margin: 0.67em 0;
}
h1, h2, h3, h4, h5, h6 {
    margin: 1.8em 0;
    line-height: 1.33;
}
h1:after, h2:after {
    content: "";
    display: block;
    position: relative;
    top: 0.33em;
    border-bottom: 1px solid #8080805477;
}
blockquote, dl, ol, p, pre, ul {
    margin: 1.2em 0;
}
body > *:first-child {
    margin-top: 0;
}
code {
    background-color: #0000000d;
    border-radius: 3px;
    padding: 2px 4px;
}
pre>code {
    background-color: #0000000d;
    display: block;
    padding: 0.5em;
    -webkit-text-size-adjust: none;
    overflow-x: auto;
    white-space: pre;
}
code, pre, samp {
    font-family: Roboto Mono,Lucida Sans Typewriter,Lucida Console,monaco,Courrier,monospace;
    font-size: .85em;
}
pre.mermaid {
    display: flex;
    justify-content: center;
    background: transparent;
}
a {
    color: #0c93e4;
    text-decoration: underline;
    text-decoration-skip: ink;
}
.hljs{color:#24292e;background:#fff}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#005cc5}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#032f62}.hljs-built_in,.hljs-symbol{color:#e36209}.hljs-code,.hljs-comment,.hljs-formula{color:#6a737d}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#22863a}.hljs-subst{color:#24292e}.hljs-section{color:#005cc5;font-weight:700}.hljs-bullet{color:#735c0f}.hljs-emphasis{color:#24292e;font-style:italic}.hljs-strong{color:#24292e;font-weight:700}.hljs-addition{color:#22863a;background-color:#f0fff4}.hljs-deletion{color:#b31d28;background-color:#ffeef0}
`;

const js = `
function testReload() {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", "/should-reload")
    xhr.send()

    xhr.onload = function() {
        if (xhr.status !== 200) return; 
        if (xhr.responseText === 'true')
            window.location.reload(true)
    }

    xhr.onerror = function() {
      console.log("Network error occurred")
    }
}
function scrollToFocus() {
    const element = document.querySelector('#focus-me');
    if (!element) return;
    console.log('scrolling to ', element);
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });
}
setInterval(() => {
    testReload();
}, 500);
setTimeout(() => {
    scrollToFocus();
}, 100);
`;

let html = "";
let shouldReload = false;
let currentMdLine = 0;
let splittedMd = [] as string[];

let lastMdContent = [] as string[];
let lastMtime = fs.statSync(markdownFile).mtime;
let debounceId: null | Timer = null;

const serv = http.createServer(function (
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const url = req.url!;
  if (url === "/should-reload") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(shouldReload));
    shouldReload = false;
  } else if (url === "/mermaid.min.js") {
    res.setHeader("content-type", "application/javascript");
    fs.createReadStream(MERMAID_PATH).pipe(res);
  } else if (/.png$/.test(url)) {
    let assetPath = url;
    if (!fs.existsSync(assetPath)) {
      assetPath = path.join(path.dirname(markdownFile), assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      return;
    }
    // absolute path
    let file: null | fs.ReadStream = null;
    file = fs.createReadStream(assetPath);
    res.setHeader("content-type", "image/png");
    file.pipe(res);
  } else {
    res.setHeader("content-type", "text/html");
    res.end(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width">
                            <title>${path.basename(markdownFile)}</title>
                            <link rel="canonical" href="https://nodejs.org/api/http.html">
                            <style>${css}</style>
                            <script>${js}</script>
                            <script src="/mermaid.min.js"></script>
                            <script>mermaid.initialize({ startOnLoad: true, theme: "neutral" });</script>
                        </head>
                        <body>${html}</body>
                    </html>
                `);
  }
});

render();

const port = await listen(serv, Number(process.env["PORT"]) || 8080);

setInterval(() => {
  const stats = fs.statSync(markdownFile);
  const mtime = stats.mtime;
  if (+mtime === +lastMtime) return;

  lastMtime = mtime;
  if (debounceId) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    try {
      render();
      shouldReload = true;
    } catch (err) {
      console.log(err);
    }
  }, 100);
}, 100);

console.log(`🚀 Server started on http://localhost:${port}`);
await $`xdg-open http://localhost:${port}`;

/** Listens on `startPort`, falling back to the next ports when they are taken. */
async function listen(server: http.Server, startPort: number, tries = 20) {
  for (let port = startPort; port < startPort + tries; port++) {
    const listening = await new Promise<boolean>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE") return resolve(false);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    });

    if (listening) return port;
    console.log(`⚠️  Port ${port} is already taken, trying ${port + 1}`);
  }

  throw new Error(
    `No free port found between ${startPort} and ${startPort + tries - 1}`
  );
}

function render() {
  let markdownContent = fs.readFileSync(markdownFile, { encoding: "utf8" });

  // finding on which line the change happened
  splittedMd = markdownContent.split(/\n/g);
  const lineNr = splittedMd.findIndex(
    (lineContent, lineIdx) => lineContent !== lastMdContent[lineIdx]
  );
  lastMdContent = splittedMd;

  if (lineNr > 0) currentMdLine = lineNr;

  if (currentMdLine > 0) {
    const lineSave = splittedMd[currentMdLine];

    let line = splittedMd[currentMdLine];

    splittedMd[currentMdLine] = line + CURSOR_MARKER;
    markdownContent = splittedMd.join("\n");
    splittedMd[currentMdLine] = lineSave;
  }

  html = md.render(markdownContent);

  const splittedHtml = html.split("\n");
  const currentLine = splittedHtml.findIndex((line) =>
    line.includes(CURSOR_MARKER)
  );
  if (currentLine >= 0) {
    let line = splittedHtml[currentLine].replace(CURSOR_MARKER, "");
    splittedHtml[currentLine] =
      line +
      '<span id="focus-me" style="position: absolute; visibility: none"></span>';
  }

  html = splittedHtml.join("\n");
}
