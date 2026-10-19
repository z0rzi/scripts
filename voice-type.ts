#!/usr/bin/env bun

// Records the mic in a small floating terminal (any key stops), transcribes it
// with OpenAI Whisper, then pastes the text into the focused window.
// Run from a terminal, records there and prints the text (and copies it) instead.
// With a file argument, only prints the transcription of that file.

import { $, sleep } from "bun";
import fs from "fs";

const TMP_AUDIO = "/tmp/whisper_recording.wav";
const TMP_SCRIPT = "/tmp/whisper.sh";
// sops-decrypted shell secrets (modules/secrets.nix). Read here because a
// global shortcut doesn't run through an interactive shell.
const SHELL_ENV = "/run/secrets/shell-env";
// 16 kHz mono 16-bit: 0.1 s (Whisper's minimum) is 3200 bytes, plus the header.
const MIN_AUDIO_BYTES = 44 + 3200;
const fromTerminal = process.stdin.isTTY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? readEnvFile(SHELL_ENV).OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(`Error: OPENAI_API_KEY is neither in the environment nor in ${SHELL_ENV}.`);
  process.exit(1);
}

function readEnvFile(path: string): Record<string, string> {
  if (!fs.existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return vars;
}

/**
 * Sends audio file to OpenAI Whisper API and returns resulting text.
 */
async function transcribeAudio(filepath: string): Promise<string> {
  const form = new FormData();
  form.append("file", Bun.file(filepath), "audio.wav");
  form.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.text;
}

async function listenAndTranscribe(): Promise<string> {
  // Mutes the speakers while recording, then restores them.
  await Bun.write(
    TMP_SCRIPT,
    `
    muted=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ | grep MUTED)
    wpctl set-mute @DEFAULT_AUDIO_SINK@ 1

    ffmpeg -loglevel error -y -f pulse -i default -acodec pcm_s16le -ar 16000 -ac 1 -t 120 ${TMP_AUDIO} &
    jpid=$!
    echo "Recording... press any key to stop"
    read -n1
    kill -s INT $jpid

    [ -z "$muted" ] && wpctl set-mute @DEFAULT_AUDIO_SINK@ 0

    wait $jpid
  `,
  );

  fs.rmSync(TMP_AUDIO, { force: true });
  if (fromTerminal) {
    await Bun.spawn(["bash", TMP_SCRIPT], { stdio: ["inherit", "inherit", "inherit"] }).exited;
  } else {
    // krohnkite floats windows of class "floating" (modules/desktop.nix).
    await $`wezterm --config initial_cols=50 --config initial_rows=15 --config font_size=15 start --always-new-process --class floating -- bash ${TMP_SCRIPT}`;
  }

  if (!fs.existsSync(TMP_AUDIO) || fs.statSync(TMP_AUDIO).size < MIN_AUDIO_BYTES) {
    throw new Error("Nothing was recorded (recording too short or ffmpeg failed).");
  }
  return transcribeAudio(TMP_AUDIO);
}

/**
 * Pastes the text in chunks with ctrl+shift+v, which also works in terminals.
 */
async function typeText(text: string) {
  const chunkSize = 30;
  // Linux key codes: 29 = left ctrl, 42 = left shift, 47 = v.
  const ctrlShiftV = ["29:1", "42:1", "47:1", "47:0", "42:0", "29:0"];

  for (let i = 0; i < text.length; i += chunkSize) {
    await $`wl-copy -- ${text.slice(i, i + chunkSize)}`;
    await $`ydotool key ${ctrlShiftV}`.quiet();
    await sleep(10);
  }
}

if (process.argv.length > 2) {
  const filepath = process.argv[2];
  if (!fs.existsSync(filepath)) {
    console.error("File not found:", filepath);
    process.exit(1);
  }
  console.log("Transcribing audio file:", filepath);
  console.log(await transcribeAudio(filepath));
  process.exit(0);
}

try {
  const text = await listenAndTranscribe();
  console.log(text);
  if (fromTerminal) await $`wl-copy -- ${text}`;
  else await typeText(text);
} catch (err) {
  console.error("Error:", err);
  await $`notify-send "Voice typing failed" ${String(err)}`.nothrow();
  process.exit(1);
}
