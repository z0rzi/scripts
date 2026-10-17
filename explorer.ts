#!/usr/bin/env bun

import { $, ShellPromise, sleep } from "bun";
import child_process from "child_process";
import fs from "fs";
import kl from "kleur";
import path from "path";
import { getStyleFor, ICONS } from "./icons2";
import { InputField, promptConfirm } from "./InputField";
import { Key, Keyboard } from "./keyboard";
import { openFile } from "./shell";

let LEFT_PATH = process.env["LEFT_PATH"];
let RIGHT_PATH = process.env["RIGHT_PATH"];

if (LEFT_PATH && !LEFT_PATH.endsWith("/")) LEFT_PATH += "/";
if (RIGHT_PATH && !RIGHT_PATH.endsWith("/")) RIGHT_PATH += "/";

const rootDir = path.resolve(process.argv[2] || ".");

const INDENT = "┆   ";

type NextOptions = {
  showHidden?: boolean;
  skipDirs?: boolean;
};

class File {
  get path() {
    return path.join(this.dirPath, this.name);
  }

  // We try to find the file path for git operations.
  // When in git diff mode, we usually are reading from /tmp/..., because they are
  // tmp files created by the diff command.
  //
  // We try to find the actual files, using the cwd.
  get gitFilePath(): string {
    if (!LEFT_PATH || !RIGHT_PATH) return this.path;

    let relativePath = this.path;
    if (relativePath.startsWith(LEFT_PATH)) {
      relativePath = relativePath.replace(LEFT_PATH, "");
    } else if (relativePath.startsWith(RIGHT_PATH)) {
      relativePath = relativePath.replace(RIGHT_PATH, "");
    }

    let cwd = process.cwd();
    while (cwd !== "/") {
      const potentialFilePath = path.join(cwd, relativePath);

      if (fs.existsSync(potentialFilePath)) {
        return potentialFilePath;
      }

      cwd = path.dirname(cwd);
    }

    return this.path;
  }

  get hidden() {
    if (LEFT_PATH && RIGHT_PATH) {
      // It's a comparison between 2 directories.
      // We check if the file is identical or not.

      let relativePath = this.path;
      if (relativePath.startsWith(LEFT_PATH)) {
        relativePath = relativePath.replace(LEFT_PATH, "");
      } else if (relativePath.startsWith(RIGHT_PATH)) {
        relativePath = relativePath.replace(RIGHT_PATH, "");
      }
      const leftFilePath = path.join(LEFT_PATH, relativePath);
      const rightFilePath = path.join(RIGHT_PATH, relativePath);

      let statsLeft: fs.Stats, statsRight: fs.Stats;
      try {
        statsLeft = fs.statSync(leftFilePath);
        statsRight = fs.statSync(rightFilePath);
      } catch (err) {
        return this.name.startsWith(".");
      }

      if (statsLeft.isFile() && statsRight.isFile()) {
        const contentLeft = fs
          .readFileSync(leftFilePath, "utf8")
          .replace(/\s+/g, "");
        const contentRight = fs
          .readFileSync(rightFilePath, "utf8")
          .replace(/\s+/g, "");
        if (contentLeft === contentRight) {
          return true;
        }
      }
    }
    return this.name.startsWith(".");
  }

  constructor(
    public name: string,
    public dirPath: string,
    public parent?: Directory
  ) {}

  draw(isFocussed = false, rxToHighlight?: RegExp) {
    const style = getStyleFor(this.path);
    if (style.iconColor) process.stdout.write(style.iconColor(style.icon));
    else if (style.textStyle?.color)
      process.stdout.write(style.textStyle.color(style.icon));
    else process.stdout.write(style.icon);

    process.stdout.write(" ");

    let styleFuncs = [];
    if (isFocussed) styleFuncs.push(kl.underline);
    if (style.textStyle) {
      if (style.textStyle.bold) styleFuncs.push(kl.bold);
      if (style.textStyle.italic) styleFuncs.push(kl.italic);
      if (style.textStyle.underline) styleFuncs.push(kl.underline);
    }

    let name = this.name;
    if (rxToHighlight) {
      name = name.replace(rxToHighlight, (match) => kl.bgYellow(match));
    }

    const fileNameExt = path.extname(name);
    const fileNameBase = path.basename(name, fileNameExt);

    let fileName =
      fileNameBase +
      (style.iconColor ? style.iconColor(fileNameExt) : fileNameExt);

    for (const styleFunc of styleFuncs) fileName = styleFunc(fileName);
    if (style.textStyle?.color) {
      process.stdout.write(style.textStyle.color(fileName + " "));
    } else {
      process.stdout.write(fileName + " ");
    }
  }

