#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const DEFAULT_START_URL =
  "https://gw.geneanet.org/gntstarnivatanne?lang=fr&n=sgard&oc=0&p=adele+felicie+sidonie&type=tree";

const DEFAULT_MY_URL =
  "https://gw.geneanet.org/gnivat_w?lang=fr&n=sgard&oc=1&p=adele+felicie+sidonie&type=tree";

const COMMANDS = new Set(["discover", "guided"]);

main().catch((error) => {
  console.error(`\n${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = COMMANDS.has(args._[0]) ? args._[0] : "guided";
  const startUrl = normalizePersonUrl(args.start || DEFAULT_START_URL);
  const myUrl = args.my ? normalizePersonUrl(args.my) : normalizePersonUrl(DEFAULT_MY_URL);
  const maxGenerations = parseGenerationLimit(args.generations || args.maxGenerations || "all");
  const profileDir = path.resolve(args.profile || ".genadup-browser-profile");
  const reportDir = path.resolve(args.reportDir || "reports");
  const browserChannel = args.browserChannel || process.env.GENADUP_BROWSER_CHANNEL || "msedge";

  await fs.mkdir(reportDir, { recursive: true });

  const browser = await launchBrowser(profileDir, browserChannel);
  const page = browser.pages()[0] || (await browser.newPage());

  try {
    if (command === "discover") {
      const rows = await discoverAncestors(page, startUrl, maxGenerations);
      const reportPath = path.join(reportDir, `discover-${timestamp()}.csv`);
      await writeCsv(reportPath, rows);
      printRows(rows);
      console.log(`\nDiscovery report: ${reportPath}`);
      return;
    }

    const reportPath = path.join(reportDir, `guided-import-${timestamp()}.csv`);
    await runGuidedImport(page, {
      startUrl,
      myUrl,
      maxGenerations,
      reportPath,
    });
  } finally {
    await browser.close();
  }
}

async function launchBrowser(profileDir, browserChannel) {
  const options = {
    headless: false,
    viewport: { width: 1400, height: 950 },
  };

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: browserChannel,
    });
  } catch (error) {
    console.warn(
      `Could not launch browser channel "${browserChannel}". Falling back to Playwright Chromium.`
    );
    return chromium.launchPersistentContext(profileDir, options);
  }
}

async function runGuidedImport(page, options) {
  const rl = readline.createInterface({ input, output });
  const rows = [];
  const queue = [{ url: options.startUrl, generation: 0, relation: "start" }];
  const seen = new Set();

  console.log("Guided Geneanet import");
  console.log(`External start: ${options.startUrl}`);
  console.log(`Your matching person: ${options.myUrl}`);
  console.log("");
  console.log("A browser window will open. Log into Geneanet there if needed.");
  console.log("For each person, complete Geneanet's import screen yourself, then press Enter here.");
  console.log("Type s + Enter to skip a person, or q + Enter to stop.");
  await rl.question("\nPress Enter to start.");

  while (queue.length > 0) {
    const item = queue.shift();
    const key = personKey(item.url);
    if (seen.has(key)) continue;
    if (item.generation > options.maxGenerations) continue;
    seen.add(key);

    console.log(`\n[Generation ${item.generation}] Opening ${item.url}`);
    const person = await loadPerson(page, item.url);
    const parents = person.parents.filter((parent) => !seen.has(personKey(parent.url)));

    console.log(`Person: ${person.name || "(unknown person)"}`);
    if (parents.length === 0) {
      console.log("Parents found: none");
    } else {
      console.log("Parents found:");
      for (const parent of parents) {
        console.log(`- ${parent.name}: ${parent.url}`);
      }
    }

    const status = await openImportUi(page);
    if (status === "opened") {
      console.log("Import UI opened. Review the fields in Geneanet and validate there.");
    } else {
      console.log("I could not open the import UI automatically.");
      console.log('Use Geneanet manually: "Plus" -> "Importer dans mon arbre", then validate.');
    }

    const answer = (await rl.question("Press Enter when done, s to skip, q to stop: ")).trim().toLowerCase();
    const imported = answer === "" ? "yes" : answer === "s" ? "skipped" : "stopped";
    rows.push({
      generation: item.generation,
      relation: item.relation,
      name: person.name,
      url: person.url,
      importUi: status,
      imported,
      parents: parents.map((parent) => parent.name).join(" | "),
    });
    await writeCsv(options.reportPath, rows);

    if (answer === "q") break;
    if (answer !== "s") {
      for (const parent of parents) {
        queue.push({
          url: parent.url,
          generation: item.generation + 1,
          relation: `parent of ${person.name}`,
        });
      }
    }
  }

  await rl.close();
  console.log(`\nReport written: ${options.reportPath}`);
}

async function discoverAncestors(page, startUrl, maxGenerations) {
  const rows = [];
  const queue = [{ url: startUrl, generation: 0, relation: "start" }];
  const seen = new Set();

  while (queue.length > 0) {
    const item = queue.shift();
    const key = personKey(item.url);
    if (seen.has(key)) continue;
    if (item.generation > maxGenerations) continue;
    seen.add(key);

    const person = await loadPerson(page, item.url);
    rows.push({
      generation: item.generation,
      relation: item.relation,
      name: person.name,
      url: person.url,
      parents: person.parents.map((parent) => parent.name).join(" | "),
    });

    for (const parent of person.parents) {
      queue.push({
        url: parent.url,
        generation: item.generation + 1,
        relation: `parent of ${person.name}`,
      });
    }
  }

  return rows;
}

async function loadPerson(page, url) {
  await page.goto(normalizePersonUrl(url), { waitUntil: "domcontentloaded" });
  await closeCookieBanner(page);

  return page.evaluate(() => {
    const asAbsoluteUrl = (href) => new URL(href, location.href).href;
    const cleanText = (text) => (text || "").replace(/\s+/g, " ").trim();
    const personName =
      cleanText(document.querySelector("h1")?.textContent)
        .replace(/^(Homme|Femme)\s+/i, "")
        .trim() || cleanText(document.title.split(":")[0]);

    const parentHeading = Array.from(document.querySelectorAll("h2, h3")).find((heading) =>
      /^Parents\b/i.test(cleanText(heading.textContent))
    );

    const parents = [];
    if (parentHeading) {
      let node = parentHeading.nextElementSibling;
      while (node && !/^H[23]$/i.test(node.tagName)) {
        for (const link of node.querySelectorAll("a[href]")) {
          const href = asAbsoluteUrl(link.getAttribute("href"));
          const url = new URL(href);
          if (!url.hostname.endsWith("geneanet.org")) continue;
          if (!url.searchParams.has("p") || !url.searchParams.has("n")) continue;
          if (url.searchParams.has("m")) continue;
          const name = cleanText(link.textContent);
          if (!name || parents.some((parent) => parent.url === url.href)) continue;
          parents.push({ name, url: url.href });
        }
        node = node.nextElementSibling;
      }
    }

    return {
      name: personName,
      url: location.href,
      parents,
    };
  });
}

async function closeCookieBanner(page) {
  for (const label of ["Tout accepter", "Tout refuser"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if ((await button.count()) === 1) {
      await button.click();
      return;
    }
  }
}

async function openImportUi(page) {
  if (await clickExactText(page, "Importer dans mon arbre")) return "opened";
  if (await clickExactText(page, "Plus")) {
    await page.waitForTimeout(400);
    if (await clickExactText(page, "Importer dans mon arbre")) return "opened";
  }

  const links = await page.locator("a").evaluateAll((elements) =>
    elements
      .map((element) => ({
        text: (element.textContent || "").replace(/\s+/g, " ").trim(),
        href: element.href,
      }))
      .filter((link) => /importer/i.test(link.text) || /importer/i.test(link.href))
  );

  if (links.length === 1) {
    await page.goto(links[0].href, { waitUntil: "domcontentloaded" });
    return "opened";
  }

  return links.length > 1 ? "ambiguous" : "not-found";
}

async function clickExactText(page, text) {
  const locator = page.getByText(text, { exact: true });
  if ((await locator.count()) !== 1) return false;
  if (!(await locator.isVisible())) return false;
  await locator.click();
  return true;
}

function normalizePersonUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.protocol = "https:";
  if (!url.searchParams.get("lang")) url.searchParams.set("lang", "fr");
  url.searchParams.delete("type");
  return url.href;
}

function personKey(rawUrl) {
  const url = new URL(normalizePersonUrl(rawUrl));
  return [
    url.pathname.toLowerCase(),
    url.searchParams.get("p")?.toLowerCase() || "",
    url.searchParams.get("n")?.toLowerCase() || "",
    url.searchParams.get("oc") || "",
  ].join("|");
}

function parseGenerationLimit(value) {
  if (value === "all") return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid generation limit: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function writeCsv(filePath, rows) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function csvCell(value) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function printRows(rows) {
  for (const row of rows) {
    console.log(`[${row.generation}] ${row.name} -> ${row.parents || "no parents found"}`);
  }
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}
