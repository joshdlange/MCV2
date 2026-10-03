/**
 * Isolated, production-built workspace UI QA; not signed-in real-phone acceptance.
 * No live app APIs, DB reads, auth bypass, HMR, or workflow restart.
 *
 * SCAN_QA_FIXTURE=client/scan-qa/catalog-fixture.json npx tsx client/scan-qa/capture.ts
 * Backend owner exports real DEV catalog identity fixtures; see README.md.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Page } from "playwright-core";

assert.ok(!process.env.REPLIT_DEPLOYMENT, "Never run this against deployment");
const root = process.cwd();
const qaRoot = path.resolve("client/scan-qa");
const fixturePath = path.resolve(process.env.SCAN_QA_FIXTURE || "client/scan-qa/catalog-fixture.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.ok(fixture.source && fixture.families?.length && fixture.years?.length, "Real catalog export required");
assert.ok(fixture.browseHint && fixture.sets && fixture.subsets && fixture.cards && fixture.search, "Complete browse and search export required");
const output = path.resolve("screenshots/scan-phone");
await mkdir(output, { recursive: true });
const modes = ["before", "after"] as const;
const evidence: Record<string, unknown>[] = [];
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  for (const mode of modes) {
    const publicRoot = path.join(qaRoot, "build", mode);
    await build({
      configFile: false, root: qaRoot, mode: "production", publicDir: false,
      plugins: [{
        name: "isolated-fixture-aliases", enforce: "pre",
        resolveId(id, importer) {
          if (id === "@/contexts/AuthContext" || /\/contexts\/AuthContext(?:\.tsx)?$/.test(id)) return path.join(qaRoot, "auth.ts");
          if (id === "./firebase" || /\/lib\/firebase(?:\.ts)?$/.test(id)) return path.join(qaRoot, "firebase.ts");
          if (mode === "before" && (id === "@/components/scan/dev-scan-workspace" || /\/client\/src\/components\/scan\/dev-scan-workspace(?:\.tsx)?$/.test(id))) return path.join(qaRoot, "before/dev-scan-workspace.tsx");
          if (importer?.includes("/scan-qa/before/") && id === "./report-image-dialog") return path.join(root, "client/src/components/scan/report-image-dialog.tsx");
          return null;
        },
      }, react()],
      resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
      css: { postcss: root },
      build: { outDir: publicRoot, emptyOutDir: true, minify: true },
      logLevel: "warn",
    });
    const app = express();
    app.use(express.static(publicRoot));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    const writes: { method: string; url: string; body: unknown }[] = [];
    const unexpected: string[] = [];
    let checklistFailure = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(data => {
      window.__scanFixture = data;
      window.__scanQaRecords = [];
    }, fixture);
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        // Optional local image exports: never fetch remote catalog URLs.
        const localImage = fixture.images?.[url.href];
        if (localImage) return route.fulfill({ body: await readFile(path.resolve(localImage)), contentType: /\.(jpg|jpeg)$/i.test(localImage) ? "image/jpeg" : "image/png" });
        return route.abort("blockedbyclient");
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      const pathname = url.pathname.replace("/api/cards/picker/", "/api/cards/scan/browse/");
      if (pathname.endsWith("/browse/years")) return json(fixture.years);
      if (pathname.endsWith("/browse/sets")) return json(fixture.sets[url.searchParams.get("year")!] ?? []);
      if (pathname.endsWith("/browse/subsets")) return json(fixture.subsets[`${url.searchParams.get("mainSetId")}:${url.searchParams.get("year")}`] ?? []);
      if (pathname.endsWith("/browse/cards")) {
        if (checklistFailure) return json({ message: "Controlled fixture checklist failure" }, 503);
        const tokens = (url.searchParams.get("search") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        return json((fixture.cards[url.searchParams.get("setId")!] ?? []).filter((card: any) => tokens.every(t => `${card.name} ${card.cardNumber}`.toLowerCase().includes(t))));
      }
      if (pathname === "/api/cards/scan/search") return json(fixture.search[url.searchParams.get("q")!] ?? []);
      if (/^\/api\/card-sets\/\d+\/first-card-image$/.test(pathname)) {
        const id = pathname.split("/")[3];
        return json({ imageUrl: fixture.cards[id]?.find((c: any) => c.frontImageUrl)?.frontImageUrl ?? null });
      }
      if (request.method() !== "GET") writes.push({ method: request.method(), url: pathname, body: request.postDataJSON() });
      if (pathname === "/api/cards/scan/client-event") return json({ ok: true });
      if (pathname === "/api/cards/scan/collection") {
        const cardId = request.postDataJSON().cardId;
        return json({ created: true, ownedRow: { id: 97213, cardId }, undoToken: "isolated-undo-token" });
      }
      if (pathname === "/api/cards/scan/collection/97213" && request.method() === "DELETE") return json({ success: true });
      if (pathname === "/api/collection") return json([]);
      if (["/api/stats", "/api/user/stats", "/api/collection/check"].includes(pathname)) return json({});
      unexpected.push(`${request.method()} ${pathname}`);
      return json({ message: "Blocked by isolated fixture" }, 501);
    });
    const snap = async (name: string) => {
      await page.screenshot({ path: path.join(output, `${mode}-${name}-390.png`) });
    };
    const stage = async (name: string) => {
      await page.locator(`[data-stage="picker-${name}"]`).waitFor();
      await page.waitForTimeout(400);
    };
    const restart = async () => {
      await page.goto(origin); await page.getByTestId("scan-result-list").waitFor();
    };
    try {
      await restart();
      await snap("results-same-art");
      if (mode === "after") {
        assert.equal(await page.getByTestId("scan-artwork-option").count(), Math.min(5, fixture.families.length));
        assert.equal(await page.locator('[data-selected="true"]').count(), 0);
        assert.equal(await page.locator(".scan-chip[aria-pressed=true]").count(), 0);
        assert.equal(writes.filter(w => w.url.endsWith("/collection")).length, 0);
        await page.getByTestId("scan-artwork-option").first().getByTestId("scan-set-choice").last().scrollIntoViewIfNeeded();
        await snap("results-same-art-last-set");
        await page.getByTestId("scan-result-list").evaluate(el => { el.scrollTop = 0; });
      }
      await page.getByTestId("scan-not-here").click();
      if (mode === "before") {
        await stage("card"); await snap("guessed-context-card");
        await page.getByRole("button", { name: /^1 ·/ }).click(); await stage("year"); await snap("year");
        await page.getByRole("button", { name: String(fixture.browseHint.year), exact: true }).click();
      } else {
        await stage("set");
        assert.equal(await page.getByTestId("scan-year-select").inputValue(), String(fixture.browseHint.year));
        await page.getByRole("button", { name: /^Year/ }).click(); await stage("year"); await snap("year");
        await page.getByRole("button", { name: "Set", exact: true }).click();
      }
      await stage("set"); await snap("set");
      const mainSet = fixture.sets[String(fixture.browseHint.year)].find((set: any) => set.type === "main_set" && fixture.subsets[`${set.id}:${fixture.browseHint.year}`]?.length);
      assert.ok(mainSet, "Fixture needs a main set with subsets");
      await clickContext(page, mainSet.name, mode); await stage("subset"); await snap("subset");
      const subset = fixture.subsets[`${mainSet.id}:${fixture.browseHint.year}`].find((item: any) =>
        (item.name === mainSet.name || item.name === `${mainSet.name} - ${mainSet.name}` || item.name === `${mainSet.name} - Base`) && fixture.cards[String(item.id)]?.length)
        ?? fixture.subsets[`${mainSet.id}:${fixture.browseHint.year}`].find((item: any) => fixture.cards[String(item.id)]?.length);
      assert.ok(subset, "Fixture needs subset cards");
      await clickContext(page, subset.name, mode); await stage("card"); await snap("card");
      if (mode === "after") {
        const card = fixture.cards[String(subset.id)][0];
        await page.getByTestId("scan-search-input").fill(card.cardNumber);
        await page.waitForTimeout(450);
        assert.ok(await page.getByTestId("scan-artwork-option").count() > 0, "Card number filter renders");
        checklistFailure = true;
        await page.getByTestId("scan-search-input").fill(card.name);
        await page.getByRole("alert").filter({ hasText: "This checklist couldn't load" }).waitFor();
        await snap("checklist-error");
        checklistFailure = false;
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.getByTestId("scan-artwork-option").first().waitFor();
        await page.getByTestId("scan-search-input").fill("zz-no-matching-catalog-name");
        await page.getByText("No cards in this context.", { exact: false }).waitFor();
        await snap("checklist-empty");
      }
      await page.getByRole("button", { name: "Type search", exact: true }).click();
      await page.getByTestId("scan-search-input").fill("darkhawk 11 1992");
      await page.waitForTimeout(600); await snap("typed-darkhawk-11-1992");
      assert.ok(await page.getByTestId("scan-artwork-option").count() > 0, "Real exported token-search results render");
      if (mode === "after") {
        await restart();
        const choices = page.getByTestId("scan-artwork-option").first().getByTestId("scan-set-choice");
        assert.ok(await choices.count() > 1, "Same-art fixture spans sets");
        const lastChoice = choices.last();
        const chips = lastChoice.locator(".scan-chip");
        let chosenId: number;
        if (await chips.count() > 1) {
          const chip = chips.last();
          chosenId = Number(await chip.getAttribute("data-card-id"));
          await chip.click();
          assert.equal(writes.filter(w => w.url.endsWith("/collection")).length, 0, "Chip does not add");
          assert.equal(await chip.getAttribute("aria-pressed"), "true");
        } else {
          chosenId = Number(await lastChoice.getByTestId("scan-set-row").getAttribute("data-card-id"));
        }
        await lastChoice.getByTestId("scan-set-row").click();
        await page.getByTestId("scan-qa-completed").waitFor();
        assert.equal((writes.find(w => w.url.endsWith("/collection"))!.body as any).cardId, chosenId, "Row adds the exact set/parallel");
        assert.ok(!writes.some(w => /\/upload$/.test(w.url)), "Match add never uploads a scan photo");
        await page.getByTestId("scan-undo").click();
        await page.getByText("Addition undone", { exact: true }).waitFor();
        assert.ok(writes.some(w => w.method === "DELETE" && w.url.endsWith("/97213")), "Undo requests only created row");
        await restart();
        await page.getByTestId("scan-report-image").first().click();
        await page.getByTestId("report-image-dialog").waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await page.getByTestId("report-image-dialog").count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal page overflow");
      }
      assert.deepEqual(errors, [], "No browser JS errors");
      assert.deepEqual(unexpected, [], "No unknown or live API requests");
      evidence.push({ mode, status: "passed", errors, unexpected, writes });
    } catch (error) {
      await snap("failure").catch(() => {});
      evidence.push({ mode, status: "failed", message: String(error), errors, unexpected, writes });
      throw error;
    } finally {
      await page.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await writeFile(path.join(output, "fixture-ui-evidence.json"), JSON.stringify({
        label: "Isolated workspace fixture UI QA; mock auth and API responses; not authenticated real-phone acceptance",
        source: fixture.source, fixturePath, viewport: { width: 390, height: 844 }, evidence,
      }, null, 2));
    }
  }
} finally {
  await browser.close();
}
console.log(`PASS isolated fixture UI; before/after captures in ${output}`);

async function clickContext(page: Page, name: string, mode: "before" | "after") {
  if (mode === "after") await page.getByRole("button").filter({ has: page.locator("span", { hasText: name }) }).first().click();
  else await page.getByText(name, { exact: true }).first().click();
}