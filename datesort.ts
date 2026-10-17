#!/usr/bin/env bun

import fs from "fs";
import kleur from "kleur";

const reverse = process.argv.includes("-r");

let buff = "";
process.stdin.on("data", (d) => (buff += d.toString()));

process.stdin.on("end", () => {
  const filePaths = buff.split(/\n/g);

  const fileMetas = filePaths
    .map((filePath) => {
      try {
        const stats = fs.statSync(filePath);
        return [filePath, stats.mtime] as [string, Date];
      } catch (err) {
        return [filePath, null] as [string, null];
      }
    })
    .filter(Boolean)
    .sort((metasA, metasB) => {
      const a = metasA[1];
      const b = metasB[1];
      if (a == null) return -1;
      if (b == null) return 1;
      if (a == b) return 0;
      if (reverse) +a - +b;
      return +b - +a;
    }) as [string, Date][];

  if (process.stdout.isTTY) {
    console.log(
      fileMetas
        .map(([filePath]) => {
          filePath = filePath
            .replace(/^.*\//, (match) => {
              return kleur.gray(match);
            })
            .replace(/\/[^/]*\.[a-zA-Z]*$/, (match) => {
              let ext = "";
              match = match.replace(/\.[a-zA-Z]*$/, (e) => {
                ext = e;
                return "";
              });
              return kleur.dim().bold(match) + kleur.red(ext);
            });
          return filePath;
        })
        .join("\n")
    );
  } else {
    process.stdout.write(fileMetas.map(([filePath]) => filePath).join("\n") + "\n");
  }
});
