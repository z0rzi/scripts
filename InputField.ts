import { KbSubscription, Key, Keyboard } from "./keyboard";
import child_process from "child_process";

export class InputField {
  input = "";

  /** idx of the carret in the search string */
  carret = 0;

  protected kb = Keyboard.getInstance();
  private kbSub: KbSubscription;

  constructor(
    private prompt: string,
    private returnCb: (input: string) => void
  ) {
    // Removing cursor
    process.stdout.write("\x1B[?25l");
    process.on("exit", () => {
      process.stdout.write("\x1B[?25h");
    });

    console.clear();
    process.stdout.write(prompt + "█");

    this.kbSub = this.kb.subscribe((evt) => {
      this.onKeyHit(evt);
    });
  }

  left() {
    if (this.carret > 0) this.carret--;
  }

  right() {
    if (this.carret < this.input.length) this.carret++;
  }

  protected handleKey(evt: Key) {
    if (
      (evt.ctrl && (evt.key === "c" || evt.key === "d")) ||
      evt.key === "escape"
    ) {
      process.exit(1);
    }

    if (evt.ctrl) {
      if (evt.key === "a") this.carret = 0;
      if (evt.key === "e") this.carret = this.input.length;
      if (evt.key === "u") {
        // Removes everything before the carret, keeps what's after
        this.input = this.input.substring(this.carret);
        this.carret = 0;
      }
      if (evt.key === "v") {
        const clipContent = child_process.execSync("wl-paste --no-newline").toString();
        this.input =
          this.input.substring(0, this.carret) +
          clipContent +
          this.input.substring(this.carret);
        this.carret += clipContent.length;
      }
      if (evt.key === "w" || evt.key === "h") {
        // 'h' because on `st`, <C-w> is perceived as <C-h>...
        // Removes the word before the carret, keeps what's after
        const after = this.input.substring(this.carret);
        let before = this.input.substring(0, this.carret);

        while (before.endsWith(" ")) before = before.slice(0, -1);
        const lastSpace = before.lastIndexOf(" ");
        before = lastSpace === -1 ? "" : before.slice(0, lastSpace + 1);

        this.input = before + after;
        this.carret = before.length;
      }
    } else if (evt.key.length > 1) {
      if (evt.key === "backspace") {
        this.input =
          this.input.substring(0, this.carret - 1) +
          this.input.substring(this.carret);
        if (this.carret > 0) this.carret--;
      }
      if (evt.key === "delete") {
        this.input =
          this.input.substring(0, this.carret) +
          this.input.substring(this.carret + 1);
      }
      if (evt.key === "return") {
        this.returnCb(this.input);
      }
      if (evt.key === "left") {
        this.left();
      }
      if (evt.key === "right") {
        this.right();
      }
    } else {
      let cara = evt.key;
      if (evt.shift) cara = cara.toUpperCase();

      this.input =
        this.input.substring(0, this.carret) +
        cara +
        this.input.substring(this.carret);
      this.carret++;
    }
  }

  protected onKeyHit(evt: Key) {
    this.handleKey(evt);

    this.draw();
  }

  public async draw() {
    console.clear();
    const str =
      this.prompt +
      this.input.slice(0, this.carret) +
      "\x1B[7m" +
      (this.input[this.carret] || " ") +
      "\x1B[0m" +
      this.input.slice(this.carret + 1);
    console.log(str);
  }

  destroy() {
    this.kbSub.unsubscribe();
  }
}

export async function promptText(prompt: string, defaultValue = ""): Promise<string> {
  return new Promise((resolve, reject) => {
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

export async function promptConfirm(prompt: string): Promise<boolean> {
  let text = prompt + " (y/n) ";
  let answer = await promptText(text);
  while (answer !== "y" && answer !== "n") {
    text += answer + "\nPlease, answer with (y/n) ";
    answer = await promptText(text);
  }
  return answer === "y";
}
