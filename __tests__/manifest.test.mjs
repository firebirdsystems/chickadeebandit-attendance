import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });
  it("entrypoint/runtime/storage are standard", () => {
    expect(manifest.entrypoint).toBe("index.html");
    expect(manifest.runtime).toBe("static");
    expect(manifest.storage).toBe("db");
  });
  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));
  it("has a nav label", () => expect(manifest.nav?.label).toBeTruthy());

  it("all tables are adult_writable (leaders mark, everyone views)", () => {
    expect(manifest.row_policies?.events?.kind).toBe("adult_writable");
    expect(manifest.row_policies?.records?.kind).toBe("adult_writable");
    expect(manifest.row_policies?.series?.kind).toBe("adult_writable");
  });

  it("exposes an agenda source filtered on :today, read-open for the Today merge", () => {
    const q = manifest.agenda?.source?.query ?? "";
    expect(manifest.agenda?.kind).toBe("event");
    expect(q).toMatch(/:today/);
    expect(q).toMatch(/\bwhen_at\b/);
    expect(q).toMatch(/\btitle\b/);
  });

  it("exposes a glance stat that hides when there are no sessions", () => {
    expect(manifest.glance?.display?.template).toBe("stat");
    expect(manifest.glance?.display?.empty_hides).toBe(true);
    expect(manifest.glance?.source?.query ?? "").toMatch(/:today/);
  });

  it("SQL-sorted schedule columns are declared plaintext", () => {
    expect(manifest.db_plaintext_columns).toContain("event_date");
    expect(manifest.db_plaintext_columns).toContain("start_time");
  });

  it("ai exports match the query files", () => {
    expect(manifest.ai_access?.db_exports?.sort()).toEqual(["events", "records"]);
  });
});
