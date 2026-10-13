// Putting a site bundle on a Windows server over SSH: what to upload where, and the one
// command to run there. This builds the commands and sequences them; it does not run
// them (scripts/deploy.mjs hands in the function that does), so the commands can be tested.
//
// The server side is prestige-nginx's deploy-site.ps1. A Windows OpenSSH server runs a
// command through `cmd.exe /c <command>`, so every command here starts with `powershell`
// (not a quote, which cmd would treat specially) and quotes each path with double quotes.
// Nothing taken from a bundle or a user goes into a command line: only paths from .env,
// checked against a short list of safe characters, and a SHA-256 checked to be 64 hex digits.

import { basename, dirname } from "node:path";

export type DeployTarget = "staging" | "production";

export interface DeployConfig {
  /** What `ssh` takes: user@host, or a Host alias from ~/.ssh/config. */
  host: string;
  port?: string;
  keyFile?: string;
  /** The server's folder holding deploy-site.ps1 and the lspd-backend env files. Forward slashes. */
  remoteScripts: string;
  /** The server's folder bundles are uploaded to. Forward slashes. */
  remoteDrop: string;
}

/** Runs ssh or scp with these arguments, showing its output, and says how it exited. */
export type Exec = (program: "ssh" | "scp", args: string[], options?: { cwd?: string }) => Promise<number>;

export const DEPLOY_SETTINGS: readonly { name: string; what: string }[] = [
  { name: "DEPLOY_SSH_HOST", what: "the server, as ssh takes it: user@203.0.113.7, or a Host alias from ~/.ssh/config" },
  { name: "DEPLOY_REMOTE_SCRIPTS", what: "the folder on the server that holds deploy-site.ps1 (prestige-nginx/deploy/windows), e.g. C:/prestige-nginx/deploy/windows" },
  { name: "DEPLOY_REMOTE_DROP", what: "a folder on the server for uploaded bundles, e.g. D:/deploy-drop (it must exist)" },
];

// Letters, digits, space and  _ . ( ) - / \ :  (a drive letter). Nothing cmd.exe or PowerShell would act on.
const SAFE_REMOTE_PATH = /^[A-Za-z0-9 _.()\-/\\:]+$/;
const SAFE_HOST = /^[A-Za-z0-9._@\-[\]:]+$/;

function remotePath(value: string, setting: string): string {
  if (!SAFE_REMOTE_PATH.test(value)) {
    throw new Error(`${setting} '${value}' has a character that is not allowed in a server path (use letters, digits, spaces and _ . ( ) - / only).`);
  }
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function loadDeployConfig(env: Record<string, string | undefined>): DeployConfig {
  const missing = DEPLOY_SETTINGS.filter((setting) => !env[setting.name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      "npm run deploy needs these settings in .env (see .env.example):\n" + missing.map((s) => `  ${s.name}  ${s.what}`).join("\n"),
    );
  }
  const host = env.DEPLOY_SSH_HOST!.trim();
  if (host.startsWith("-") || !SAFE_HOST.test(host)) throw new Error(`DEPLOY_SSH_HOST '${host}' is not a host ssh could take (user@host, or a Host alias).`);
  const port = env.DEPLOY_SSH_PORT?.trim();
  if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) throw new Error(`DEPLOY_SSH_PORT '${port}' is not a port number.`);
  const keyFile = env.DEPLOY_SSH_KEY?.trim();
  if (keyFile?.startsWith("-")) throw new Error(`DEPLOY_SSH_KEY '${keyFile}' is not a file path.`);
  return {
    host,
    port: port || undefined,
    keyFile: keyFile || undefined,
    remoteScripts: remotePath(env.DEPLOY_REMOTE_SCRIPTS!.trim(), "DEPLOY_REMOTE_SCRIPTS"),
    remoteDrop: remotePath(env.DEPLOY_REMOTE_DROP!.trim(), "DEPLOY_REMOTE_DROP"),
  };
}

/** The name an uploaded bundle gets on the server: its own name, made safe, plus the start of its hash so two never collide. */
export function remoteBundleName(localName: string, sha256: string): string {
  assertSha256(sha256);
  const stem = localName.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_") || "bundle";
  return `${stem}-${sha256.slice(0, 8)}.zip`;
}

function assertSha256(sha256: string) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Not a SHA-256 (64 lowercase hex digits).");
}

const quote = (value: string) => `"${value}"`;

function powershellFile(config: DeployConfig, script: string, args: string[]): string {
  return ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", quote(`${config.remoteScripts}/${script}`), ...args].join(" ");
}

function envFileName(target: DeployTarget): string {
  return target === "production" ? "lspd-backend.env" : "lspd-backend.staging.env";
}

