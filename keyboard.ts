#!/usr/bin/env bun

const MODIFIDERS: {
  rx: RegExp;
  replacement: string;
  mod: (keyCode: string) => Modifiers;
}[] = [
  {
    rx: /^(27-91-)(?:49-)?(\d+-)?59-5[0-6]-(\d+)$/,
    replacement: "$1$2$3",
    mod: (keyCode) => {
      const mods = {
        ctrl: false,
        shift: false,
        alt: false,
      };
      const match = keyCode.match(/^(?:\d+-){4}5(?<k>[0-6])-\d+$/);
      if (!match || !("groups" in match)) mods;
      const k = Number(match!.groups!.k) + 1;
      return {
        shift: !!((k >> 0) % 2),
        alt: !!((k >> 1) % 2),
        ctrl: !!((k >> 2) % 2),
      };
    },
  },
  {
    rx: /^27-(\d+)$/,
    replacement: "$1",
    mod: () => ({ ctrl: false, shift: false, alt: true }),
  },
];

const KEYCODES: Record<
  string,
  string | { ctrl?: boolean; shift?: boolean; key: string }
> = {
  "9": "tab",
  "13": "return",
  "127": "backspace",
  "27": "escape",

  "27-91-90": { shift: true, key: "tab" },
  "6-32-13": { ctrl: true, key: "return" },
  "27-91-77": { ctrl: true, key: "delete" },

  "27-91-65": "up",
  "27-91-66": "down",
  "27-91-67": "right",
  "27-91-68": "left",

  "27-91-51-126": "delete",
  "27-91-70": "end",
  "27-91-72": "home",
  "27-91-54-126": "pgdown",
  "27-91-53-126": "pgup",

  "27-79-80": "f1",
  "27-79-81": "f2",
  "27-79-82": "f3",
  "27-79-83": "f4",

  // With modifiers
  "27-91-80": "f1",
  "27-91-81": "f2",
  "27-91-82": "f3",
  "27-91-83": "f4",

  "27-91-49-53-126": "f5",
  "27-91-49-55-126": "f6",
  "27-91-49-56-126": "f7",
  "27-91-49-57-126": "f8",
  "27-91-50-48-126": "f9",
  "27-91-50-49-126": "f10",
  "27-91-50-51-126": "f11",
  "27-91-50-52-126": "f12",
};

