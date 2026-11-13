#!/usr/bin/env bun

// Emoji picker for a small floating terminal: type to filter the emojis
// already known (Shift+J / Shift+K move), end the search with `\` to look it
// up on emojifinder.com, Enter copies the emoji. Picked emojis move to the top
// and learn the search as a tag.

const HOME = process.env["HOME"];
const EMOJI_FILE_PATH = `${HOME}/.local/share/emojis2.json`;

import fs from "fs";
import prompts from "prompts";

type ApiEmoji = {
  Code: string;
  Name: string;
  score: number;
};

type Emoji = {
  icon: string;
  name: string;
  tags: string;
};

function codeToEmoji(code: string): string {
  if (!code) return "";
  code = code.trim();
  if (code.length === 4) return String.fromCharCode(parseInt(code, 16));
  if (/\s/.test(code)) {
    return code
      .trim()
      .split(/\s+/g)
      .map((subCode) => codeToEmoji(subCode))
      .join("");
  }

  let myCode = "D83";

  const ending = code.slice(3);
  const num = parseInt(code[2], 16);

  let myNum = 0;

  if (num < 0x4) {
    myNum = num;
  } else if (num < 0x8) {
    myNum = 0x100 + num - 0x4;
  } else {
    myNum = 0x200 + num - 0x8;
  }

  let emoji = "";

  myCode += (myNum + 0xcdc).toString(16);
  myCode += ending;
  myCode = `${myCode.slice(0, 4)} ${myCode.slice(4)}`;

  for (const part of myCode.split(/\s+/))
    emoji += String.fromCharCode(parseInt(part, 16));

  return emoji;
}

async function findEmojis(search: string): Promise<Emoji[]> {
  return fetch(
    "https://emojifinder.com/*/ajax.php?action=search&query=" +
      encodeURIComponent(search),
    { method: "GET" }
  )
    .then((res) => res.json())
    .then((res) => res.results as ApiEmoji[])
    .then((res) => {
      if (!res) return [];
      return res.map((apiEmo) => ({
        icon: codeToEmoji(apiEmo.Code),
        name: apiEmo.Name.toLowerCase(),
        tags: apiEmo.Name.toLowerCase(),
      }));
    });
}

function loadPreviousEmos(): Emoji[] {
  if (!fs.existsSync(EMOJI_FILE_PATH)) return [];
  const emos = JSON.parse(fs.readFileSync(EMOJI_FILE_PATH).toString());
  return emos;
}

/**
 * Not with $: wl-copy forks a child that serves the clipboard and keeps the
 * output pipes open, so $ would wait until something else takes the clipboard.
 */
async function copy(text: string) {
  await Bun.spawn(["wl-copy", "--", text], { stdio: ["ignore", "ignore", "ignore"] }).exited;
}

root();
async function root() {
  const allEmojis = loadPreviousEmos();

  let search = "";

  prompts({
    type: "autocomplete",
    limit: 20,
    name: "icon",
    message: "",
    // @ts-ignore
    suggest: async function (
      input: string,
      choices: { title: string; value: string; payload: Emoji }[]
    ) {
      if (Array.isArray(this)) return choices;

      if (input.endsWith("J")) {
        input = input.slice(0, -1);
        this.input = input;
        // Going down
        // @ts-ignore
        this.select = (this.select + 1) % this.choices?.length;
      }
      if (input.endsWith("K")) {
        input = input.slice(0, -1);
        this.input = input;
        // Going up
        // @ts-ignore
        this.select =
          // @ts-ignore
          (this.select + this.choices?.length - 1) % this.choices?.length;
      }

      input = input.toLowerCase();
      if (input.endsWith("\\")) {
        this.input = this.input.slice(0, -1);
        input = this.input;
        const newEmojis = await findEmojis(this.input);

        newEmojis.forEach((newEmo) => {
          const iconExists = allEmojis.find((e2) => e2.icon === newEmo.icon);
          if (iconExists) {
            // Icon already exists
            if (
              !iconExists.tags.includes(input) &&
              !iconExists.name.includes(input)
            )
              iconExists.tags += " " + input;
          } else {
            // Icon does not exist yet, we add it
            if (!newEmo.tags.includes(input)) newEmo.tags += " " + input;

            allEmojis.push(newEmo);
          }
        });

        choices = allEmojis.map((e) => ({
          title: e.icon,
          value: e.icon,
          payload: e,
        }));

        this.choices = choices;
      }

      search = input;

      return choices.filter((c) => {
        const emoji = allEmojis.find((e) => e.icon === c.value);
        return (
          emoji &&
          (emoji.tags.toLowerCase().includes(input) ||
            emoji.name.toLowerCase().includes(input))
        );
      });
    },
    choices: allEmojis.map((e) => ({
      title: e.icon,
      value: e.icon,
      payoad: e,
    })),
  }).then(async (choice) => {
    // Escape gives an empty answer.
    if (!choice?.icon) process.exit(1);
    await copy(choice.icon);

    const emoji = allEmojis.find((e) => e.icon === choice.icon);

    if (!emoji) {
      console.log("Emoji not found");
      process.exit(1);
    }

    let tags = new Set(emoji?.tags.split(/\s+/g).filter((t) => t.length > 2));
    if (!tags.has(search.toLowerCase())) tags.add(search.toLowerCase());
    emoji.tags = [...tags].join(" ");

    console.log(search);
    console.log(emoji);

    const newEmojis = allEmojis.filter((e) => e.icon !== choice.icon);
    newEmojis.unshift(emoji!);

    fs.writeFileSync(EMOJI_FILE_PATH, JSON.stringify(newEmojis, null, 2));
  });
}
