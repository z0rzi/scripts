import child_process from "child_process";
import fs from "fs";

const HOME = process.env["HOME"];
const CWD = process.env["PWD"];
const NO_ARGS_PROVIDED = process.argv.length <= 2;

export { HOME, CWD, NO_ARGS_PROVIDED };
export { NO_MATCH_FOUND };

export async function bunCmd(cmd: string | string[]) {
  if (typeof cmd === "string") cmd = cmd.split(" ").filter(Boolean);
  const proc = Bun.spawn(cmd, {
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  proc.kill();
  if (err) console.log(err);
  return out;
}

export async function cmd(
  command: string,
  opts?: Partial<{ cutLines: false; trim: boolean; acceptFailure: boolean }>
): Promise<string>;
export async function cmd(
  command: string,
  opts?: Partial<{ cutLines: true; trim: boolean; acceptFailure: boolean }>
): Promise<string[]>;
export async function cmd(
  command: string,
  opts?: Partial<{ cutLines: boolean; trim: boolean; acceptFailure: boolean }>
): Promise<string | string[]>;
/**
 * Runs a shell command
 *
 * @returns The result as 1 string
 */
export async function cmd(
  command: string,
  opts: Partial<{
    cutLines: boolean;
    trim: boolean;
    acceptFailure: boolean;
  }> = {
    cutLines: false,
    trim: true,
    acceptFailure: false,
  }
): Promise<string | string[]> {
  opts = Object.assign(
    {
      cutLines: false,
      trim: true,
      acceptFailure: false,
    },
    opts
  );
  return new Promise((resolve, reject) => {
    child_process.exec(command, (err, stdout, stderr) => {
      if (!!stdout) {
        if (!opts.cutLines) return resolve(stdout.trim());

        return resolve(
          stdout
            .split("\n")
            .map((line) => (opts ? line.trim() : line))
            .filter((e) => !!e)
        );
      }

      if (stderr) return reject(stderr);

      if (err) {
        if (err.message.includes("Command failed") && !opts.acceptFailure) {
          console.log("Failed while trying to execute the following command:");
          console.log("");
          console.log("    " + command);
          console.log("");
          console.log(err.message);
          process.exit(1);
        }
        return reject(err);
      }

      return resolve("");
    });
  });
}

export function getOpenFileCommand(path: string): string[] {
  let program = process.env["EDITOR"] || "nvim";
  let needsTerminal = true;

  if (path.includes("/right/") || path.includes("/left/")) {
    program = "codediff";
  }

  const ext = path.split(".").pop() || "";
  if (
    ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext.toLowerCase())
  ) {
    program = "xdg-open";
    needsTerminal = false;
  }
  if (
    ["mp4", "mkv", "avi", "webm", "mov", "wmv", "flv", "vob"].includes(
      ext.toLowerCase()
    )
  ) {
    program = "mpv";
    needsTerminal = false;
  }

  if (ext.toLowerCase() === "pdf") {
    program = process.env["BROWSER"] || "brave";
    needsTerminal = false;
  }

  if (!needsTerminal) {
    return [program, path];
  } else {
    return ["wezterm", "start", "--class", "fullscreen", "-e", program, path];
  }
}

export async function openFile(path: string): Promise<void> {
  const program = getOpenFileCommand(path);

  return new Promise((resolve) => {
    const cmd = program.shift();
    const child = child_process.spawn(String(cmd), program, {
      stdio: ["ignore", "ignore", "ignore"], // 'inherit', 'inherit', 'inherit
      windowsHide: false,
    });

    child.on("exit", function (_e, _code) {
      resolve();
    });
  });
}

export async function logInFile(
  obj: unknown,
  file = "/tmp/tmp.txt"
): Promise<void> {
  let str = "";
  try {
    str = JSON.stringify(obj);
  } catch (err) {
    str = String(obj);
  }

  fs.writeFileSync(file, str);
}

export async function sourceCmd(
  cmd: string,
  args: string[] = [],
  outMapper?: (chunk: string) => string
): Promise<number> {
  const proc = child_process.spawn(cmd, args);

  function indata(c: Buffer) {
    proc.stdin.write(c);
  }
  function outdata(c: Buffer) {
    if (outMapper) {
      process.stdout.write(outMapper(c.toString()));
    } else {
      process.stdout.write(c);
    }
  }

  process.stdin.resume();
  process.stdin.on("data", indata);
  proc.stdout.on("data", outdata);

  return new Promise((resolve, reject) => {
    proc.on("exit", function (code) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", indata);
      proc.stdout.removeListener("data", outdata);

      if (code == null) {
        return reject("Process exited with null code");
      }

      resolve(code);
    });
  });
}

export type MapOptions = {
  /** Can an argument match multiple patterns? */
  multiMatch?: boolean;
};

const NO_MATCH_FOUND = "__no_matches__";

export function mapArgs(
  map: {
    [rx: string]: (
      match?: string,
      captureGroups?: { [key: string]: string }
    ) => Promise<unknown> | unknown;
  },
  opts: MapOptions = {
    multiMatch: true,
  }
): void {
  let noMatchCb = null as
    | null
    | ((match: string, captureGroups: { [key: string]: string }) => unknown);
  if (NO_MATCH_FOUND in map) noMatchCb = map[NO_MATCH_FOUND];

  const proms = new Promise<void>((resolve) => resolve());

  let matchFound = false;
  const args = process.argv.slice(2);
  for (const arg of args) {
    for (const strRx of Object.keys(map)) {
      const rx = new RegExp(strRx);
      if (rx.test(arg)) {
        matchFound = true;
        const matches = arg.match(rx);
        proms.then(() => map[strRx](arg, { ...matches!.groups }));
        if (!opts.multiMatch) return;
      }
    }
  }

  if (!matchFound && !!noMatchCb) {
    noMatchCb("", {});
  }
}
