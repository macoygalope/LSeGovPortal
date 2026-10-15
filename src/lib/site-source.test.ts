import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { normalizePayload } from "./normalize.ts";
import {
  dataFromSnapshot,
  loadLive,
  loadSiteData,
  payloadFromViews,
  serializeSnapshot,
} from "./site-source.ts";
import { SECTIONS } from "./types.ts";

const live = normalizePayload(JSON.parse(readFileSync("fixtures/live-all.json", "utf8")));
// A real reply of lspd-backend's two views, captured from a copy of the same data (see the fixture's _about).
const views = JSON.parse(readFileSync("fixtures/site-views.json", "utf8")) as { records: unknown[]; settings: unknown[] };

const SITE = "/api/v1/websites/egov";

/** A fetch that answers from a table of address -> body (a number is an HTTP status with no body), and records what it was asked. */
function fakeFetch(answers: Record<string, unknown>) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const answer = answers[url];
    if (answer === undefined) throw new TypeError("Failed to fetch");
    if (typeof answer === "number") return { ok: false, status: answer, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => answer } as Response;
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const liveAnswers = {
  [`${SITE}/db/site_records`]: { rows: views.records },
  [`${SITE}/db/site_settings`]: { rows: views.settings },
};
const snapshotAnswer = { "/assets/snapshot.json": JSON.parse(serializeSnapshot(live)) };

describe("the live views, as lspd-backend answers them", () => {
  it("make exactly the data the sheet's saved response makes", () => {
    // The strongest check there is: the same 33 records and 15 settings, field for field.
    assert.deepEqual(normalizePayload(payloadFromViews(views.records, views.settings)), live);
  });

  it("turn 0 and 1 into false and true, which is all normalising reads", () => {
    const { data } = payloadFromViews([{ section: "Forms", id: "a", title: "A", published: 1, pinned: 0, autoNumber: 0 }], []);
    const [row] = (data.Forms as Record<string, unknown>[])!;
    assert.deepEqual([row!.published, row!.pinned, row!.autoNumber], [true, false, false]);
  });

  it("never show a draft, whoever sent it", () => {
    const data = normalizePayload(
      payloadFromViews(
        [
          { section: "ExecutiveOrders", id: "ok", title: "Published", published: 1 },
          { section: "ExecutiveOrders", id: "draft", title: "Draft", published: 0 },
          { section: "ExecutiveOrders", id: "", title: "No id", published: 1 },
        ],
        [],
      ),
    );
    assert.deepEqual(data.sections.ExecutiveOrders.map((r) => r.id), ["ok"]);
  });

  it("ignore a section this page does not know, and a key that names something else", () => {
    const { data } = payloadFromViews(
      [
        { section: "Newsletters", id: "n", title: "N", published: 1 },
        { section: "__proto__", id: "p", title: "P", published: 1 },
        { section: "constructor", id: "c", title: "C", published: 1 },
      ],
      [{ key: "__proto__", value: "x" }, { key: "footerText", value: "Footer" }, { key: 7, value: "no" }, null],
    );
    for (const section of SECTIONS) assert.deepEqual(data[section], []);
    assert.deepEqual(Object.keys(data.SiteSettings as object).sort(), ["__proto__", "footerText"]);
    assert.equal(({} as Record<string, unknown>).x, undefined, "no prototype was touched");
    assert.equal(Object.getPrototypeOf(data.SiteSettings), Object.prototype);
  });

  it("refuse a row that is not an object", () => {
    assert.throws(() => payloadFromViews(["nope"], []), /not an object/);
  });
});

describe("loadLive", () => {
  it("asks for both views, and asks lspd-backend whether they changed rather than trusting a kept copy", async () => {
    const { fetchImpl, asked } = fakeFetch(liveAnswers);
    assert.deepEqual(await loadLive(SITE, fetchImpl), live);
    assert.deepEqual(asked.map((a) => a.url).sort(), [`${SITE}/db/site_records`, `${SITE}/db/site_settings`]);
    for (const { init } of asked) {
      assert.equal(init?.cache, "no-cache");
      assert.ok(init?.signal instanceof AbortSignal);
    }
  });

  it("fails when a view answers with anything but rows", async () => {
    const { fetchImpl } = fakeFetch({ ...liveAnswers, [`${SITE}/db/site_records`]: { rows: "no" } });
    await assert.rejects(loadLive(SITE, fetchImpl), /did not answer with rows/);
    const missing = fakeFetch({ ...liveAnswers, [`${SITE}/db/site_settings`]: { data: [] } });
    await assert.rejects(loadLive(SITE, missing.fetchImpl), /did not answer with rows/);
  });

  // A bound of its own: if the page ever stops giving up, this must fail, not wait for ever.
  it("gives up on a request that never answers", { timeout: 3000 }, async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await assert.rejects(loadLive(SITE, hang, 20), /aborted/);
  });
});

