import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NODE_ENV = "test";
process.env.DB_PATH ||= join(tmpdir(), `ai-hub-test-${process.pid}.db`);
process.env.MEDIA_ROOT ||= join(tmpdir(), `ai-hub-media-${process.pid}`);

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
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function request(path, { method = "GET", body, cookie, redirect = "follow" } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${origin}${path}`, {
    method,
    headers,
    redirect,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function sessionCookie(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "Expected a session cookie");
  return header.split(";", 1)[0];
}

test("AI Hub authentication, permissions, plans, and shot pages work together", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", product: "AI Hub" });

  const anonymousHome = await request("/", { redirect: "manual" });
  assert.equal(anonymousHome.status, 302);
  assert.equal(anonymousHome.headers.get("location"), "/login");

  const anonymousThumbnail = await request("/storage/thumbnails/cinematic-frames", { redirect: "manual" });
  assert.equal(anonymousThumbnail.status, 302);
  assert.equal(anonymousThumbnail.headers.get("location"), "/login");

  const adminActivation = await request("/auth/activate", {
    method: "POST",
    body: {
      username: "admin",
      password: "Admin-Test-Password-1",
      confirmation: "Admin-Test-Password-1"
    }
  });
  assert.equal(adminActivation.status, 200);
  const adminCookie = sessionCookie(adminActivation);

  const storedThumbnail = await request("/storage/thumbnails/cinematic-frames", { cookie: adminCookie });
  assert.equal(storedThumbnail.status, 200);
  assert.equal(storedThumbnail.headers.get("content-type"), "image/png");
  assert.match(storedThumbnail.headers.get("etag"), /^"[a-f0-9]{64}"$/);
  const storedThumbnailBytes = new Uint8Array(await storedThumbnail.arrayBuffer());
  assert.ok(storedThumbnailBytes.byteLength > 8);
  assert.deepEqual(storedThumbnailBytes.slice(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  for (const account of [
    { username: "docker.creator", display_name: "Docker Creator", role: "Creator" },
    { username: "docker.supervisor", display_name: "Docker Supervisor", role: "Supervisor" }
  ]) {
    const created = await request("/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: account
    });
    assert.equal(created.status, 201);
  }

  const creatorActivation = await request("/auth/activate", {
    method: "POST",
    body: {
      username: "docker.creator",
      password: "Creator-Test-Password-1",
      confirmation: "Creator-Test-Password-1"
    }
  });
  assert.equal(creatorActivation.status, 200);
  const creatorCookie = sessionCookie(creatorActivation);

  const accountAccess = await request("/api/users", { cookie: creatorCookie });
  assert.equal(accountAccess.status, 403);

  const planResponse = await request("/api/plans", {
    method: "POST",
    cookie: creatorCookie,
    body: {
      shot_code: "DCK-001",
      title: "Docker integration shot",
      description: "Created by the containerized integration test",
      media_type: "Video"
    }
  });
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json();
  assert.equal(plan.status, "Idea");

  const resourceForm = new FormData();
  resourceForm.append("category", "Reference");
  resourceForm.append("notes", "Containerized upload fixture");
  const resourceBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 65, 73, 72, 85, 66]);
  resourceForm.append("file", new Blob([resourceBytes], { type: "image/png" }), "reference-frame.png");
  const resourceResponse = await fetch(`${origin}/api/plans/${plan.id}/resources`, {
    method: "POST",
    headers: { cookie: creatorCookie },
    body: resourceForm
  });
  assert.equal(resourceResponse.status, 201);
  const resource = await resourceResponse.json();
  assert.equal(resource.original_name, "reference-frame.png");
  assert.equal(resource.category, "Reference");
  assert.equal(resource.kind, "image");
  assert.equal(resource.size_bytes, resourceBytes.byteLength);
  assert.match(resource.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(resource.storage_key, undefined);

  const resourceContent = await fetch(`${origin}/resources/${resource.id}/content`, {
    headers: { cookie: creatorCookie }
  });
  assert.equal(resourceContent.status, 200);
  assert.equal(resourceContent.headers.get("accept-ranges"), "bytes");
  assert.match(resourceContent.headers.get("content-disposition"), /^inline;/);
  assert.deepEqual(new Uint8Array(await resourceContent.arrayBuffer()), resourceBytes);

  const resourceRange = await fetch(`${origin}/resources/${resource.id}/content`, {
    headers: { cookie: creatorCookie, range: "bytes=0-3" }
  });
  assert.equal(resourceRange.status, 206);
  assert.equal(resourceRange.headers.get("content-range"), `bytes 0-3/${resourceBytes.byteLength}`);
  assert.deepEqual(new Uint8Array(await resourceRange.arrayBuffer()), resourceBytes.slice(0, 4));

  const forbiddenApproval = await request(`/api/plans/${plan.id}/status`, {
    method: "PATCH",
    cookie: creatorCookie,
    body: { status: "Approved" }
  });
  assert.equal(forbiddenApproval.status, 403);

  const supervisorActivation = await request("/auth/activate", {
    method: "POST",
    body: {
      username: "docker.supervisor",
      password: "Supervisor-Test-Password-1",
      confirmation: "Supervisor-Test-Password-1"
    }
  });
  assert.equal(supervisorActivation.status, 200);
  const supervisorCookie = sessionCookie(supervisorActivation);

  const approval = await request(`/api/plans/${plan.id}/status`, {
    method: "PATCH",
    cookie: supervisorCookie,
    body: { status: "Approved" }
  });
  assert.equal(approval.status, 200);
  assert.equal((await approval.json()).status, "Approved");

  const shotPage = await request(`/plans/${plan.id}`, { cookie: supervisorCookie });
  assert.equal(shotPage.status, 200);
  const html = await shotPage.text();
  assert.match(html, /Docker integration shot/);
  assert.match(html, /Media & production files/);
  assert.match(html, /reference-frame\.png/);
  assert.match(html, /\/js\/plan-detail\.js/);

  const resourceDelete = await request(`/api/resources/${resource.id}`, {
    method: "DELETE",
    cookie: creatorCookie
  });
  assert.equal(resourceDelete.status, 204);

  const deletedContent = await fetch(`${origin}/resources/${resource.id}/content`, {
    headers: { cookie: creatorCookie }
  });
  assert.equal(deletedContent.status, 404);
});
