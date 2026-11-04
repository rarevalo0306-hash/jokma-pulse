import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.VERCEL = "1";
const { default: app } = await import("../server.js");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("privacidad, borrado y términos se leen sin sesión", async () => {
  const server = await listen(app);
  const { port } = server.address();
  try {
    for (const path of ["/privacidad", "/eliminar-datos", "/terminos"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /html/);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.match(body, /rarevalo0306@gmail.com/);
      assert.match(body, /Fameseg/);
      assert.match(body, /1036513856135777/);
      assert.doesNotMatch(body, /lumen123/);
    }
    const icon = await fetch(`http://127.0.0.1:${port}/jokma-pulse-icon-1024.png`);
    const bytes = Buffer.from(await icon.arrayBuffer());
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") || "", /png/);
    assert.equal(bytes.readUInt32BE(16), 1024);
    assert.equal(bytes.readUInt32BE(20), 1024);
    assert.ok(bytes.length < 5 * 1024 * 1024);
    assert.equal(bytes[25], 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
