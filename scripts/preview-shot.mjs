// Screenshots of the preview instance (scripts/preview-instance.mjs), signed in.
//
//   node scripts/preview-shot.mjs login admin
//   node scripts/preview-shot.mjs login wael@preview.local
//   node scripts/preview-shot.mjs shot --as admin --url /admin/tasks --out out/tasks.png
//   node scripts/preview-shot.mjs batch shots.json
//
// `login` signs in through the real form with the throwaway sign-ins in
// .preview/creds.json and keeps the session cookie in .preview/cookies-<who>.json.
// `shot` starts its own headless Chrome with a fresh profile and that cookie, so
// any number of them can run at once.
//
// Options of a shot (flags on the command line, keys in a batch file):
//   as      admin | <team e-mail or its first part, e.g. wael> | none   (default none)
//   url     a path on the preview, or a full address
//   out     where the PNG goes (folders are made)
//   w, h    viewport (default 1440x900; with mobile 390x844 at 2x)
//   mobile  a phone-sized, touch-style viewport
//   full    grow the viewport to the page's whole height (the shells scroll inside
//           themselves, so an ordinary full-page capture would miss everything below)
//   scroll  scroll the page's own scroll container this many pixels first
//   wait    milliseconds to let the page settle after load (default 2000)
//   css     a CSS file injected after the page's own styles — to try a look
//           without touching the working tree
//   theme   sets data-theme on <html> and on every element that carries one
//   click   a CSS selector clicked before the capture (to open a dialog)
//   eval    JavaScript evaluated in the page; its value is printed as JSON
//
// It talks to Chrome over the DevTools protocol directly: nothing to install.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".preview");
const credsFile = path.join(dir, "creds.json");
if (!existsSync(credsFile)) {
  console.error("No preview yet: run `node scripts/preview-instance.mjs setup` and `start` first.");
  process.exit(1);
}
const creds = JSON.parse(readFileSync(credsFile, "utf8"));
const ORIGIN = creds.url;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => existsSync(candidate));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The address for a path on the preview.
 *
 * Git Bash rewrites an argument that starts with "/" into a Windows path
 * ("/employee" arrives as "C:/Program Files/Git/employee"), so that prefix is
 * taken back off, and a path may also be given without its leading slash.
 */
function address(url) {
  if (/^https?:/.test(url)) return url;
  const path = String(url).replace(/^[A-Za-z]:[\\/]Program Files[\\/]Git/i, "").replace(/\\/g, "/");
  return ORIGIN + (path.startsWith("/") ? path : `/${path}`);
}
const who = (name) => (name === "admin" ? "admin" : String(name).split("@")[0].toLowerCase());
const cookieFile = (name) => path.join(dir, `cookies-${who(name)}.json`);

async function withBrowser(run) {
  if (!CHROME) throw new Error("Chrome or Edge was not found on this PC.");
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(path.join(tmpdir(), "neon-preview-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    let target;
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find((entry) => entry.type === "page");
      } catch {
        // Not listening yet.
      }
    }
    if (!target) throw new Error("Chrome did not start.");

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", () => reject(new Error("Could not reach Chrome.")));
    });

    let id = 0;
    const pending = new Map();
    const waiters = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        for (const waiter of [...waiters]) {
          if (waiter.method !== message.method) continue;
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message.params);
        }
      }
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const once = (method, timeout) =>
      new Promise((resolve) => {
        const waiter = { method, resolve };
        waiters.push(waiter);
        // unref: a timer still pending must not keep the process alive for two
        // minutes after the work is done.
        setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) {
            waiters.splice(at, 1);
            resolve(null);
          }
        }, timeout).unref();
      });
    const evaluate = async (expression) => {
      const answer = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (answer.exceptionDetails) {
        throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
      }
      return answer.result.value;
    };
    const go = async (url, wait) => {
      const loaded = once("Page.loadEventFired", 120_000);
      await send("Page.navigate", { url: address(url) });
      await loaded;
      await sleep(wait);
    };

    await send("Page.enable");
    await send("Network.enable");
    await send("Runtime.enable");
    // The client page's welcome screen (components/client/welcome-overlay.tsx)
    // never lifts under `next dev`: Strict Mode runs its effect twice, the second
    // run finds the "already welcomed" flag the first one set, returns before
    // starting the timer, and the screen stays up. The live site runs it once.
    // Every page here is therefore told the client has been welcomed already.
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        try {
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            return String(key).startsWith("neon-welcomed-") ? "1" : get.call(this, key);
          };
        } catch {}
      })();`,
    });
    return await run({ send, evaluate, go });
  } finally {
    chrome.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a file for a moment; the temp folder is the system's to clear.
    }
  }
}

async function login(name) {
  const admin = name === "admin";
  const member = admin ? null : creds.team.find((person) => person.email === name || who(person.email) === who(name));
  if (!admin && !member) throw new Error(`Nobody called ${name} in .preview/creds.json.`);

  await withBrowser(async ({ send, evaluate, go }) => {
    await go(admin ? "/admin/login" : "/employee/login", 3000);
    await evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const fill = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) return;
        set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      fill('input[name="email"]', ${JSON.stringify(member?.email ?? "")});
      fill('input[name="password"]', ${JSON.stringify(creds.password)});
      document.querySelector('input[name="password"]').form.requestSubmit();
    })()`);

    let at = "";
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      at = await evaluate("location.pathname");
      if (!at.endsWith("/login")) break;
    }
    if (at.endsWith("/login")) {
      throw new Error(`Sign-in did not go through: ${await evaluate("document.body.innerText.slice(0, 200)")}`);
    }

    const { cookies } = await send("Network.getCookies", { urls: [ORIGIN] });
    writeFileSync(
      cookieFile(name),
      JSON.stringify(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          expires: cookie.expires,
        }))
      )
    );
    console.log(`signed in as ${who(name)} — landed on ${at}`);
  });
}

