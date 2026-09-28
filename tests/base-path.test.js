import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NODE_ENV = "test";
process.env.BASE_PATH = "/AIHub";
process.env.DB_PATH = join(tmpdir(), `ai-hub-basepath-test-${process.pid}.db`);
process.env.MEDIA_ROOT = join(tmpdir(), `ai-hub-basepath-media-${process.pid}`);

const { app } = await import("../server.js");

let server;
let origin;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("AI Hub handles BASE_PATH=/AIHub properly", async () => {
  // Direct container health check should always succeed at root /health
  const rootHealth = await fetch(`${origin}/health`);
  assert.equal(rootHealth.status, 200);
  assert.deepEqual(await rootHealth.json(), { status: "ok", product: "AI Hub" });

  // Health check under the subpath
  const subHealth = await fetch(`${origin}/AIHub/health`);
  assert.equal(subHealth.status, 200);
  assert.deepEqual(await subHealth.json(), { status: "ok", product: "AI Hub" });

  // Root / redirects to /AIHub/
  const rootRedirect = await fetch(`${origin}/`, { redirect: "manual" });
  assert.equal(rootRedirect.status, 302);
  assert.equal(rootRedirect.headers.get("location"), "/AIHub/");

  // /AIHub redirects to /AIHub/
  const noSlashRedirect = await fetch(`${origin}/AIHub`, { redirect: "manual" });
  assert.equal(noSlashRedirect.status, 301);
  assert.equal(noSlashRedirect.headers.get("location"), "/AIHub/");

  // Anonymous request to /AIHub/ redirects to /AIHub/login
  const anonymousHome = await fetch(`${origin}/AIHub/`, { redirect: "manual" });
  assert.equal(anonymousHome.status, 302);
  assert.equal(anonymousHome.headers.get("location"), "/AIHub/login");

  // Login page contains prefixed assets and base script
  const loginPage = await fetch(`${origin}/AIHub/login`);
  assert.equal(loginPage.status, 200);
  const html = await loginPage.text();
  assert.ok(html.includes('href="/AIHub/css/app.css"'), "Stylesheet should be prefixed with /AIHub");
  assert.ok(html.includes('src="/AIHub/vendor/lucide/lucide.js"'), "Lucide vendor script should be prefixed with /AIHub");
  assert.ok(html.includes('src="/AIHub/js/auth.js"'), "Auth script should be prefixed with /AIHub");
  assert.ok(html.includes('window.__AI_HUB_BASE__ = "/AIHub"'), "window.__AI_HUB_BASE__ should be set to /AIHub");
  assert.ok(html.includes('--cinematic-thumbnail: url("/AIHub/storage/thumbnails/cinematic-frames")'), "CSS custom property for thumbnail should be set");

  const activation = await fetch(`${origin}/AIHub/auth/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Base-Path-Test-1", confirmation: "Base-Path-Test-1" })
  });
  assert.equal(activation.status, 200);
  const cookie = activation.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "Activation should set a session cookie");

  const planResponse = await fetch(`${origin}/AIHub/api/plans`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ sequence_number: 1, shot_number: 1, title: "Base-path upload" })
  });
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json();

  const upload = new FormData();
  upload.append("sequence_number", "1");
  upload.append("shot_number", "1");
  upload.append("category", "Reference");
  upload.append("file", new Blob(["upload through base path"], { type: "image/png" }), "base-path.png");
  const uploadResponse = await fetch(`${origin}/AIHub/api/plans/${plan.id}/resources`, { method: "POST", headers: { cookie }, body: upload });
  assert.equal(uploadResponse.status, 201);
  const uploadedResource = await uploadResponse.json();
  const plansResponse = await fetch(`${origin}/AIHub/api/plans?sequence_number=1&shot_number=1`, { headers: { cookie } });
  assert.equal(plansResponse.status, 200);
  const [coveredPlan] = await plansResponse.json();
  assert.equal(coveredPlan.cover_url, `/AIHub/resources/${uploadedResource.id}/content`);
});
