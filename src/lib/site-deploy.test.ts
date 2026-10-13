import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  type DeployConfig,
  type Exec,
  checkCommand,
  checkServer,
  deployBundle,
  deployCommand,
  loadDeployConfig,
  remoteBundleName,
  removeCommand,
  scpArgs,
  sshArgs,
} from "./site-deploy.ts";

const HASH = "4f7e3aba349d9798c1cd6ba2d0dd50e46db58da28bf5d48d3c19b34016e78490";
const BASE_ENV = { DEPLOY_SSH_HOST: "deploy@203.0.113.7", DEPLOY_REMOTE_SCRIPTS: "C:/prestige-nginx/deploy/windows", DEPLOY_REMOTE_DROP: "D:/deploy-drop" };
const CONFIG: DeployConfig = { host: "deploy@203.0.113.7", remoteScripts: "C:/prestige-nginx/deploy/windows", remoteDrop: "D:/deploy-drop" };

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

describe("loadDeployConfig", () => {
  it("reads the three required settings and the optional ones", () => {
    assert.deepEqual(loadDeployConfig(BASE_ENV), { host: "deploy@203.0.113.7", port: undefined, keyFile: undefined, remoteScripts: "C:/prestige-nginx/deploy/windows", remoteDrop: "D:/deploy-drop" });
    const full = loadDeployConfig({ ...BASE_ENV, DEPLOY_SSH_PORT: "2222", DEPLOY_SSH_KEY: "C:/Users/me/.ssh/id_ed25519" });
    assert.equal(full.port, "2222");
    assert.equal(full.keyFile, "C:/Users/me/.ssh/id_ed25519");
  });

  it("names every missing setting at once, and where to set it", () => {
    assert.throws(() => loadDeployConfig({}), (error: Error) =>
      /\.env/.test(error.message) && /DEPLOY_SSH_HOST/.test(error.message) && /DEPLOY_REMOTE_SCRIPTS/.test(error.message) && /DEPLOY_REMOTE_DROP/.test(error.message));
    assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_REMOTE_DROP: "  " }), /DEPLOY_REMOTE_DROP/);
  });

  it("writes server paths with forward slashes and no trailing slash", () => {
    const config = loadDeployConfig({ ...BASE_ENV, DEPLOY_REMOTE_SCRIPTS: "C:\\prestige-nginx\\deploy\\windows\\", DEPLOY_REMOTE_DROP: "D:/deploy drop//" });
    assert.equal(config.remoteScripts, "C:/prestige-nginx/deploy/windows");
    assert.equal(config.remoteDrop, "D:/deploy drop");
  });

  it("refuses anything a command line could act on", () => {
    for (const bad of ['C:/a"b', "C:/a%PATH%", "C:/a&b", "C:/a|b", "C:/a^b", "C:/a$b", "C:/a;b", "C:/a'b", "C:/a`b", "C:/a<b", "C:/a>b", "C:/a!b", "C:/a\nb"]) {
      assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_REMOTE_DROP: bad }), /not allowed in a server path/, JSON.stringify(bad));
      assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_REMOTE_SCRIPTS: bad }), /not allowed in a server path/, JSON.stringify(bad));
    }
    for (const host of ["-oProxyCommand=x", "a b", "a;b", "a$(x)", "a`x`"]) {
      assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_SSH_HOST: host }), /not a host/, host);
    }
    for (const port of ["0", "65536", "22a", "-1", "ssh"]) {
      assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_SSH_PORT: port }), /not a port/, port);
    }
    assert.throws(() => loadDeployConfig({ ...BASE_ENV, DEPLOY_SSH_KEY: "-oFoo" }), /not a file path/);
  });
});

describe("remoteBundleName", () => {
  it("keeps the name, makes it safe and adds the start of the hash", () => {
    assert.equal(remoteBundleName("egov-20261013-153000.zip", HASH), "egov-20261013-153000-4f7e3aba.zip");
    assert.equal(remoteBundleName("my bundle (1).ZIP", HASH), "my_bundle__1_-4f7e3aba.zip");
    assert.equal(remoteBundleName("..hidden.zip", HASH), "_hidden-4f7e3aba.zip");
    assert.equal(remoteBundleName(".zip", HASH), "bundle-4f7e3aba.zip");
  });

  it("refuses a hash that is not one", () => {
    for (const bad of ["", "abc", HASH.toUpperCase(), HASH + "0", `${HASH.slice(0, 63)};`]) {
      assert.throws(() => remoteBundleName("a.zip", bad), /Not a SHA-256/, bad);
    }
  });
});

