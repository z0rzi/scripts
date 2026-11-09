#!/usr/bin/env bun

import { readFileSync, existsSync } from "fs";
import path from "path";

function error(message) {
  console.error(message);

  console.log("");
  console.log(
    "USAGE = jsonStructure.js [--minify] [--parse-json] [--limit-size] <file>"
  );
  console.log("");
  console.log("    --minify: Minify the output");
  console.log("    --parse-json: Tries to dig in JSON strings to see the type");
  console.log("    --limit-size: Limits the array sizes");
  console.log("");
  process.exit(1);
}

let filePath = "";
let minify = false;
let parseJson = false;
let MAX_ARR_SIZE = 100000;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--")) {
    if (arg === "--minify") minify = true;
    else if (arg === "--parse-json") parseJson = true;
    else if (arg === "--limit-size") MAX_ARR_SIZE = 20;
    else error(`Unknown argument ${arg}`);
  } else {
    if (!existsSync(arg)) {
      error(`File ${arg} doesn't exist!`);
    }
    filePath = arg;
  }
}

if (!filePath) error("No file provided!");

function getType(obj) {
  if (obj === null) return "null";
  if (obj instanceof Date) return "Date";
  if (Array.isArray(obj)) return "Array";
  if (typeof obj === "string") {
    if (!isNaN(new Date(obj).getTime())) return "Date";
    try {
      JSON.parse(obj);
      return "json";
    } catch (err) {}
  }

  return typeof obj;
}

function newline(lvl) {
  if (!minify) return "\n" + "  ".repeat(lvl);
  else return "";
}

function toTypescript(obj, idt = 0) {
  const objType = getType(obj);

  if (objType === "Array") {
    const firstType = getType(obj[0]);
    const childs = [];
    if (obj.every((elem) => getType(elem) === firstType)) {
      if (firstType !== "object")
        return (
          `${toTypescript(obj[0])}[]` + (minify ? "" : ` /* x${obj.length} */`)
        );

      // it's an object
      const keys = Object.keys(obj[0]).map((key) => ({
        key,
        sure: true,
        type: toTypescript(obj[0][key], idt + 1),
      }));
      for (const child of obj) {
        keys
          .filter((k) => k.sure)
          .forEach((k) => {
            if (!(k.key in child)) k.sure = false;
          });

        Object.keys(child).forEach((childKey) => {
          if (keys.findIndex((k) => k.key === childKey) < 0) {
            keys.push({
              key: childKey,
              sure: false,
              type: toTypescript(child[childKey], idt + 1),
            });
          }
        });
      }

      const str = keys
        .map(({ key, sure, type }) => {
          if (key.includes(" ") || key.includes("-") || /^\d/.test(key))
            key = `'${key}'`;

          return key + (sure ? ": " : "?: ") + type;
        })
        .join("," + newline(idt + 1));

      return (
        `{${newline(idt + 1) + str + newline(idt)}}[]` +
        (minify ? "" : ` /* x${obj.length} */`)
      );
    } else {
      // Different types in the array
      obj.forEach((elem) => {
        const str = toTypescript(elem, idt + 1);
        if (!childs.includes(str)) childs.push(str);
      });
      return `[(${newline(idt + 1) + childs.join(" | ") + newline(idt)})]`;
    }
  }
  if (objType === "object") {
    const out = [];
    const entries = Object.entries(obj);
    // If all the values are 'object', we assume that all the objects are the same
    // It's a big assumption, but it works most of the time
    if (
      entries.every(([, val]) => !Array.isArray(val) && typeof val === "object")
    ) {
      out.push(`{${newline(idt+2)}[key: string]: ${toTypescript(entries[0][1], idt + 2)}${newline(idt + 1)}}`);
    } else {
      for (let [key, val] of entries.slice(0, MAX_ARR_SIZE)) {
        if (key.includes(" ") || key.includes("-") || /^\d/.test(key))
          key = `'${key}'`;

        out.push(`${key}: ${toTypescript(val, idt + 1)}`);
      }
    }

    return (
      "{" +
      newline(idt + 1) +
      out.join("," + newline(idt + 1)) +
      (entries.length > MAX_ARR_SIZE
        ? newline(idt + 1) +
          "/* + " +
          (entries.length - MAX_ARR_SIZE) +
          " more */"
        : "") +
      newline(idt) +
      "}"
    );
  }
  if (objType === "json") {
    if (!parseJson) return "string" + (minify ? "" : " /* json */");
    const js = JSON.parse(obj);
    return `/* START_JSON_STR { */${
      newline(idt + 1) + toTypescript(js, idt + 1) + newline(idt)
    }/* } END_JSON_STR */`;
  }

  return objType;
}
let data = "";

try {
  data = readFileSync(filePath, { encoding: "utf-8" });
} catch (err) {
  error("Couldn't read the file...");
}
try {
  data = JSON.parse(data);
} catch (err) {
  error("Couldn't parse the JSON...");
}

const extension = path.extname(filePath);
const fileName = path.basename(filePath, extension);
// Transforming to CamelCase
let name = fileName.replace(/(^|[_\-])(\w)/g, (_, __, c) => c.toUpperCase());
if (/^\d/.test(name)) name = "T" + name;

console.log(`type ${name} = ` + toTypescript(data));
