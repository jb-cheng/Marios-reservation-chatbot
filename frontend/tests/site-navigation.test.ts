import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build, createServer } from "vite";
import type { ViteDevServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
let vite: ViteDevServer;

before(async () => {
  vite = await createServer({
    root,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
});

after(async () => {
  await vite?.close();
});

function links(markup: string) {
  return Array.from(markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g), ([, attributes, content]) => ({
    href: attributes.match(/\bhref="([^"]*)"/)?.[1],
    current: attributes.match(/\baria-current="([^"]*)"/)?.[1],
    label: content.replace(/<[^>]*>/g, "").trim(),
  }));
}

test("both header menus use independent document URLs, including the reservation root", async () => {
  const { SiteHeader } = await vite.ssrLoadModule("/src/components/site/SiteHeader.tsx");
  const markup = renderToStaticMarkup(createElement(SiteHeader, { name: "Mario's" }));
  const menus = Array.from(markup.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g), ([, menu]) => menu);
  assert.equal(menus.length, 2);
  for (const menu of menus) {
    assert.deepEqual(links(menu).map(({ href, label }) => ({ href, label })).sort((a, b) => a.label.localeCompare(b.label)), [
      { href: "/our-story/", label: "Our story" },
      { href: "/", label: "Reservations" },
      { href: "/the-experience/", label: "The experience" },
      { href: "/the-menu/", label: "The menu" },
    ]);
  }
  assert.equal(links(markup)[0].href, "/");
});

for (const [active, href] of [
  [undefined, "/"],
  ["our-story", "/our-story/"],
  ["the-menu", "/the-menu/"],
  ["the-experience", "/the-experience/"],
] as const) {
  test(`both header menus identify ${active ?? "reservations by default"} as the current page`, async () => {
    const { SiteHeader } = await vite.ssrLoadModule("/src/components/site/SiteHeader.tsx");
    const markup = renderToStaticMarkup(createElement(SiteHeader, { name: "Mario's", active }));
    assert.deepEqual(links(markup).filter((link) => link.current).map((link) => ({ href: link.href, current: link.current })), [
      { href, current: "page" },
      { href, current: "page" },
    ]);
  });
}

for (const component of ["MenuSection", "ExperienceSection"]) {
  test(`${component} sends its reservation CTA to the root document`, async () => {
    const module = await vite.ssrLoadModule(`/src/components/site/${component}.tsx`);
    const markup = renderToStaticMarkup(createElement(module[component], { config: null }));
    assert.deepEqual(links(markup).map((link) => link.href), ["/"]);
  });
}

test("native HTML handling serves direct page URLs without an SPA fallback", async () => {
  const server = createHttpServer(vite.middlewares);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [paths, expected] of [
      [["/", "/index.html"], "reservations"],
      [["/chat", "/chat.html"], "reservations"],
      [["/admin", "/admin.html"], "admin"],
      [["/our-story/", "/our-story/index.html"], "our-story"],
      [["/the-menu/", "/the-menu/index.html"], "the-menu"],
      [["/the-experience/", "/the-experience/index.html"], "the-experience"],
    ] as const) {
      for (const path of paths) {
        const response = await fetch(`${origin}${path}?mode=text`, { headers: { Accept: "text/html" } });
        assert.equal(response.status, 200, path);
        const html = await response.text();
        assert.equal(html.match(/data-page="([^"]+)"/)?.[1], expected, path);
      }
    }
    const missing = await fetch(`${origin}/not-a-page`, { headers: { Accept: "text/html" } });
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("production build emits six independent documents that select their own page", async () => {
  const result = await build({ root, logLevel: "silent", build: { write: false } });
  assert.ok(!Array.isArray(result) && "output" in result);
  const documents = result.output.filter((asset) => asset.type === "asset" && asset.fileName.endsWith(".html"));
  assert.deepEqual(documents.map((asset) => asset.fileName).sort(), [
    "admin.html",
    "chat.html",
    "index.html",
    "our-story/index.html",
    "the-experience/index.html",
    "the-menu/index.html",
  ]);

  const { default: App } = await vite.ssrLoadModule("/src/App.tsx");
  for (const asset of documents) {
    assert.equal(asset.type, "asset");
    const html = String(asset.source);
    const page = html.match(/data-page="([^"]+)"/)?.[1];
    const expected = asset.fileName === "index.html" || asset.fileName === "chat.html"
      ? "reservations"
      : asset.fileName.split("/")[0].replace(/\.html$/, "");
    assert.equal(page, expected, asset.fileName);
    assert.match(html, /<script\b[^>]*type="module"[^>]*src="\/assets\/[^"]+\.js"/);
    assert.match(html, /<link\b[^>]*rel="stylesheet"[^>]*href="\/assets\/[^"]+\.css"/);

    if (page === "reservations") continue;
    const markup = renderToStaticMarkup(createElement(App, { page }));
    if (page === "admin") {
      assert.match(markup, /<h1[^>]*>Reservation queue<\/h1>/);
      continue;
    }
    const sectionIds = Array.from(markup.matchAll(/<section\b[^>]*id="([^"]+)"/g), ([, id]) => id);
    assert.deepEqual(sectionIds, [page]);
    assert.match(markup, /<h1\b/);
    assert.deepEqual(links(markup).filter((link) => link.current).map((link) => link.href), [`/${page}/`, `/${page}/`]);
  }
});
