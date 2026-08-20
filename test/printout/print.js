/*
 * print.js - Run the sample jobs and write the results out as PNGs
 *
 *   npm run print                       every model job
 *   npm run print -- --examples         the four capability examples
 *   npm run print -- --all              both sets
 *   npm run print -- epson-fx80         one model job
 *   npm run print -- color-graphics     one example, by name
 *   npm run print -- --list             what can be run
 *   npm run print -- --dpi 300          at a different output resolution
 *   npm run print -- --multipage        a three-page job, one PNG per sheet
 *
 * This is the end-to-end demonstration: bytes in one side, pictures of sheets of
 * paper out the other, with nothing in between but this directory and the
 * library. If it produces legible pages, the whole pipeline works.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *  Mike Daley <michael_daley@icloud.com>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrinter, PRINTER_MODELS } from "../../src/index.js";
import { Paper } from "./paper.js";
import { JOBS, multipage } from "./jobs.js";
import { EXAMPLES } from "./examples.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const rel = (p) => relative(process.cwd(), p);

// One flat runnable list, so a model job and a capability example are selected
// the same way: by name. `model` is which machine prints it — the examples are
// grouped by capability, not by machine, so they have to say.
const RUNNABLE = [
  ...PRINTER_MODELS.filter((m) => JOBS[m.id]).map((m) => ({
    name: m.id, kind: "model", model: m.id,
    title: JOBS[m.id].title, build: JOBS[m.id].build,
  })),
  ...Object.entries(EXAMPLES).map(([name, e]) => ({
    name, kind: "example", model: e.model, title: e.title, build: e.build, setup: e.setup,
  })),
];

function parseArgs(argv) {
  const opts = { dpi: 150, only: null, multipage: false, set: "models", list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") opts.dpi = Number(argv[++i]);
    else if (a === "--multipage") opts.multipage = true;
    else if (a === "--examples") opts.set = "examples";
    else if (a === "--all") opts.set = "all";
    else if (a === "--list") opts.list = true;
    else if (!a.startsWith("--")) opts.only = a;
  }
  return opts;
}

const { dpi, only, multipage: multi, set, list } = parseArgs(process.argv.slice(2));

if (list) {
  console.log("\nModel jobs — one page per machine, in its own command set:");
  for (const r of RUNNABLE.filter((r) => r.kind === "model")) {
    console.log(`  ${r.name.padEnd(18)} ${r.title}`);
  }
  console.log("\nExamples — one capability at a time:");
  for (const r of RUNNABLE.filter((r) => r.kind === "example")) {
    console.log(`  ${r.name.padEnd(18)} ${r.title}  (${r.model})`);
  }
  console.log("\n  --multipage        a three-page job on the ImageWriter II\n");
  process.exit(0);
}

let runs = RUNNABLE.filter((r) =>
  set === "all" ? true : set === "examples" ? r.kind === "example" : r.kind === "model");

if (only) {
  runs = RUNNABLE.filter((r) => r.name === only);
  if (!runs.length) {
    console.error(`No such job "${only}". Try --list.`);
    process.exit(1);
  }
}

// The multi-page job is about paper handling, not about any one command set, so
// one machine is enough to show it.
if (multi && !only) runs = runs.slice(0, 1);

mkdirSync(OUT, { recursive: true });

console.log(`\nPrinting ${runs.length} job(s) at ${dpi} dpi${multi ? " — multi-page" : ""}\n`);

let failures = 0;

for (const run of runs) {
  const printer = createPrinter(run.model);

  // Fit the four-band ribbon where the model took one. Without this the machine
  // is loaded with black cloth and every ESC K colour select correctly inks
  // black — the command is honoured, there is simply no colour in the cartridge.
  if (printer.supportsColorRibbon()) printer.setRibbon("color");

  // Operator-panel settings, where a capability needs one. On the real machines
  // these were DIP switches, set before the job rather than sent inside it.
  run.setup?.(printer);

  const paper = new Paper(printer, { dpi });

  // Capture the readable text too — a cheap sanity check that the parser saw
  // what we meant to send, independent of whether anything rendered.
  let text = "";
  printer.setEventSink(paper.sink);
  printer.on("text", (s) => { text += s; });
  // Both, because they are not interchangeable: with Auto-LF on a CR reports
  // "newline" and swallows the following LF; with it off the two arrive
  // separately. Listening for only one undercounts a colour job by every line.
  printer.on("newline", () => { text += "\n"; });
  printer.on("linefeed", () => { text += "\n"; });

  const stream = multi ? multipage() : run.build();
  for (const byte of stream) printer.receiveByte(byte);
  printer.flushLine();

  const base = multi ? `${run.name}-multipage` : run.name;
  const files = paper.save((page, total) =>
    join(OUT, total > 1 ? `${base}-p${page}.png` : `${base}.png`));

  const lines = text.split("\n").filter((l) => l.trim()).length;
  const ok = paper.dots > 0 && files.length > 0;
  if (!ok) failures++;

  const title = multi ? `${run.title} (3-page)` : run.title;
  console.log(`${ok ? "✓" : "✗"} ${title.padEnd(24)} ` +
    `${String(stream.length).padStart(6)} bytes → ` +
    `${String(paper.dots).padStart(7)} dots · ${lines} lines · ` +
    `${files.length} page(s) of ${paper.formInch.toFixed(2)}"`);

  for (const f of files) {
    console.log(`    p${f.page}  ${String(f.w) + "×" + String(f.h) + "px"}  ` +
      `${String(f.dots).padStart(6)} dots  ${rel(f.path)}`);
  }
  if (paper.clipped) console.log(`    ! ${paper.clipped} dots past the sheet limit were dropped`);
}

console.log(failures ? `\n${failures} job(s) produced nothing\n` : `\nWrote to ${rel(OUT)}\n`);
process.exit(failures ? 1 : 0);
