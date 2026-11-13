#!/usr/bin/env bun

// Launcher for a small floating terminal: runs a program from $PATH, opens a
// bookmark (with a search term) or a URL, searches the web, or copies the
// result of a calculation. `?` shows the keys.

import { sleep } from "bun";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { InputField, promptConfirm, promptText } from "./InputField";
import { Key } from "./keyboard";

const SUGGESTION_LIMIT = 10;

const WEB_SEARCH_URL = "https://www.google.com/search?q=%s";

const BROWSER_PATH = "/run/current-system/sw/bin/brave";

const HOME = os.homedir();

const BOOKMARKS_PATH = path.join(HOME, ".config", "omnibar-bookmarks.txt");
const HISTORY_PATH = path.join(HOME, ".config", "omnibar-history.txt");

await ensureFileExists(BOOKMARKS_PATH);
await ensureFileExists(HISTORY_PATH);

enum SearchType {
  /** The user typed a URL */
  URL,
  /** The user typed a calculation */
  CALCULATOR,
  OTHER,
}

enum SearchResult {
  URL,
  COMMAND,
  BOOKMARK,
  WEB_SEARCH,
  CALCULATOR,
}

type ParsedCalculation = {
  mode: SearchResult.CALCULATOR;
  equation: string;
  result: string;
};

type ParsedUrl = {
  mode: SearchResult.URL;
  url: string;
};

type ParsedBookmark = {
  mode: SearchResult.BOOKMARK;
  name: string;
  url: string;
  searchUrl: string;
  searchTerm: string;
};

type ParsedCommand = {
  mode: SearchResult.COMMAND;
  command: string;
  args: string;
};

type ParsedWebSearch = {
  mode: SearchResult.WEB_SEARCH;
  searchTerm: string;
};

type ComputedResult =
  | ParsedCalculation
  | ParsedUrl
  | ParsedBookmark
  | ParsedCommand
  | ParsedWebSearch;

enum SuggestionType {
  COMMAND,
  BOOKMARK,
}

type BookmarkSuggestion = {
  type: SuggestionType.BOOKMARK;
  label: string;
  alias?: string;
  url: string;
  searchUrl?: string;
};

type CommandSuggestion = {
  type: SuggestionType.COMMAND;
  label: string;
};

type Suggestion = BookmarkSuggestion | CommandSuggestion;

async function ensureFileExists(path: string) {
  if (!(await fs.exists(path))) {
    await fs.writeFile(path, "", { flag: "a" });
  }
}

function stringifyBookmark(b: Omit<BookmarkSuggestion, "type">) {
  return `${b.label}\t${b.url}\t${b.searchUrl ?? ""}\t${b.alias ?? ""}`;
}
function parseBookmark(line: string): BookmarkSuggestion | null {
  const items = line.split("\t");
  if (items.length < 2) return null;

  let name: string, url: string, searchUrl: string | undefined, alias: string;

  if (items.length === 3) {
    // Old format, without searchUrl
    [name, url, alias] = items;
  } else {
    [name, url, searchUrl, alias] = items;
  }
  if (!name?.trim() || !url?.trim()) return null;

  return {
    type: SuggestionType.BOOKMARK,
    label: name.trim(),
    alias,
    url,
    searchUrl,
  };
}

async function getAllPrograms(): Promise<CommandSuggestion[]> {
  const systemPath = process.env.PATH ?? "";
  let paths = systemPath.split(":");
  paths.sort();
  paths = paths.filter((p, i, arr) => arr.indexOf(p) === i);

  const allPrograms: string[] = [];
  for (const dir of paths) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        if (file.isFile() || file.isSymbolicLink()) {
          allPrograms.push(file.name);
        }
      }
    } catch (err) {
      continue;
    }
  }

  return allPrograms.map((p) => ({
    type: SuggestionType.COMMAND,
    label: p,
  }));
}

async function getAllBookmarks(): Promise<BookmarkSuggestion[]> {
  const rawBookmarks = await fs.readFile(BOOKMARKS_PATH, { encoding: "utf8" });
  let bookmarks: BookmarkSuggestion[] = [];

  for (const line of rawBookmarks.split("\n")) {
    const bookmark = parseBookmark(line);
    if (bookmark) bookmarks.push(bookmark);
  }

  return bookmarks;
}

