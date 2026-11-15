import os from "node:os";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import nodemailer from "nodemailer";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Ejecuta este comando en una Terminal interactiva para que la clave no aparezca en pantalla.");
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
const email = String(await questions.question("Correo remitente de Google Workspace o Gmail: ")).trim().toLowerCase();
questions.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("El correo no es válido.");
const password = String(await hiddenQuestion("Contraseña de aplicación de Google (no se mostrará): ")).replace(/\s+/g, "");
if (password.length < 12) throw new Error("La contraseña de aplicación parece incompleta.");

const configuration = {
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  user: email,
  password,
  from: `Jokma Pulse <${email}>`,
};
const transport = nodemailer.createTransport({
  host: configuration.host,
  port: configuration.port,
  secure: configuration.secure,
  auth: { user: configuration.user, pass: configuration.password },
});
await transport.verify();

const saved = spawnSync("/usr/bin/security", [
  "add-generic-password",
  "-U",
  "-a",
  os.userInfo().username,
  "-s",
  "app.jokma.pulse.recovery-smtp",
  "-w",
  JSON.stringify(configuration),
], { encoding: "utf8", stdio: "pipe" });
if (saved.status !== 0) throw new Error("No se pudo guardar la configuración en el llavero de macOS.");

const restarted = spawnSync("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/app.jokma.pulse`], { encoding: "utf8" });
if (restarted.status !== 0) throw new Error("La configuración se guardó, pero Pulse no pudo reiniciarse automáticamente.");
console.log("SMTP verificado, guardado en el llavero y activado en Jokma Pulse.");