export type Modifiers = {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

export type Key = Modifiers & {
  key: string;
};

function buffToCode(buff: Buffer): string {
  const res = [] as string[];
  let num = 0;
  while (true) {
    try {
      res.push(String(buff.readIntBE(num, 1)));
    } catch (err) {
      return res.join("-");
    }
    num++;
  }
}

export type KbSubscription = {
  id: number;
  unsubscribe: () => void;
};

export class Keyboard {
  static _instance: null | Keyboard = null;
  listening = false;
  callback: null | ((k: Key) => unknown) = null;
  subscriptions: {
    fn: (k: Key) => unknown;
    id: number;
  }[] = [];

  static getInstance(): Keyboard {
    if (!this._instance) this._instance = new Keyboard();
    return this._instance;
  }

  /**
   * Returns an array of all the received keys.
   * Most of the time, it will be just one key, but if the user mashes keys,
   * some keys might be received in the same packet, in which case, this function
   * will return all the mashed keys.
   */
  private async getOneKey(): Promise<Key[] | null> {
    if (!this.listening) return Promise.resolve(null);

    return new Promise<string>((resolve, reject) => {
      const handleData = (data: Buffer) => {
        // Remove event listener to prevent memory leaks
        process.stdin.removeListener("data", handleData);

        if (!this.subscriptions.length) {
          return reject();
        }

        // Check for Ctrl+C without converting to array first
        if (data.length > 0 && data[0] === 3) {
          console.log("^C");
          process.exit(1);
        }

        resolve(buffToCode(data));
      };

      process.stdin.once("data", handleData);
    }).then((keyCode) => {
      const mods: Modifiers = { shift: false, ctrl: false, alt: false };

      for (let i = 0; i < MODIFIDERS.length; i++) {
        const modifier = MODIFIDERS[i];
        if (modifier.rx.test(keyCode)) {
          Object.assign(mods, modifier.mod(keyCode));
          keyCode = keyCode.replace(modifier.rx, modifier.replacement);
        }
      }

      // Direct object lookup for exact matches
      if (KEYCODES.hasOwnProperty(keyCode)) {
        const key = KEYCODES[keyCode];
        if (typeof key === "string") {
          return [{ ...mods, key }];
        } else {
          return [{ ...mods, ...key }];
        }
      }

      if (keyCode.indexOf("-") === -1) {
        // Handle single keycode case directly without splitting
        return [this.handleSingleKeyCode(keyCode, mods)];
      } else {
        // Handle multiple keycodes
        const keyCodes = keyCode.split("-");
        const keys: Key[] = new Array(keyCodes.length);

        for (let i = 0; i < keyCodes.length; i++) {
          keys[i] = this.handleSingleKeyCode(keyCodes[i], { ...mods });
        }

        return keys;
      }
    });
  }

  private handleSingleKeyCode(keyCode: string, mods: Modifiers): Key {
    // Normal printable characters
    let cara = String.fromCharCode(Number(keyCode));

    // Use RegExp.prototype.test instead of regex matching when possible
    if (/^[^\x00-\x1F\x80-\x9F]+$/.test(cara)) {
      if (cara >= "A" && cara <= "Z") {
        // Faster than regex for A-Z
        mods.shift = true;
        cara = cara.toLowerCase();
      }
      return { ...mods, key: cara };
    }

    const keyCodeNum = Number(keyCode);
    if (keyCodeNum) {
      cara = String.fromCharCode(keyCodeNum + 96);
      if (cara >= "a" && cara <= "z") {
        // Faster than regex for a-z
        mods.ctrl = true;
        return { ...mods, key: cara };
      }
    }

    return { ...mods, key: keyCode };
  }

  generateUnusedId(): number {
    let id = Math.floor(Math.random() * 1000);
    while (this.subscriptions.some((s) => s.id === id)) {
      id = Math.floor(Math.random() * 1000);
    }
    return id;
  }

  /**
   * To start receiving keys again after you called `stopListening`.
   */
  async startListening() {
    if (!this.subscriptions.length) return;

    this.listening = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let startTime = Date.now();
    try {
      while (true) {
        if (!this.subscriptions.length) {
          this.stopListening();
          break;
        }

        try {
          const keys = await this.getOneKey();
          if (!keys) break;

          if (Date.now() - startTime < 10) {
            // This is probably keys which were sent before the subscription was created, and which were kept in the buffer.
            // We don't do anything with them.
            continue;
          }

          if (!this.listening) {
            // Re-sending the intercepted key
            for (const key of keys)
              process.stdin.emit("data", Buffer.from(key.key));
            break;
          }

          for (const key of keys)
            this.subscriptions[this.subscriptions.length - 1].fn(key);
        } catch (err) {
          break;
        }
      }
    } finally {
      this.listening = false;
      if (!this.subscriptions.length) this.stopListening();
    }
  }

  /**
   * To listen for key presses.
   *
   * If someone else subscribes after you, you will stop receiving keys as long as the other subscriber is active.
   */
  subscribe(cb: (k: Key) => unknown): KbSubscription {
    const id = this.generateUnusedId();

    const sub = {
      id,
      unsubscribe: () => {
        this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
        if (!this.subscriptions.length) this.stopListening();
      },
    };

    this.subscriptions.push({ id, fn: cb });

    if (this.listening) return sub;

    this.startListening();
    return sub;
  }

  /**
   * Listen for one key press.
   * The pressed key will ONLY be given here, all other listeners won't see it.
   */
  subscribeToOneKey(): Promise<Key> {
    return new Promise((resolve) => {
      const sub = this.subscribe((key) => {
        resolve(key);
        sub.unsubscribe();
      });
    });
  }

  /**
   * @deprecated Use `subscribe` instead.
   */
  async onKeyPress(cb: (k: Key) => unknown): Promise<void> {
    this.subscriptions.push({ id: this.generateUnusedId(), fn: cb });

    if (this.listening) return;
    await this.startListening();
  }

  /**
   * To stop receiving keys.
   */
  stopListening(): void {
    this.listening = false;

    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeAllListeners("data");
  }
}

if (/keyboard.ts/.test(process.argv[1])) {
  const kb = Keyboard.getInstance();
  kb.subscribe((evt) => {
    let str = "";
    if (evt.ctrl) str += "ctrl+";
    if (evt.shift) str += "shift+";
    if (evt.alt) str += "alt+";
    console.log(str + evt.key);
  });
}