describe("commands", () => {
  it("deploy: the script, the bundle, its hash, the env file for the target and the history log", () => {
    assert.equal(
      deployCommand(CONFIG, "staging", "D:/deploy-drop/egov-1-4f7e3aba.zip", HASH),
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/prestige-nginx/deploy/windows/deploy-site.ps1" ` +
        `-Zip "D:/deploy-drop/egov-1-4f7e3aba.zip" -Sha256 ${HASH} -EnvFile "C:/prestige-nginx/deploy/windows/lspd-backend.staging.env" ` +
        `-LogFile "C:/prestige-nginx/deploy/windows/deploy-history.log"`,
    );
    assert.match(deployCommand(CONFIG, "production", "D:/x.zip", HASH), /-EnvFile "C:\/prestige-nginx\/deploy\/windows\/lspd-backend\.env"/);
  });

  it("deploy as a dry run checks only: -WhatIf, and no history", () => {
    const command = deployCommand(CONFIG, "production", "D:/x.zip", HASH, true);
    assert.match(command, / -WhatIf$/);
    assert.doesNotMatch(command, /-LogFile/);
  });

  it("every command starts with powershell, never a quote (cmd.exe would strip it)", () => {
    for (const command of [deployCommand(CONFIG, "staging", "D:/x.zip", HASH), checkCommand(CONFIG, "production"), removeCommand("D:/deploy-drop/x.txt")]) {
      assert.match(command, /^powershell /);
    }
  });

  it("check and remove", () => {
    assert.match(checkCommand(CONFIG, "staging"), /-File "C:\/prestige-nginx\/deploy\/windows\/deploy-site\.ps1" -Check -EnvFile ".*lspd-backend\.staging\.env"$/);
    assert.match(removeCommand("D:/deploy-drop/x.txt"), /Remove-Item -LiteralPath 'D:\/deploy-drop\/x\.txt' -ErrorAction Stop"$/);
  });

  it("ssh and scp take the port and key under their own flags, and scp the bare file name", () => {
    const config: DeployConfig = { ...CONFIG, port: "2222", keyFile: "C:/k/id" };
    assert.deepEqual(sshArgs(config, "echo hi"), ["-o", "ConnectTimeout=15", "-p", "2222", "-i", "C:/k/id", "deploy@203.0.113.7", "echo hi"]);
    assert.deepEqual(scpArgs(config, "egov.zip", "D:/deploy-drop/egov.zip"), ["-o", "ConnectTimeout=15", "-P", "2222", "-i", "C:/k/id", "egov.zip", "deploy@203.0.113.7:D:/deploy-drop/egov.zip"]);
    assert.deepEqual(sshArgs(CONFIG, "x"), ["-o", "ConnectTimeout=15", "deploy@203.0.113.7", "x"]);
  });
});

/** Runs a command the way a Windows OpenSSH server does (`cmd.exe /c <command>`) and reports the arguments the program got. */
function argumentsSeenThroughCmd(command: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "site-deploy-cmd-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "echo-args.mjs"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
  // A stand-in `powershell` that prints the arguments it was started with, split the way a program's C runtime splits them.
  writeFileSync(join(dir, "powershell.cmd"), `@"${process.execPath}" "${join(dir, "echo-args.mjs")}" %*\r\n`);
  const result = spawnSync("cmd.exe", ["/d", "/c", command], {
    windowsVerbatimArguments: true,
    encoding: "utf8",
    env: { ...process.env, PATH: dir + delimiter + process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

describe("through cmd.exe, as a Windows SSH server runs it", { skip: process.platform !== "win32" }, () => {
  it("a path with spaces reaches PowerShell as one argument", () => {
    const spaced: DeployConfig = { ...CONFIG, remoteScripts: "C:/Program Files/prestige nginx/deploy/windows", remoteDrop: "D:/my drop" };
    const zip = "D:/my drop/egov-1-4f7e3aba.zip";
    assert.deepEqual(argumentsSeenThroughCmd(deployCommand(spaced, "production", zip, HASH)), [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", "C:/Program Files/prestige nginx/deploy/windows/deploy-site.ps1",
      "-Zip", zip,
      "-Sha256", HASH,
      "-EnvFile", "C:/Program Files/prestige nginx/deploy/windows/lspd-backend.env",
      "-LogFile", "C:/Program Files/prestige nginx/deploy/windows/deploy-history.log",
    ]);
  });

  it("the check and the removal arrive intact too", () => {
    assert.deepEqual(argumentsSeenThroughCmd(checkCommand(CONFIG, "staging")).slice(4), [
      "-File", "C:/prestige-nginx/deploy/windows/deploy-site.ps1", "-Check", "-EnvFile", "C:/prestige-nginx/deploy/windows/lspd-backend.staging.env",
    ]);
    assert.deepEqual(argumentsSeenThroughCmd(removeCommand("D:/my drop/deploy-check-ab12.txt")), [
      "-NoProfile", "-NonInteractive", "-Command", "Remove-Item -LiteralPath 'D:/my drop/deploy-check-ab12.txt' -ErrorAction Stop",
    ]);
  });
});

/** An exec that records what it was asked to run and answers from a list of exit codes (0 when it runs out). */
function recorder(codes: number[] = []) {
  const calls: { program: string; args: string[]; cwd?: string }[] = [];
  const exec: Exec = async (program, args, options) => {
    calls.push({ program, args, cwd: options?.cwd });
    return codes.shift() ?? 0;
  };
  return { calls, exec };
}

describe("deployBundle", () => {
  const bundle = { file: join("bundles", "egov-20261013-153000.zip"), sha256: HASH };

  it("uploads from the bundle's folder, then runs the deploy, and returns the server's exit code", async () => {
    const { calls, exec } = recorder([0, 0]);
    const log: string[] = [];
    const code = await deployBundle(CONFIG, "staging", bundle, exec, { log: (l) => log.push(l) });
    assert.equal(code, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].program, "scp");
    assert.equal(calls[0].cwd, "bundles");
    assert.deepEqual(calls[0].args.slice(-2), ["egov-20261013-153000.zip", "deploy@203.0.113.7:D:/deploy-drop/egov-20261013-153000-4f7e3aba.zip"]);
    assert.equal(calls[1].program, "ssh");
    assert.equal(calls[1].args.at(-1), deployCommand(CONFIG, "staging", "D:/deploy-drop/egov-20261013-153000-4f7e3aba.zip", HASH));
    assert.equal(log.length, 2);
  });

  it("passes the server's failure on, so the caller exits non-zero", async () => {
    assert.equal(await deployBundle(CONFIG, "staging", bundle, recorder([0, 1]).exec), 1);
  });

  it("stops at a failed upload, deploys nothing, and says how to find out why", async () => {
    const { calls, exec } = recorder([255]);
    await assert.rejects(deployBundle(CONFIG, "production", bundle, exec), /Uploading the bundle failed \(scp exited 255\)\. Nothing was deployed.*check production/);
    assert.equal(calls.length, 1);
  });

  it("a dry run asks the server to check only", async () => {
    const { calls, exec } = recorder();
    await deployBundle(CONFIG, "production", bundle, exec, { dryRun: true });
    assert.match(calls[1].args.at(-1)!, /-WhatIf$/);
  });
});

describe("checkServer", () => {
  const file = join("tmp", "deploy-check-ab12.txt");

  it("tests the login, the upload, the arrival and the server's own check, in that order", async () => {
    const { calls, exec } = recorder();
    const log: string[] = [];
    await checkServer(CONFIG, "staging", file, exec, (l) => log.push(l));
    assert.deepEqual(calls.map((c) => c.program), ["ssh", "scp", "ssh", "ssh"]);
    assert.equal(calls[0].args.at(-1), "echo connected");
    assert.deepEqual(calls[1].args.slice(-2), ["deploy-check-ab12.txt", "deploy@203.0.113.7:D:/deploy-drop/deploy-check-ab12.txt"]);
    assert.equal(calls[1].cwd, "tmp");
    assert.equal(calls[2].args.at(-1), removeCommand("D:/deploy-drop/deploy-check-ab12.txt"));
    assert.equal(calls[3].args.at(-1), checkCommand(CONFIG, "staging"));
    assert.deepEqual(log.map((l) => l.slice(0, 3)), ["1/4", "2/4", "3/4", "4/4"]);
  });

  it("stops at the first step that fails and names it", async () => {
    const expectations: [number, RegExp, number][] = [
      [0, /Logging in failed \(exit 255\).*DEPLOY_SSH_KEY/, 1],
      [1, /Uploading failed \(exit 255\).*DEPLOY_REMOTE_DROP/, 2],
      [2, /Finding the uploaded file failed \(exit 255\)/, 3],
      [3, /The server's own check failed \(exit 255\).*DEPLOY_REMOTE_SCRIPTS/, 4],
    ];
    for (const [failAt, message, callsMade] of expectations) {
      const codes = [0, 0, 0, 0];
      codes[failAt] = 255;
      const { calls, exec } = recorder(codes);
      await assert.rejects(checkServer(CONFIG, "production", file, exec), message);
      assert.equal(calls.length, callsMade, `calls when step ${failAt + 1} fails`);
    }
  });
});
