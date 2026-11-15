import os from "node:os";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Ejecuta este comando en una Terminal interactiva para que el secreto no aparezca en pantalla.");
}

function hiddenQuestion(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish();
        reject(new Error("Configuración cancelada."));
        return;
      }
      if (character === "\r" || character === "\n") {
        finish();
        resolve(value);
        return;
      }
      if (character === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    };
    input.on("data", onData);
  });
}

const questions = readline.createInterface({ input: process.stdin, output: process.stdout });
const enteredId = String(await questions.question("Identificador de la app de Meta [1036513856135777]: ")).trim();
questions.close();
const appId = enteredId || "1036513856135777";
if (!/^\d{6,30}$/.test(appId)) throw new Error("El identificador de la app no es válido.");
const appSecret = String(await hiddenQuestion("Secreto de la app de Meta (no se mostrará): ")).trim();
if (appSecret.length < 20) throw new Error("El secreto de la app parece incompleto.");

const target = new URL(`https://graph.facebook.com/v27.0/${appId}`);
target.searchParams.set("fields", "id,name");
const response = await fetch(target, {
  headers: { authorization: `Bearer ${appId}|${appSecret}` },
  redirect: "manual",
  signal: AbortSignal.timeout(8000),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok || String(payload.id || "") !== appId) throw new Error("Meta rechazó el identificador o el secreto de la app.");

const saved = spawnSync("/usr/bin/security", [
  "add-generic-password",
  "-U",
  "-a",
  os.userInfo().username,
  "-s",
  "app.jokma.pulse.meta-app",
  "-w",
  JSON.stringify({ appId, appSecret }),
], { encoding: "utf8", stdio: "pipe" });
if (saved.status !== 0) throw new Error("No se pudo guardar la app de Meta en el llavero de macOS.");

const restarted = spawnSync("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/app.jokma.pulse`], { encoding: "utf8" });
if (restarted.status !== 0) throw new Error("La configuración se guardó, pero Pulse no pudo reiniciarse automáticamente.");
console.log("App de Meta verificada, guardada en el llavero y activada en Jokma Pulse.");