async function getHistory(): Promise<string[]> {
  const rawHistory = await fs.readFile(HISTORY_PATH, { encoding: "utf8" });
  return rawHistory
    .split("\n")
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Not with $: wl-copy forks a child that serves the clipboard and keeps the
 * output pipes open, so $ would wait until something else takes the clipboard.
 */
async function copy(text: string) {
  await Bun.spawn(["wl-copy", "--", text], { stdio: ["ignore", "ignore", "ignore"] }).exited;
}

async function addUsageToHistory(cmd: string) {
  const history = await getHistory();

  const idx = history.indexOf(cmd);
  if (idx >= 0) {
    // entry already exists, we remove it
    history.splice(idx, 1);
  }

  history.unshift(cmd);

  await fs.writeFile(HISTORY_PATH, history.slice(0, 100).join("\n"), {
    flag: "w",
  });
}

async function addBookmark(
  name: string,
  url: string,
  searchUrl?: string,
  alias?: string
) {
  // We check if the bookmark already exists
  const bookmarks = await getAllBookmarks();
  if (bookmarks.find((b) => b.label === name)) {
    throw new Error("Bookmark already exists!");
  }

  const str = stringifyBookmark({
    label: name,
    url,
    searchUrl,
    alias,
  });

  await fs.appendFile(BOOKMARKS_PATH, '\n' + str, { flag: "a" });
}

async function removeBookmark(name: string, url: string) {
  const bookmarks = await getAllBookmarks();
  const idx = bookmarks.findIndex((b) => b.label === name && b.url === url);
  if (idx !== -1) {
    bookmarks.splice(idx, 1);
    await fs.writeFile(
      BOOKMARKS_PATH,
      bookmarks.map((b) => stringifyBookmark(b)).join("\n"),
      { flag: "w" }
    );
  }
}

async function updateBookmark(
  old: { name: string; url: string },
  updated: { name?: string; url?: string; searchUrl?: string, alias?: string }
) {
  const bookmarks = await getAllBookmarks();
  const idx = bookmarks.findIndex(
    (b) => b.label === old.name && b.url === old.url
  );
  if (idx !== -1) {
    // name and url can't be emptied, they are what identifies a bookmark
    if (updated.name) bookmarks[idx].label = updated.name;
    if (updated.url) bookmarks[idx].url = updated.url;
    // searchUrl and alias can be cleared by passing an empty string
    if (updated.searchUrl !== undefined)
      bookmarks[idx].searchUrl = updated.searchUrl;
    if (updated.alias !== undefined) bookmarks[idx].alias = updated.alias;
    await fs.writeFile(
      BOOKMARKS_PATH,
      bookmarks.map((b) => stringifyBookmark(b)).join("\n"),
      { flag: "w" }
    );
  }
}

class Omnibar extends InputField {
  /** idx of the selected suggestion */
  cursor = 0;

  private allSuggestions: Suggestion[] = [];
  private filteredSuggestions: Suggestion[] = [];

  constructor() {
    super("> ", () => {
      this.handleReturn();
    });

    this.buildSuggestions().then(() => {
      this.computeSearchResult();
      this.draw();
    });
  }

  async buildSuggestions() {
    const programs = await getAllPrograms();
    const bookmarks = await getAllBookmarks();

    // We sort the suggestions by the history
    const history = await getHistory();

    this.allSuggestions = [];
    for (let i = 0; i < history.length; i++) {
      const cmd = history[i];

      // Looking for the command in the programs
      const programIdx = programs.findIndex((s) => s.label === cmd);
      if (programIdx !== -1) {
        this.allSuggestions.push(programs[programIdx]);
        programs.splice(programIdx, 1);
        continue;
      }

      // Looking for the command in the bookmarks
      const bookmarkIdx = bookmarks.findIndex((s) => s.label === cmd);
      if (bookmarkIdx !== -1) {
        this.allSuggestions.push(bookmarks[bookmarkIdx]);
        bookmarks.splice(bookmarkIdx, 1);
        continue;
      }
    }

    // Putting the rest of the programs and bookmarks at the end
    this.allSuggestions.push(...programs);
    this.allSuggestions.push(...bookmarks);

    this.filteredSuggestions = this.allSuggestions;
    await this.refreshSuggestions();
  }

  up() {
    if (this.cursor > 0) this.cursor--;
  }
  down() {
    if (this.cursor < this.filteredSuggestions.length - 1) this.cursor++;
  }

  protected handleKey(evt: Key) {
    if (
      (evt.ctrl && (evt.key === "c" || evt.key === "d")) ||
      evt.key === "escape"
    ) {
      process.exit(1);
    }

    if (evt.ctrl) {
      if (evt.key === "b") return this.interactiveAddBookmark();
      if (evt.key === "r") return this.interactiveRenameBookmark();
      if (evt.key === "t") return this.interactiveChangeBookmarkUrl();
      if (evt.key === "delete") return this.interactiveDeleteBookmark();
      if (evt.key === "j") this.down();
      if (evt.key === "k") this.up();
    } else if (evt.key.length > 1) {
      if (evt.key === "up") this.up();
      if (evt.key === "down") this.down();
      if (evt.key === "tab") {
        const currentSuggestion = this.filteredSuggestions[this.cursor];
        if (currentSuggestion) {
          this.input = currentSuggestion.label;
          this.carret = this.input.length;
        }
      }
    } else {
      this.cursor = 0;
    }

    if (!this.input.length && evt.key === "?") {
      return this.showHelp();
    }

    super.handleKey(evt);
  }

  protected async onKeyHit(evt: Key) {
    const inputBefore = this.input;
    this.handleKey(evt);

    if (inputBefore !== this.input) {
      this.parseSearch();
      await this.refreshSuggestions();
    }
    this.computeSearchResult();
    this.draw();
  }

  private runCommand(cmd: string, args: string[] = []) {
    const subprocess = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });

    subprocess.unref();
  }

  private async handleReturn() {
    this.destroy();

    if (!this.computedSearchResult) {
      this.draw();
      return;
    }

    const r = this.computedSearchResult;
    if (r.mode === SearchResult.WEB_SEARCH) {
      this.runCommand(BROWSER_PATH, [
        WEB_SEARCH_URL.replace("%s", r.searchTerm),
      ]);
    } else if (r.mode === SearchResult.BOOKMARK) {
      let url = r.url;
      if (r.searchUrl && r.searchTerm) {
        url = r.searchUrl.replace("%s", r.searchTerm);
      }
      this.runCommand(BROWSER_PATH, [url]);
      addUsageToHistory(r.name);
    } else if (r.mode === SearchResult.COMMAND) {
      this.runCommand("bash", [
        "-c",
        r.command + " " + r.args.replace(/"/g, '\\"'),
      ]);
      addUsageToHistory(r.command);
    } else if (r.mode === SearchResult.CALCULATOR) {
      await copy(String(r.result));
    } else if (r.mode === SearchResult.URL) {
      this.runCommand(BROWSER_PATH, [r.url]);
    }
  }

  private parsedSearch = {
    mode: SearchType.OTHER,
    cleanInput: "",
  };

  private computedSearchResult: ComputedResult | undefined;

  /**
   * Looks at what the user typed, and decides if we should show suggestions or not
   */
  private parseSearch(): void {
    let input = this.input.trim();

    if (
      input.startsWith("localhost:") ||
      input.startsWith("192.168.") ||
      input.startsWith("127.0.0.1")
    ) {
      this.parsedSearch = {
        mode: SearchType.URL,
        cleanInput: "http://" + input,
      };
      return;
    }

    if (/^https?:\/\//.test(input)) {
      this.parsedSearch = {
        mode: SearchType.URL,
        cleanInput: input,
      };
      return;
    }

    // If it starts with a number or a '=', we assume it's a calculator
    if (input.startsWith("=") || this.isInputCalculation()) {
      if (input.startsWith("=")) {
        // '=' means "evaluate this JS", so we leave it untouched
        input = input.slice(1);
      } else {
        // '1,5' is a decimal number, not the JS comma operator
        input = input.replace(/,/g, ".");
      }

      this.parsedSearch = {
        mode: SearchType.CALCULATOR,
        cleanInput: input,
      };
      return;
    }

    this.parsedSearch = {
      mode: SearchType.OTHER,
      cleanInput: input,
    };
  }

  /**
   * Looks at `this.parsedSearch` and `this.filteredSuggestions` to decide what to do
   */
  private computeSearchResult(): void {
    if (this.parsedSearch.mode === SearchType.URL) {
      this.computedSearchResult = {
        mode: SearchResult.URL,
        url: this.parsedSearch.cleanInput,
      };
      return;
    }

    if (this.parsedSearch.mode === SearchType.CALCULATOR) {
      let result = "";
      try {
        result = eval(this.parsedSearch.cleanInput);
      } catch (err) {
        result = "error";
      }

      this.computedSearchResult = {
        mode: SearchResult.CALCULATOR,
        equation: this.parsedSearch.cleanInput,
        result,
      };
      return;
    }

    const input = this.parsedSearch.cleanInput;
    const firstSpace = input.indexOf(" ");
    const firstWord = firstSpace === -1 ? input : input.slice(0, firstSpace);
    const afterFirstWord = firstSpace === -1 ? "" : input.slice(firstSpace + 1);

    // If we match a suggestion
    const currentSuggestion = this.filteredSuggestions[this.cursor];

    if (currentSuggestion) {
      // If the suggestion is a command, we assume it's a command
      if (currentSuggestion.type === SuggestionType.COMMAND) {
        this.computedSearchResult = {
          mode: SearchResult.COMMAND,
          command: currentSuggestion.label,
          args: afterFirstWord,
        };
        return;
      }

      if (currentSuggestion.type === SuggestionType.BOOKMARK) {
        // The suggestion is a bookmark
        if (currentSuggestion.alias === firstWord) {
          // We are using the Alias
          // Example: gm Paris
          this.computedSearchResult = {
            mode: SearchResult.BOOKMARK,
            name: currentSuggestion.label,
            url: currentSuggestion.url,
            searchUrl: currentSuggestion.searchUrl ?? "",
            searchTerm: afterFirstWord,
          };
          return;
        } else {
          // We are using the Label
          // Example: Google Maps Paris
          this.computedSearchResult = {
            mode: SearchResult.BOOKMARK,
            name: currentSuggestion.label,
            url: currentSuggestion.url,
            searchUrl: currentSuggestion.searchUrl ?? "",
            searchTerm: input.slice(currentSuggestion.label.length + 1),
          };
          return;
        }
      }
    }

    // If no space and contains a '.', assume it's a URL
    if (firstSpace === -1 && input.includes(".")) {
      this.computedSearchResult = {
        mode: SearchResult.URL,
        url: input,
      };
      return;
    }

    // It's a web search
    this.computedSearchResult = {
      mode: SearchResult.WEB_SEARCH,
      searchTerm: input,
    };
    return;
  }

  isInputCalculation() {
    const input = this.input.trim();

    // ',' and '.' are both accepted as the decimal separator
    if (!/^[0-9.,\-\+\*\/\(\) ]+$/.test(input)) return false;

    // We need an actual operator, otherwise things like '10.0.0.5' would be
    // seen as a (broken) calculation instead of a search
    if (/[\-\+\*\/]/.test(input)) return true;

    // ... unless it's just a plain number
    return /^[0-9]+([.,][0-9]+)?$/.test(input);
  }

  public async refreshSuggestions() {
    if (!this.input?.length) {
      this.filteredSuggestions = this.allSuggestions;
      return;
    }

    if (
      this.input.startsWith(" ") ||
      this.parsedSearch.mode !== SearchType.OTHER
    ) {
      this.filteredSuggestions = [];
      return;
    }

    const firstSpace = this.input.indexOf(" ");

    const input = this.input.toLowerCase();
    if (firstSpace === -1) {
      // There is no space in the input.
      const goodSuggestions: Suggestion[] = [];
      const mediumSuggestions: Suggestion[] = [];
      const badSuggestions: Suggestion[] = [];

      for (const s of this.allSuggestions) {
        const label = s.label.toLowerCase();
        if (label === input) {
          goodSuggestions.push(s);
          continue;
        }
        if (s.type === SuggestionType.BOOKMARK && s.alias === input) {
          goodSuggestions.push(s);
          continue;
        }
        if (label.startsWith(input)) {
          mediumSuggestions.push(s);
          continue;
        }
        if (label.includes(input)) {
          badSuggestions.push(s);
        }
      }

      // We keep "good" suggestions on top.
      this.filteredSuggestions = goodSuggestions;

      // For the medium and bad, we sort by history, and make sure they don't repeat
      const filtered = new Map<string, Suggestion>();
      for (const s of [...mediumSuggestions, ...badSuggestions]) {
        if (filtered.has(s.label)) continue;
        filtered.set(s.label, s);
      }

      const history = await getHistory();

      for (const hist of history) {
        const suggestion = filtered.get(hist);
        if (suggestion) {
          filtered.delete(hist);
          this.filteredSuggestions.push(suggestion);
        }
      }

      this.filteredSuggestions.push(...filtered.values());
    } else {
      const firstWord = input.slice(0, firstSpace);

      this.filteredSuggestions = this.allSuggestions.filter((s) => {
        if (s.type === SuggestionType.COMMAND) return false;
        return (
          s.alias === firstWord || input.startsWith(s.label.toLowerCase())
        );
      });
    }
  }

  private async interactiveAddBookmark() {
    await sleep(10);
    let text = "Adding bookmark\n\nURL : ";
    const url = await promptText(text);
    if (!url) {
      this.draw();
      return;
    }
    text += url + "\nSearch URL (with %s) ?: ";
    const searchUrl = await promptText(text);
    text += searchUrl + "\nName : ";
    const name = await promptText(text);
    if (!name) {
      this.draw();
      return;
    }
    text += name + "\nAlias ?: ";
    const alias = await promptText(text);

    try {
      await addBookmark(name, url, searchUrl, alias);
    } catch (err) {
      console.log(err instanceof Error ? err.message : String(err));
      await sleep(1500);
      this.draw();
      return;
    }

    this.allSuggestions.unshift({
      type: SuggestionType.BOOKMARK,
      label: name,
      alias,
      url,
      searchUrl: searchUrl || undefined,
    });
    await this.refreshSuggestions();

    console.log("Bookmark added successfully!");
    await sleep(1500);
    this.draw();
  }

  private async interactiveRenameBookmark() {
    await sleep(10);

    const suggestion = this.filteredSuggestions[this.cursor];
    if (suggestion?.type !== SuggestionType.BOOKMARK) return;

    let text = suggestion.label + " => ";

    const newName = await promptText(text, suggestion.label);

    text += newName + "\nConfirm ?";

    if (await promptConfirm(text)) {
      await updateBookmark(
        { name: suggestion.label, url: suggestion.url },
        { name: newName }
      );
      await this.buildSuggestions();
      await this.refreshSuggestions();
    }
  }

  private async interactiveChangeBookmarkUrl() {
    await sleep(10);

    const suggestion = this.filteredSuggestions[this.cursor];
    if (suggestion?.type !== SuggestionType.BOOKMARK) return;

    let text = "New URL: ";
    const newUrl = await promptText(text);

    text += newUrl + "\nNew Search URL (with %s) ?: ";
    const newSearchUrl = await promptText(text);

    text += newSearchUrl + "\nConfirm ?";

    if (await promptConfirm(text)) {
      await updateBookmark(
        { name: suggestion.label, url: suggestion.url },
        { url: newUrl, searchUrl: newSearchUrl }
      );
      await this.buildSuggestions();
      await this.refreshSuggestions();
    }
  }

  private async interactiveDeleteBookmark() {
    await sleep(10);

    const suggestion = this.filteredSuggestions[this.cursor];
    if (suggestion?.type !== SuggestionType.BOOKMARK) return;

    if (
      await promptConfirm(
        suggestion.label +
          "\n\nAre you sure you want to delete this bookmark ? "
      )
    ) {
      await removeBookmark(suggestion.label, suggestion.url);
      await this.buildSuggestions();
      await this.refreshSuggestions();
    }
  }

  private async showHelp() {
    await sleep(10);
    console.clear();
    console.log(
      "\x1B[38;5;1mOmnibar Help\x1B[0m\n\n" +
        "  Tab :           Complete\n" +
        "  Ctrl + B :      Add a bookmark\n" +
        "  Ctrl + R :      Rename a bookmark\n" +
        "  Ctrl + T :      Change the URL of a bookmark\n" +
        "  Ctrl + Delete : Remove a bookmark\n" +
        "  ? :             Show this help\n\n" +
        "  = ... Will evaluate the JS expression\n\n\n" +
        "Press any key to close this help."
    );

    const sub = this.kb.subscribe((_) => {
      sub.unsubscribe();
      this.draw();
    });
  }

  public async draw() {
    super.draw();

    if (!!this.computedSearchResult) {
      const r = this.computedSearchResult;

      if (r.mode === SearchResult.WEB_SEARCH) {
        console.log("\x1B[38;5;239mWeb Search - " + r.searchTerm + "\x1B[0m");
      } else if (r.mode === SearchResult.BOOKMARK) {
        let url = r.url;
        if (r.searchUrl && r.searchTerm) {
          url = r.searchUrl.replace("%s", r.searchTerm);
        }
        console.log("\x1B[38;5;239m" + url + "\x1B[0m");
      } else if (r.mode === SearchResult.COMMAND) {
        console.log("\x1B[38;5;239mRun " + r.command + "\x1B[0m");
      } else if (r.mode === SearchResult.CALCULATOR) {
        console.log(
          "\x1B[38;5;239m" + r.equation + " = " + r.result + "\x1B[0m"
        );
      } else if (r.mode === SearchResult.URL) {
        console.log("\x1B[38;5;239mOpen " + r.url.slice(0, 90) + "\x1B[0m");
      }
    }

    for (
      let i = 0;
      i < Math.min(SUGGESTION_LIMIT, this.filteredSuggestions.length);
      i++
    ) {
      const suggestion = this.filteredSuggestions[i];
      if (i === this.cursor) {
        console.log(
          "\x1B[48;5;236m\x1B[38;5;1m▌\x1B[39m" +
            suggestion.label.slice(0, 90) +
            "\x1B[0m"
        );
      } else {
        console.log(" " + suggestion.label.slice(0, 90) + "\x1B[0m");
      }
    }
  }
}

new Omnibar();
