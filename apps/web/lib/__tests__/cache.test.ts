import { describe, expect, it } from "vitest";
import { PUBLIC_PAGE_REVALIDATE_SECONDS, pageTag, tenantTag } from "../cache.js";

describe("tenantTag", () => {
  it("produces the expected format 'tenant:<slug>'", () => {
    expect(tenantTag("expertgids")).toBe("tenant:expertgids");
  });

  it("scopes by slug so different tenants produce different tags", () => {
    expect(tenantTag("expertgids")).not.toBe(tenantTag("ander-merk"));
  });

  it("preserves slug casing (slugs are lowercase by convention but the tag mirrors them)", () => {
    expect(tenantTag("expertGids")).toBe("tenant:expertGids");
  });
});

describe("pageTag", () => {
  it("produces the expected format 'page:<tenant>:<path>'", () => {
    expect(pageTag("expertgids", "/test/koffie/beste-machine")).toBe(
      "page:expertgids:/test/koffie/beste-machine",
    );
  });

  it("different tenants, same path → different tags", () => {
    expect(pageTag("a", "/test/niche/page")).not.toBe(pageTag("b", "/test/niche/page"));
  });

  it("same tenant, different paths → different tags", () => {
    expect(pageTag("expertgids", "/test/niche/review")).not.toBe(
      pageTag("expertgids", "/test/niche/vergelijking"),
    );
  });

  it("path is included verbatim (no normalisation at this layer)", () => {
    const tag = pageTag("expertgids", "/test/niche/page?utm=x");
    expect(tag).toContain("/test/niche/page?utm=x");
  });
});

describe("PUBLIC_PAGE_REVALIDATE_SECONDS", () => {
  it("is 86400 (24h in seconds)", () => {
    expect(PUBLIC_PAGE_REVALIDATE_SECONDS).toBe(86_400);
  });
});