  protected matchesOpts(opts: NextOptions) {
    return !this.hidden || opts.showHidden;
  }

  nextSibling(): File | Directory | null {
    if (!this.parent) return null;
    const idx = this.parent.children.indexOf(this);
    if (idx === -1) return null;
    const nextElem = this.parent.children[idx + 1];
    return nextElem || null;
  }

  prevSibling(): File | Directory | null {
    if (!this.parent) return null;
    const idx = this.parent.children.indexOf(this);
    if (idx === -1) return null;
    const prevElem = this.parent.children[idx - 1];
    return prevElem || null;
  }

  next(): File | Directory | null {
    if (!this.parent) return null;
    const nextSibling = this.nextSibling();
    if (nextSibling) return nextSibling;

    // No next sibling, go up
    return this.parent.next(true);
  }

  prev(): File | Directory | null {
    if (!this.parent) return null;
    const prevSibling = this.prevSibling();
    if (prevSibling) {
      if (prevSibling instanceof Directory) {
        return prevSibling.lastVisibleChild();
      }
      return prevSibling;
    }

    return this.parent;
  }
}

class Directory extends File {
  // Only the children that are visible on screen
  children: File[] = [];

  // All the children, including hidden ones
  private allChildren: File[] = [];

  opened = false;

  draw(isFocussed = false, rxToHighlight?: RegExp) {
    let icon = this.opened ? ICONS.folder_open : ICONS.folder_closed;
    let name = this.name;

    if (rxToHighlight) {
      name = name.replace(rxToHighlight, (match) => kl.bgYellow(match));
    }

    if (isFocussed) {
      process.stdout.write(kl.gray(icon + " " + kl.underline(name + "/")));
    } else {
      process.stdout.write(kl.gray(icon + " " + name + "/"));
    }
  }