describe("loadSiteData", () => {
  const options = { liveBase: SITE, snapshotUrl: "/assets/snapshot.json" };

  it("uses the live content, and does not touch the copy", async () => {
    const { fetchImpl, asked } = fakeFetch({ ...liveAnswers, ...snapshotAnswer });
    const loaded = await loadSiteData({ ...options, fetchImpl });
    assert.equal(loaded.source, "live");
    assert.deepEqual(loaded.data, live);
    assert.ok(!asked.some((a) => a.url.includes("snapshot")));
  });

  it("falls back to the build's copy when the views fail, and says why", async () => {
    const warnings: string[] = [];
    for (const broken of [500, 404, undefined]) {
      const answers = { ...snapshotAnswer, ...(broken === undefined ? {} : { [`${SITE}/db/site_records`]: broken, [`${SITE}/db/site_settings`]: broken }) };
      const { fetchImpl } = fakeFetch(answers);
      const loaded = await loadSiteData({ ...options, fetchImpl, warn: (m) => warnings.push(m) });
      assert.equal(loaded.source, "snapshot");
      assert.deepEqual(loaded.data, live);
    }
    assert.equal(warnings.length, 3);
    assert.match(warnings[0]!, /live content did not load.*500.*copy made at build time/);
  });

  it("never mixes the two: one view failing is the whole site from the copy", async () => {
    const { fetchImpl } = fakeFetch({ ...snapshotAnswer, [`${SITE}/db/site_records`]: { rows: views.records } });
    const loaded = await loadSiteData({ ...options, fetchImpl, warn: () => {} });
    assert.equal(loaded.source, "snapshot");
  });

  it("uses the copy alone where there is no live address (a build served from elsewhere)", async () => {
    const { fetchImpl, asked } = fakeFetch(snapshotAnswer);
    const loaded = await loadSiteData({ liveBase: "", snapshotUrl: "/assets/snapshot.json", fetchImpl });
    assert.equal(loaded.source, "snapshot");
    assert.deepEqual(asked.map((a) => a.url), ["/assets/snapshot.json"]);
  });

  it("throws, naming both, when neither answers", async () => {
    const { fetchImpl } = fakeFetch({});
    await assert.rejects(loadSiteData({ ...options, fetchImpl, warn: () => {} }), /No eGov content could be loaded \(live: Failed to fetch; copy: Failed to fetch\)/);
  });

  it("throws plainly when there is nothing to ask", async () => {
    await assert.rejects(loadSiteData({ liveBase: "", snapshotUrl: "" }), /nothing to ask/);
  });

  it("does not take a build with no copy for one with an empty site", async () => {
    const { fetchImpl } = fakeFetch({ "/assets/snapshot.json": JSON.parse(serializeSnapshot(null)) });
    await assert.rejects(loadSiteData({ liveBase: "", snapshotUrl: "/assets/snapshot.json", fetchImpl }), /no copy of the content/);
  });
});

describe("the build's copy", () => {
  it("comes back exactly as it went in", () => {
    assert.deepEqual(dataFromSnapshot(JSON.parse(serializeSnapshot(live))), live);
  });

  it("is only what was published: a draft that got into the file is dropped on the way out", () => {
    const body = JSON.parse(serializeSnapshot(live));
    body.data.sections.Forms.push({ ...body.data.sections.Forms[0], id: "sneaked-in", published: false });
    assert.ok(!dataFromSnapshot(body).sections.Forms.some((r) => r.id === "sneaked-in"));
  });

  it("is refused when it is not a copy, or lacks a section", () => {
    assert.throws(() => dataFromSnapshot(JSON.parse(serializeSnapshot(null))), /no copy of the content/);
    assert.throws(() => dataFromSnapshot(null), /no copy of the content/);
    assert.throws(() => dataFromSnapshot({ ok: true, data: {} }), /no sections/);
    const body = JSON.parse(serializeSnapshot(live));
    delete body.data.sections.Resolutions;
    assert.throws(() => dataFromSnapshot(body), /missing "Resolutions"/);
  });

  it("holds no draft and no unpublished text when made from the live data", () => {
    const text = serializeSnapshot(live);
    assert.ok(!/"published":false/.test(text));
  });
});
