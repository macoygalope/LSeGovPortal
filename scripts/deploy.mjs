// Puts the site on a server over SSH: makes a bundle (see site:pack), uploads it and runs
// prestige-nginx's deploy-site.ps1 there, which checks it and deploys it.
//
//   npm run deploy -- staging                  build, upload and deploy to staging
//   npm run deploy -- production               the same to production (asks you to type "production")
//   npm run deploy -- staging --only data      just the database (the pages are not rebuilt)
//   npm run deploy -- staging --register       the site's first deploy: also register it in the catalog
//   npm run deploy -- staging --dry-run        upload it and have the server check it, changing nothing
//   npm run deploy -- production --zip bundles/egov-20261013-153000.zip
//                                              deploy a bundle already made (the one staging got)
//   npm run deploy -- check staging            test the connection step by step, changing nothing
//
// Needs DEPLOY_* in .env (see .env.example) and an SSH key that logs in to the server.
// No SSH? `npm run site:pack` makes the same bundle, to hand to whoever runs the server.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { checkServer, deployBundle, loadDeployConfig } from "../src/lib/site-deploy.ts";
import { sha256Hex } from "../src/lib/site-bundle.ts";
import { describeBundle, packSite } from "./pack.mjs";

const USAGE = `Usage:
  npm run deploy -- <staging|production> [--only content|data] [--register] [--dry-run] [--yes] [--db <file>] [--no-build]
  npm run deploy -- <staging|production> --zip <bundle.zip> [--dry-run] [--yes]
  npm run deploy -- check <staging|production>`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Runs ssh or scp with its output and any prompt (a passphrase, a host key question) shown to the person. */
function exec(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { stdio: "inherit", cwd: options.cwd });
    child.on("error", (error) =>
      reject(
        error.code === "ENOENT"
          ? new Error(`'${program}' was not found. Install the OpenSSH client (Windows: Settings > Apps > Optional features > OpenSSH Client).`)
          : error,
      ),
    );
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function confirmProduction(summary) {
  if (!process.stdin.isTTY) fail("Deploying to production asks you to type 'production', so run it in a terminal, or add --yes.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${summary}\nType "production" to put it on the live server: `);
    return answer.trim().toLowerCase() === "production";
  } finally {
    rl.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string" },
      register: { type: "boolean" },
      zip: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      db: { type: "string" },
      "no-build": { type: "boolean" },
    },
  });

  const checking = positionals[0] === "check";
  const target = checking ? positionals[1] : positionals[0];
  if ((target !== "staging" && target !== "production") || positionals.length !== (checking ? 2 : 1)) fail(USAGE);
  if (values.zip && (values.only || values.register || values.db || values["no-build"])) {
    fail("--zip deploys that file exactly as it is, so --only, --register, --db and --no-build do not apply to it.");
  }

  let config;
  try {
    config = loadDeployConfig(process.env);
  } catch (error) {
    fail(error.message);
  }

  if (checking) {
    const dir = mkdtempSync(join(tmpdir(), "egov-deploy-check-"));
    const probe = join(dir, `deploy-check-${Math.random().toString(16).slice(2, 10)}.txt`);
    writeFileSync(probe, "deploy check\n");
    let failure;
    try {
      await checkServer(config, target, probe, exec, console.log);
    } catch (error) {
      failure = error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // (Not from inside the catch: process.exit there would skip the cleanup above.)
    if (failure) fail(`\n${failure.message}`);
    console.log(`\nReady: ${config.host} can take a deploy to ${target}.`);
    return;
  }

  let bundle;
  if (values.zip) {
    const file = resolve(values.zip);
    if (!existsSync(file)) fail(`'${values.zip}' does not exist.`);
    bundle = { file, sha256: sha256Hex(readFileSync(file)) };
    console.log(`Deploying the existing bundle ${values.zip}\n  sha256  ${bundle.sha256}`);
  } else {
    let made;
    try {
      made = packSite({ only: values.only, register: values.register, db: values.db, noBuild: values["no-build"] });
    } catch (error) {
      fail(error.message);
    }
    bundle = { file: made.file, sha256: made.packed.sha256 };
    console.log("\n" + describeBundle(made.file, made.packed).split("\n\n")[0]);
  }

  if (target === "production" && !values["dry-run"] && !values.yes) {
    if (!(await confirmProduction(`\nAbout to deploy to PRODUCTION on ${config.host}.`))) fail("Cancelled. Nothing was uploaded.");
  }

  let code;
  try {
    code = await deployBundle(config, target, bundle, exec, { dryRun: values["dry-run"], log: (line) => console.log(`\n${line}`) });
  } catch (error) {
    fail(error.message);
  }
  if (code !== 0) fail(`\nThe server did not deploy it (exit ${code}); its message is above. Nothing it refused was changed.`);
  console.log(values["dry-run"] ? "\nThe server accepts it. Nothing was changed (dry run)." : `\nDeployed to ${target}. The server recorded it in deploy-history.log.`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