/** The command that unpacks, checks and deploys an uploaded bundle. With dryRun it only checks (-WhatIf). */
export function deployCommand(config: DeployConfig, target: DeployTarget, remoteZip: string, sha256: string, dryRun = false): string {
  assertSha256(sha256);
  const args = ["-Zip", quote(remoteZip), "-Sha256", sha256, "-EnvFile", quote(`${config.remoteScripts}/${envFileName(target)}`)];
  args.push(...(dryRun ? ["-WhatIf"] : ["-LogFile", quote(`${config.remoteScripts}/deploy-history.log`)]));
  return powershellFile(config, "deploy-site.ps1", args);
}

/** The command that says whether the server is set up for deploys, changing nothing. */
export function checkCommand(config: DeployConfig, target: DeployTarget): string {
  return powershellFile(config, "deploy-site.ps1", ["-Check", "-EnvFile", quote(`${config.remoteScripts}/${envFileName(target)}`)]);
}

/** Fails (non-zero) if the file is not there, which is how a check proves an upload landed. */
export function removeCommand(path: string): string {
  return `powershell -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath '${path}' -ErrorAction Stop"`;
}

function connectionOptions(config: DeployConfig, portFlag: "-p" | "-P"): string[] {
  const options = ["-o", "ConnectTimeout=15"];
  if (config.port) options.push(portFlag, config.port);
  if (config.keyFile) options.push("-i", config.keyFile);
  return options;
}

export function sshArgs(config: DeployConfig, remoteCommand: string): string[] {
  return [...connectionOptions(config, "-p"), config.host, remoteCommand];
}

/** scp is run from the file's own folder with its bare name: a Windows path like C:\x would read as host "C". */
export function scpArgs(config: DeployConfig, localName: string, remoteFile: string): string[] {
  return [...connectionOptions(config, "-P"), localName, `${config.host}:${remoteFile}`];
}

/** Uploads the bundle, then runs the deploy there. Returns the server's exit code (0 is deployed). */
export async function deployBundle(
  config: DeployConfig,
  target: DeployTarget,
  bundle: { file: string; sha256: string },
  exec: Exec,
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<number> {
  const log = options.log ?? (() => {});
  const localName = basename(bundle.file);
  const remoteFile = `${config.remoteDrop}/${remoteBundleName(localName, bundle.sha256)}`;

  log(`Uploading ${localName} to ${config.host}:${remoteFile}`);
  const upload = await exec("scp", scpArgs(config, localName, remoteFile), { cwd: dirname(bundle.file) });
  if (upload !== 0) {
    throw new Error(`Uploading the bundle failed (scp exited ${upload}). Nothing was deployed. 'npm run deploy -- check ${target}' tests each step of the connection.`);
  }
  log(options.dryRun ? `Checking it on the server (dry run, nothing will change)` : `Deploying it on the server (${target})`);
  return exec("ssh", sshArgs(config, deployCommand(config, target, remoteFile, bundle.sha256, options.dryRun)));
}

/**
 * Tests each step a deploy needs, in order, and stops at the first that fails, naming it:
 * the login, an upload landing in the drop folder, then deploy-site.ps1 -Check on the server.
 * `localFile` is a small file to upload and remove again.
 */
export async function checkServer(
  config: DeployConfig,
  target: DeployTarget,
  localFile: string,
  exec: Exec,
  log: (line: string) => void = () => {},
): Promise<void> {
  const fail = (step: string, code: number, hint: string) => {
    throw new Error(`${step} failed (exit ${code}). ${hint}`);
  };
  const localName = basename(localFile);
  const remoteFile = `${config.remoteDrop}/${localName}`;

  log(`1/4 Logging in to ${config.host}`);
  let code = await exec("ssh", sshArgs(config, "echo connected"));
  if (code !== 0) fail("Logging in", code, "Check DEPLOY_SSH_HOST, the key (DEPLOY_SSH_KEY), that sshd is running on the server and that its port is open to you.");

  log(`2/4 Uploading a test file to ${remoteFile}`);
  code = await exec("scp", scpArgs(config, localName, remoteFile), { cwd: dirname(localFile) });
  if (code !== 0) fail("Uploading", code, "The login worked, so look at DEPLOY_REMOTE_DROP: the folder must exist on the server and be writable by that account. If scp rejects a path like D:/drop, try /D:/drop.");

  log("3/4 Checking it arrived, and removing it");
  code = await exec("ssh", sshArgs(config, removeCommand(remoteFile)));
  if (code !== 0) fail("Finding the uploaded file", code, "scp said it uploaded it, but it is not at DEPLOY_REMOTE_DROP on the server. Check that the path means the same folder to scp and to PowerShell.");

  log(`4/4 Checking the server's deploy settings (${target})`);
  code = await exec("ssh", sshArgs(config, checkCommand(config, target)));
  if (code !== 0) fail("The server's own check", code, "Read its message above: DEPLOY_REMOTE_SCRIPTS may be wrong, or the env file is incomplete.");
}