  private refreshChildren() {
    const files = fs.readdirSync(this.path);
    this.allChildren = [];
    for (const file of files) {
      const filePath = path.join(this.path, file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          this.allChildren.push(new Directory(file, this.path, this));
        } else if (stat.isFile()) {
          this.allChildren.push(new File(file, this.path, this));
        }
      } catch (err) {
        // Stats error, probably not an ordinary file, or permissions error, we ignore it
      }
    }
    this.allChildren.sort((a, b) => {
      if (a instanceof Directory && b instanceof Directory)
        return a.name.localeCompare(b.name);
      if (a instanceof Directory) return -1;
      if (b instanceof Directory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  removeChildFromList(child: File | Directory) {
    let idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    idx = this.allChildren.indexOf(child);
    if (idx !== -1) this.allChildren.splice(idx, 1);
  }

  open(showHidden: boolean, forceRefresh = false) {
    if (forceRefresh || !this.allChildren?.length) {
      this.refreshChildren();
    }
    if (showHidden) this.children = this.allChildren;
    else this.children = this.allChildren.filter((f) => !f.hidden);

    this.opened = true;
  }

  close() {
    this.opened = false;
  }

  protected matchesOpts(opts: NextOptions) {
    return !opts.skipDirs && (!this.hidden || opts.showHidden);
  }

  next(skipChildren = false): File | Directory | null {
    if (this.opened && this.children.length > 0 && !skipChildren)
      return this.children[0];

    const nextSibling = this.nextSibling();
    if (nextSibling) return nextSibling;

    return this.parent?.next(true) || null;
  }

  prev(): File | Directory | null {
    const prevSibling = this.prevSibling();
    if (!prevSibling) {
      return this.parent || null;
    }

    if (prevSibling instanceof Directory) {
      return prevSibling.lastVisibleChild();
    }
    return prevSibling;
  }

  lastVisibleChild(): File | Directory | null {
    if (!this.opened || !this.children.length) return this;
    const lastChild = this.children[this.children.length - 1];
    if (lastChild instanceof Directory) {
      return lastChild.lastVisibleChild();
    }
    return lastChild;
  }

  nextRegularFile(
    notBefore?: File | Directory,
    showHidden = false,
    reverse = false,
    _foundFromFile = false
  ): [boolean, File | null] {
    if (!notBefore) _foundFromFile = true;

    if (_foundFromFile) {
      // We found the focussed file. Now, we dig in each directory to find the next file
      if (!this.allChildren.length) {
        this.refreshChildren();
        this.children = showHidden
          ? this.allChildren
          : this.allChildren.filter((f) => !f.hidden);
      }
    }

    const children = this.children.slice();
    if (reverse) children.reverse();
    for (const child of children) {
      if (_foundFromFile && !(child instanceof Directory)) {
        return [true, child];
      }
      if (child === notBefore) {
        _foundFromFile = true;
      }
      if (child instanceof Directory) {
        let found;
        [_foundFromFile, found] = child.nextRegularFile(
          notBefore,
          showHidden,
          reverse,
          _foundFromFile
        );

        if (found) {
          return [true, found];
        }
      }
    }

    return [_foundFromFile, null];
  }
}

type RenderItem = {
  item: File | Directory;
  level: number;
  lineCnt: number;
  isFocussed: boolean;
};

async function promptText(prompt: string, defaultValue = ""): Promise<string> {
  return new Promise((resolve) => {
    const field = new InputField(prompt, async (input) => {
      field.destroy();
      setTimeout(() => {
        resolve(input);
      }, 100);
    });

    if (defaultValue) {
      field.input = defaultValue;
      field.carret = defaultValue.length;
      field.draw();
    }
  });
}

class Explorer {
  offset = 0;
  screenSize = process.stdout.rows - 1;

  rootDir: Directory;
  shouldShowHidden = false;

  lastSearchRx = null as RegExp | null;

  currentFile: File | Directory | null = null;

  kbSub = Keyboard.getInstance().subscribe((evt) => this.handleKey(evt));

  constructor(
    public rootDirPath: string,
    private readonly onFileSelected: (file: File) => Promise<void> | void
  ) {
    const dirName = path.basename(rootDirPath);
    const parentDirPath = path.dirname(rootDirPath);
    this.rootDir = new Directory(dirName, parentDirPath);
    this.rootDir.open(this.shouldShowHidden);
    this.currentFile = this.rootDir;
  }

  private renderLines(
    item: File | Directory,
    level = 0,
    items = [] as RenderItem[]
  ): RenderItem[] {
    if (!level) console.clear();
    let isFocussed = this.currentFile === item;

    items.push({ item, level, lineCnt: 0, isFocussed });
    if (item instanceof Directory && item.opened) {
      for (const child of item.children) {
        if (child.hidden && !this.shouldShowHidden) continue;
        this.renderLines(child, level + 1, items);
      }
    }

    return items;
  }

  draw() {
    const itemsToDraw = this.renderLines(this.rootDir);

    const focussedIdx = itemsToDraw.findIndex((i) => i.isFocussed);
    if (focussedIdx !== -1) {
      if (focussedIdx < this.offset) {
        this.offset = focussedIdx;
      }
      if (focussedIdx >= this.offset + this.screenSize) {
        this.offset = focussedIdx - this.screenSize + 1;
      }
    }

    for (let i = 0; i < itemsToDraw.length; i++) {
      if (i < this.offset || i >= this.offset + this.screenSize) {
        // We are outside the window, we don't need to draw anything
        continue;
      }
      const item = itemsToDraw[i];
      process.stdout.write(kl.black(INDENT.repeat(item.level)));
      item.item.draw(item.isFocussed, this.lastSearchRx ?? undefined);
      process.stdout.write("\n");
    }
  }

  private async handleG(evt: Key): Promise<boolean> {
    if (evt.key !== "g") return true;

    process.stdout.write(kl.grey("g"));

    if (evt.shift) {
      this.currentFile = this.rootDir.lastVisibleChild();
      return true;
    }

    const key = await Keyboard.getInstance().subscribeToOneKey();

    if (key.key === "g") {
      this.currentFile = this.rootDir;
      return true;
    }

    process.stdout.write(kl.grey(key.key + "\n"));

    // git operations
    if (!this.currentFile) return true;
    const gitFilePath = this.currentFile.gitFilePath;

    let command = null as ShellPromise | null;
    let comment = "";

    switch (key.key) {
      case "a":
        command = $`git add ${gitFilePath}`;
        comment = "Added to git";
        break;
      case "d":
        // removing from staged files
        command = $`git restore --staged ${gitFilePath}`;
        comment = "Removed from staged files";
        break;
      case "s":
        // status
        command = $`git status -s`;
        break;
    }
    if (!command) return true;

    try {
      const stdout = await command.text();
      if (stdout.trim()) console.log(stdout);
      if (comment) console.log(kl.green(comment));
    } catch (err) {
      console.log(
        kl.red("Error: " + (err.stderr.toString() || err.message).trim())
      );
    }
    return false;
  }

  async handleKey(evt: Key) {
    if (!this.currentFile) {
      this.currentFile = this.rootDir;
    }

    if (evt.key === "q") {
      process.exit(0);
    }

    if (evt.key === "j") {
      if (evt.shift) {
        const next = this.rootDir.nextRegularFile(
          this.currentFile,
          this.shouldShowHidden,
          false,
          this.currentFile === this.rootDir
        );
        if (next[1]) {
          let parent = next[1].parent;
          while (parent) {
            parent.open(this.shouldShowHidden);
            parent = parent.parent;
          }
          this.currentFile = next[1];
        }
      } else {
        const next = this.currentFile.next();
        if (next) {
          console.log("🥖", next.path);
          this.currentFile = next;
        }
      }
    }

    if (evt.key === "k") {
      if (evt.shift) {
        const prev = this.rootDir.nextRegularFile(
          this.currentFile,
          this.shouldShowHidden,
          true,
          this.currentFile === this.rootDir
        );
        if (prev[1]) {
          let parent = prev[1].parent;
          while (parent) {
            parent.open(this.shouldShowHidden);
            parent = parent.parent;
          }
          this.currentFile = prev[1];
        }
      } else {
        const prev = this.currentFile.prev();
        if (prev) {
          this.currentFile = prev;
        }
      }
    }

    if (evt.key === "return") {
      if (this.currentFile instanceof Directory) {
        if (this.currentFile.opened) {
          this.currentFile.close();
        } else {
          this.currentFile.open(this.shouldShowHidden);
        }
      } else {
        this.onFileSelected(this.currentFile);
      }
    }

    if (evt.key === "l") {
      if (this.currentFile instanceof Directory) {
        this.currentFile.open(this.shouldShowHidden);
        this.currentFile = this.currentFile.next() || this.currentFile;
      }
    }

    if (evt.key === "h") {
      if (this.currentFile instanceof Directory && this.currentFile.opened) {
        this.currentFile.close();
      } else {
        this.currentFile.parent?.close();
        this.currentFile = this.currentFile.parent || this.rootDir;
      }
    }

    if (evt.key === "g") {
      const shouldRedraw = await this.handleG(evt);
      if (!shouldRedraw) return;
    }

    if (evt.key === "z") {
      // Putting the cusros in the middle of the screen
      const lines = this.renderLines(this.rootDir);
      const focussedIdx = lines.findIndex((i) => i.isFocussed);
      this.offset = Math.max(0, focussedIdx - Math.floor(this.screenSize / 2));
    }

    if (evt.key === "r") {
      this.renameCurrent()
        .catch((err) => {
          console.log(kl.red("Error: " + err.message));
          return sleep(1000);
        })
        .finally(() => {
          this.draw();
        });
      return;
    }

    if (evt.key === "d") {
      this.deleteCurrent()
        .catch((err) => {
          console.log(kl.red("Error: " + err.message));
          return sleep(1000);
        })
        .finally(() => {
          this.draw();
        });
      return;
    }

    if (evt.key === "y") {
      let currentFilePath = this.currentFile?.path.replace(
        this.rootDir.path,
        ""
      );
      if (!currentFilePath) return;

      if (currentFilePath.startsWith("/"))
        currentFilePath = currentFilePath.slice(1);
      child_process.execSync("wl-copy", { input: currentFilePath });
      console.log(
        kl.gray(currentFilePath) + kl.green("\nPath copied to clipboard")
      );
      return;
    }

    if (evt.key === "?") {
      this.showHelp();
      return;
    }

    if (evt.key === "/") {
      promptText("/").then((searchTerm) => {
        this.lastSearchRx = new RegExp(searchTerm, "i");
        this.goToNextMatch();
      });
      return;
    }

    if (evt.key === "n") {
      this.goToNextMatch(evt.shift);
    }

    if (evt.key === "p" && evt.ctrl) {
      // fuzzy search
      const sourcePath = this.currentFile?.dirPath ?? this.rootDir.path;

      return new Promise((resolve) => {
        const cmd = "wezterm";
        const args = [
          "start",
          "--class",
          "floating",
          "-e",
          "bash",
          "-c",
          `listfiles.sh ${sourcePath} | fzf > /tmp/explorer-fzf.txt`,
        ];
        const child = child_process.spawn(String(cmd), args, {
          stdio: ["ignore", "ignore", "ignore"], // 'inherit', 'inherit', 'inherit
          windowsHide: false,
        });

        child.on("exit", (_e, _code) => {
          const content = fs.readFileSync("/tmp/explorer-fzf.txt", "utf8");
          const filePath = content.trim().replace(this.rootDir.path + "/", "");
          const pathParts = filePath.split("/");

          let file = this.rootDir as Directory | File | undefined;
          for (const part of pathParts) {
            if (!file || !(file instanceof Directory)) break;
            file = file.children.find((f) => f.name === part);
            if (file instanceof Directory) file.open(this.shouldShowHidden);
          }
          if (file) {
            this.currentFile = file;
            this.draw();
          }
        });
      });
    }

    this.draw();
  }

  goToNextMatch(reverse = false) {
    if (!this.lastSearchRx) return;
    const lines = this.renderLines(this.rootDir);
    if (reverse) lines.reverse();
    let focussedIdx = lines.findIndex((i) => i.isFocussed);
    if (focussedIdx === -1) focussedIdx = 0;

    for (let i = 0 + 1; i < lines.length; i++) {
      const iMod = (i + focussedIdx) % lines.length;
      if (this.lastSearchRx.test(lines[iMod].item.name)) {
        this.currentFile = lines[iMod].item;
        this.draw();
        return;
      }
    }
    // No match found, do nothing
    this.draw();
  }

  showHelp() {
    console.clear();
    const helpItems = [
      ["j", "Down"],
      ["k", "Up"],
      ["l", "Open"],
      ["h", "Close"],
      ["y", "Copy relative path"],
      ["gg", "Go to root"],
      ["ga", "$ git add"],
      ["gd", "$ git add"],
      ["shift+g", "Go to last visible"],
      ["z", "Center cusrsor"],
      ["return", "Open directory / file"],
      ["/", "Search"],
      ["n/N", "Next/Prev match"],
      ["?", "Help"],
      ["q", "Quit"],
    ];

    const longestKey = Math.max(...helpItems.map(([key]) => key.length));

    console.log(kl.bold(kl.green("Commands:\n")));
    for (const [key, desc] of helpItems) {
      process.stdout.write(kl.bold(kl.blue(key + " ")));
      process.stdout.write(
        kl.black(".".repeat(longestKey - key.length + 2)) + " "
      );
      process.stdout.write(desc);
      process.stdout.write("\n");
    }
  }

  async renameCurrent() {
    if (!this.currentFile) return;

    console.clear();
    const newName = await promptText(
      `Renaming\n  ${
        kl.gray(this.currentFile?.dirPath + "/") + this.currentFile?.name
      }\nTo\n  ${kl.gray((this.currentFile?.dirPath || "") + "/")}`,
      this.currentFile?.name
    );
    if (newName.includes("/")) {
      throw new Error("The name shouldn't contain a slash");
    }
    if (!newName) {
      throw new Error("Empty name");
    }
    if (newName !== this.currentFile?.name) {
      fs.renameSync(
        this.currentFile?.path,
        path.join(this.currentFile?.dirPath, newName)
      );
      this.currentFile.name = newName;
      this.currentFile.draw();
    }
  }

  async deleteCurrent() {
    if (!this.currentFile) return;

    console.clear();
    const answer = await promptConfirm(
      `file: ${
        kl.gray(this.currentFile?.dirPath + "/") + this.currentFile?.name
      }\n${kl.red("Delete ?")}`
    );

    if (answer) {
      const parent = this.currentFile.parent;
      const prev = this.currentFile.prev();
      await $`trash put ${this.currentFile?.path}`;

      parent?.removeChildFromList(this.currentFile);
      this.currentFile = prev;
    }
  }

  destroy() {
    this.kbSub.unsubscribe();
  }
}

// If ran directly
if (process.argv[1] === __filename) {
  const e = new Explorer(rootDir, (file) => {
    openFile(file.path);
  });
  e.draw();
}