const MEASURE = `(() => {
  const inner = document.querySelector(".employee-main") || document.querySelector(".admin-shell main");
  if (inner) return Math.ceil(inner.scrollHeight + (window.innerHeight - inner.clientHeight));
  return Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
})()`;

async function shoot({ send, evaluate, go }, shot) {
  const width = Number(shot.w ?? (shot.mobile ? 390 : 1440));
  const height = Number(shot.h ?? (shot.mobile ? 844 : 900));
  const metrics = (tall) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height: tall,
      deviceScaleFactor: shot.mobile ? 2 : 1,
      mobile: Boolean(shot.mobile),
    });

  await metrics(height);
  await send("Network.clearBrowserCookies");
  if (shot.as && shot.as !== "none") {
    const file = cookieFile(shot.as);
    if (!existsSync(file)) throw new Error(`Not signed in as ${shot.as}: run \`preview-shot.mjs login ${shot.as}\` first.`);
    await send("Network.setCookies", { cookies: JSON.parse(readFileSync(file, "utf8")) });
  }

  await go(shot.url, Number(shot.wait ?? 2000));

  const css = shot.css ? readFileSync(path.resolve(shot.css), "utf8") : "";
  await evaluate(`(() => {
    const add = (id, text) => {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = text;
      document.head.appendChild(style);
    };
    // Next's own development badge and toasts are not part of the page.
    add("preview-hide-dev", "nextjs-portal, [data-next-badge-root], [data-nextjs-toast] { display: none !important; }");
    const css = ${JSON.stringify(css)};
    if (css) add("preview-injected", css);
    const theme = ${JSON.stringify(shot.theme ?? "")};
    if (theme) {
      document.querySelectorAll("[data-theme]").forEach((element) => element.setAttribute("data-theme", theme));
      document.documentElement.setAttribute("data-theme", theme);
    }
  })()`);
  await sleep(400);

  if (shot.click) {
    await evaluate(`document.querySelector(${JSON.stringify(shot.click)})?.click()`);
    await sleep(900);
  }
  if (shot.eval) {
    console.log(JSON.stringify({ url: shot.url, value: await evaluate(shot.eval) }));
  }
  if (shot.full) {
    const whole = await evaluate(MEASURE);
    await metrics(Math.min(Math.max(whole, height), 7000));
    await sleep(1400);
  }
  if (shot.scroll) {
    await evaluate(`(() => {
      const inner = document.querySelector(".employee-main") || document.querySelector(".admin-shell main");
      (inner || document.scrollingElement).scrollTo(0, ${Number(shot.scroll)});
      window.scrollTo(0, ${Number(shot.scroll)});
    })()`);
    await sleep(700);
  }
  if (shot.out) {
    const out = path.resolve(shot.out);
    mkdirSync(path.dirname(out), { recursive: true });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(out, Buffer.from(data, "base64"));
    console.log(`saved ${out}`);
  }
}

function flags(args) {
  const shot = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (key === "mobile" || key === "full") shot[key] = true;
    else shot[key] = args[++i];
  }
  return shot;
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "login") {
    await login(rest[0] ?? "admin");
  } else if (command === "shot") {
    await withBrowser((browser) => shoot(browser, flags(rest)));
  } else if (command === "batch") {
    const shots = JSON.parse(readFileSync(path.resolve(rest[0]), "utf8"));
    let failed = 0;
    await withBrowser(async (browser) => {
      for (const shot of shots) {
        try {
          await shoot(browser, shot);
        } catch (error) {
          failed += 1;
          console.error(`failed ${shot.url}: ${error.message}`);
        }
      }
    });
    if (failed) process.exitCode = 1;
  } else {
    console.error("usage: preview-shot.mjs login <admin|email> | shot --as … --url … --out … | batch shots.json");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
// Chrome's pipes and any timer still pending would otherwise hold the process open.
process.exit(process.exitCode ?? 0);
