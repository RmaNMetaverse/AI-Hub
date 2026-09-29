import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdir } from "node:fs/promises";
import Database from "better-sqlite3";

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

  const rolesResponse = await request("/api/users", { cookie: adminCookie });
  assert.equal(rolesResponse.status, 200);
  const initialRoles = (await rolesResponse.json()).roles;
  assert.ok(initialRoles.some((role) => role.name === "Generator" && role.can_edit_plans));
  const generatorRole = initialRoles.find((role) => role.name === "Generator");
  const protectedRoleEdit = await request(`/api/roles/${generatorRole.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed" } });
  assert.equal(protectedRoleEdit.status, 400);

  const customRoleResponse = await request("/api/roles", {
    method: "POST", cookie: adminCookie,
    body: { name: "Asset Wrangler", description: "Manages shared production assets", can_manage_libraries: true }
  });
  assert.equal(customRoleResponse.status, 201);
  const customRole = await customRoleResponse.json();
  assert.equal(customRole.can_manage_libraries, true);
  const updatedRoleResponse = await request(`/api/roles/${customRole.id}`, {
    method: "PATCH", cookie: adminCookie,
    body: { name: "Asset Wrangler", description: "Manages libraries and reviews", can_manage_libraries: true, can_review_plans: true }
  });
  assert.equal(updatedRoleResponse.status, 200);
  assert.equal((await updatedRoleResponse.json()).can_review_plans, true);

  const storedThumbnail = await request("/storage/thumbnails/cinematic-frames", { cookie: adminCookie });
  assert.equal(storedThumbnail.status, 200);
  assert.equal(storedThumbnail.headers.get("content-type"), "image/png");
  assert.match(storedThumbnail.headers.get("etag"), /^"[a-f0-9]{64}"$/);
  const storedThumbnailBytes = new Uint8Array(await storedThumbnail.arrayBuffer());
  assert.ok(storedThumbnailBytes.byteLength > 8);
  assert.deepEqual(storedThumbnailBytes.slice(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  let assetUserId;
  let creatorUserId;
  for (const account of [
    { username: "docker.creator", display_name: "Docker Creator", role: "Creator" },
    { username: "docker.supervisor", display_name: "Docker Supervisor", role: "Supervisor" },
    { username: "docker.assets", display_name: "Asset User", role: "Asset Wrangler" }
  ]) {
    const created = await request("/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: account
    });
    assert.equal(created.status, 201);
    const createdAccount = await created.json();
    if (createdAccount.username === "docker.assets") assetUserId = createdAccount.id;
    if (createdAccount.username === "docker.creator") creatorUserId = createdAccount.id;
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

  const assetActivation = await request("/auth/activate", {
    method: "POST",
    body: { username: "docker.assets", password: "Assets-Test-Password-1", confirmation: "Assets-Test-Password-1" }
  });
  assert.equal(assetActivation.status, 200);
  const assetCookie = sessionCookie(assetActivation);

  const accountAccess = await request("/api/users", { cookie: creatorCookie });
  assert.equal(accountAccess.status, 403);

  const promptPage = await request("/prompt-library", { cookie: creatorCookie });
  assert.equal(promptPage.status, 200);
  assert.match(await promptPage.text(), /id="libraryGrid"/);
  const promptResponse = await request("/api/prompts", {
    method: "POST", cookie: creatorCookie,
    body: { title: "Orbital reveal", prompt: "Slow orbital camera around the signal tower", negative_prompt: "flicker", tags: "camera, night" }
  });
  assert.equal(promptResponse.status, 201);
  const savedPrompt = await promptResponse.json();
  assert.deepEqual(savedPrompt.tags, ["camera", "night"]);

  const promptAssetBytes = new Uint8Array([80, 82, 79, 77, 80, 84]);
  const promptAssetForm = new FormData();
  promptAssetForm.append("file", new Blob([promptAssetBytes], { type: "video/mp4" }), "orbit-example.mp4");
  const promptAssetResponse = await fetch(`${origin}/api/prompts/${savedPrompt.id}/assets`, { method: "POST", headers: { cookie: creatorCookie }, body: promptAssetForm });
  assert.equal(promptAssetResponse.status, 201);
  const savedPromptAsset = await promptAssetResponse.json();
  assert.equal(savedPromptAsset.kind, "video");
  const promptAssetContent = await fetch(`${origin}${savedPromptAsset.content_url}`, { headers: { cookie: creatorCookie } });
  assert.deepEqual(new Uint8Array(await promptAssetContent.arrayBuffer()), promptAssetBytes);

  const assetPage = await request("/asset-library", { cookie: creatorCookie });
  assert.equal(assetPage.status, 200);
  const assetPageHtml = await assetPage.text();
  assert.match(assetPageHtml, /asset-category-filter/);
  assert.match(assetPageHtml, /assetViewerModal/);
  const tagResponse = await request("/api/library-asset-tags", { method: "POST", cookie: creatorCookie, body: { tag: "turnaround" } });
  assert.equal(tagResponse.status, 201);
  assert.deepEqual(await tagResponse.json(), { tag: "turnaround" });
  const assetBytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  const assetForm = new FormData();
  assetForm.append("title", "Lead character sheet");
  assetForm.append("category", "Character Sheet");
  assetForm.append("tags", "lead, costume");
  assetForm.append("description", "Approved turnaround sheet");
  assetForm.append("files", new Blob([assetBytes], { type: "application/pdf" }), "lead-character.pdf");
  assetForm.append("files", new Blob([new Uint8Array([80, 78, 71])], { type: "image/png" }), "lead-character-color.png");
  const assetResponse = await fetch(`${origin}/api/library-assets`, { method: "POST", headers: { cookie: creatorCookie }, body: assetForm });
  assert.equal(assetResponse.status, 201);
  const savedAsset = await assetResponse.json();
  assert.equal(savedAsset.category, "Character Sheet");
  assert.equal(savedAsset.kind, "document");
  assert.deepEqual(savedAsset.tags, ["lead", "costume"]);
  assert.equal(savedAsset.files.length, 2);
  const pdfPreview = await fetch(`${origin}${savedAsset.files[0].content_url}`, { headers: { cookie: creatorCookie } });
  assert.equal(pdfPreview.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(pdfPreview.headers.get("content-disposition"), /^inline/);
  const secondAssetFile = await fetch(`${origin}${savedAsset.files[1].content_url}`, { headers: { cookie: creatorCookie } });
  assert.deepEqual(new Uint8Array(await secondAssetFile.arrayBuffer()), new Uint8Array([80, 78, 71]));
  const assetList = await request("/api/library-assets", { cookie: creatorCookie });
  const assetPayload = await assetList.json();
  assert.equal(assetPayload.assets[0].title, "Lead character sheet");
  assert.deepEqual(assetPayload.tags, ["costume", "lead", "turnaround"]);

  const catalogAccess = await request("/api/admin/catalogs", { cookie: creatorCookie });
  assert.equal(catalogAccess.status, 403);

  const catalogsResponse = await request("/api/admin/catalogs", { cookie: adminCookie });
  assert.equal(catalogsResponse.status, 200);
  const catalogs = await catalogsResponse.json();
  assert.deepEqual(catalogs.models.filter((item) => item.active).map((item) => item.name).sort(), [
    "Gemini Omni", "Kling 3.0", "LTX", "Seedance 2.0", "Seedance 2.0 Fast", "Seedance 2.5"
  ].sort());
  assert.deepEqual(catalogs.platforms.filter((item) => item.active).map((item) => item.name).sort(), ["ComfyUI", "Higgsfield", "Vidax"].sort());
  assert.ok(catalogs.asset_categories.some((item) => item.name === "Character Sheet" && item.active));

  const outputRole = catalogs.resource_roles.find((item) => item.name === "Output");
  const removeOutputResponse = await request(`/api/admin/catalogs/resource_roles/${outputRole.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { active: false }
  });
  assert.equal(removeOutputResponse.status, 400);

  const higgsfield = catalogs.platforms.find((item) => item.name === "Higgsfield");
  const priceResponse = await request(`/api/admin/catalogs/platforms/${higgsfield.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { token_price: 0.25 }
  });
  assert.equal(priceResponse.status, 200);

  const roleResponse = await request("/api/admin/catalogs/resource_roles", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Style Reference" }
  });
  assert.equal(roleResponse.status, 201);
  const styleReferenceRole = await roleResponse.json();

  const planResponse = await request("/api/plans", {
    method: "POST",
    cookie: creatorCookie,
    body: {
      sequence_number: 99,
      shot_number: 7,
      title: "Docker integration shot",
      description: "Created by the containerized integration test",
      media_type: "Video",
      model: "Seedance 2.5",
      due_date: "2099-01-01T12:00"
    }
  });
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json();
  assert.equal(plan.status, "WIP");
  assert.equal(plan.sequence_number, 99);
  assert.equal(plan.shot_number, 7);
  assert.equal(plan.shot_code, "SQ99-SH007");
  assert.equal(Object.hasOwn(plan, "due_date"), false);
  assert.deepEqual(plan.assignees, []);
  assert.equal((await request(`/api/plans/${plan.id}/assignees`, { method: "PUT", cookie: creatorCookie, body: { user_ids: [creatorUserId] } })).status, 403);
  const availableAssignees = await request("/api/assignment-users", { cookie: adminCookie });
  assert.equal(availableAssignees.status, 200);
  assert.ok((await availableAssignees.json()).some((user) => user.id === creatorUserId));
  const assignment = await request(`/api/plans/${plan.id}/assignees`, { method: "PUT", cookie: adminCookie,
    body: { user_ids: [creatorUserId, assetUserId] } });
  assert.equal(assignment.status, 200);
  assert.deepEqual((await assignment.json()).assignees.map((user) => user.id).sort(), [creatorUserId, assetUserId].sort());
  assert.equal((await request(`/api/plans/${plan.id}/assignees`, { method: "PUT", cookie: adminCookie,
    body: { user_ids: [999999] } })).status, 400);
  assert.equal((await request(`/api/plans/${plan.id}/assignees`, { method: "PUT", cookie: adminCookie,
    body: { user_ids: [creatorUserId, assetUserId] } })).status, 200);
  const creatorNotificationsResponse = await request("/api/notifications", { cookie: creatorCookie });
  assert.equal(creatorNotificationsResponse.status, 200);
  const creatorNotifications = await creatorNotificationsResponse.json();
  const assignmentNotice = creatorNotifications.notifications.find((item) => item.kind === "plan_assigned" && item.plan_id === plan.id);
  assert.ok(assignmentNotice);
  assert.equal(creatorNotifications.notifications.filter((item) => item.kind === "plan_assigned" && item.plan_id === plan.id).length, 1);
  assert.equal((await request(`/api/notifications/${assignmentNotice.id}/read`, { method: "PATCH", cookie: assetCookie })).status, 200);
  const stillUnread = await (await request("/api/notifications", { cookie: creatorCookie })).json();
  assert.ok(stillUnread.notifications.find((item) => item.id === assignmentNotice.id && !item.read_at));
  await request(`/api/notifications/${assignmentNotice.id}/read`, { method: "PATCH", cookie: creatorCookie });
  const readNotice = await (await request("/api/notifications", { cookie: creatorCookie })).json();
  assert.ok(readNotice.notifications.find((item) => item.id === assignmentNotice.id && item.read_at));
  const allRead = await request("/api/notifications/read-all", { method: "PATCH", cookie: creatorCookie });
  assert.equal(allRead.status, 200);
  assert.equal((await allRead.json()).unread_count, 0);

  for (const numbers of [
    {}, { sequence_number: 99 }, { shot_number: 7 },
    { sequence_number: 0, shot_number: 7 }, { sequence_number: 99, shot_number: -1 },
    { sequence_number: 1.5, shot_number: 7 }, { sequence_number: true, shot_number: 7 },
    { sequence_number: 99, shot_number: 1_000_001 }
  ]) {
    const invalid = await request("/api/plans", { method: "POST", cookie: creatorCookie, body: { title: "Invalid shot", ...numbers } });
    assert.equal(invalid.status, 400, JSON.stringify(numbers));
  }
  const relatedPlans = [];
  for (const numbers of [{ sequence_number: 99, shot_number: 8 }, { sequence_number: 100, shot_number: 7 }]) {
    const created = await request("/api/plans", { method: "POST", cookie: creatorCookie, body: { title: "Filter fixture", ...numbers } });
    assert.equal(created.status, 201);
    relatedPlans.push(await created.json());
  }
  for (const [query, ids] of [
    ["sequence_number=99", [plan.id, relatedPlans[0].id]],
    ["shot_number=7", [plan.id, relatedPlans[1].id]],
    ["sequence_number=99&shot_number=7", [plan.id]],
    ["sequence_number=999999", []]
  ]) {
    const filtered = await request(`/api/plans?${query}`, { cookie: creatorCookie });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json()).map((item) => item.id).sort(), ids.sort());
  }
  assert.equal((await request("/api/plans?shot_number=1.5", { cookie: creatorCookie })).status, 400);
  assert.equal((await request("/api/plans?sequence_number=-1", { cookie: creatorCookie })).status, 400);
  const home = await request("/?sequence_number=99", { cookie: creatorCookie });
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /id="planGrid"/);
  assert.match(homeHtml, /id="planCardSizeRange"/);
  assert.match(homeHtml, /id="assignmentFilter"/);
  assert.match(homeHtml, /id="sequenceFilter"/);
  assert.match(homeHtml, /id="shotFilter"/);
  assert.doesNotMatch(homeHtml, /id="boardView"/);
  const newPlanFormHtml = homeHtml.match(/<form id="newPlanForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(newPlanFormHtml, /due_date|Due date/i);
  assert.doesNotMatch(newPlanFormHtml, /name="media_type"/);
  assert.doesNotMatch(newPlanFormHtml, /name="model"/);
  assert.match(newPlanFormHtml, /name="description"/);
  assert.doesNotMatch(newPlanFormHtml, /Upload Assets|name="assets"|name="asset_role"|Asset \/ Media type/);
  assert.doesNotMatch(newPlanFormHtml, /name="prompt"/);
  for (const key of ["sequence_number", "shot_number"]) {
    const changed = await request(`/api/plans/${plan.id}`, { method: "PATCH", cookie: creatorCookie, body: { [key]: 9 } });
    assert.equal(changed.status, 400);
    assert.match((await changed.json()).error, /locked/);
  }

  // A rejected upload must leave no file behind, even when multipart fields follow the file.
  const mediaFiles = async () => (await readdir(process.env.MEDIA_ROOT, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  const mediaBefore = await mediaFiles();
  for (const numbers of [{}, { sequence_number: 98, shot_number: 7 }]) {
    const invalidForm = new FormData();
    invalidForm.append("file", new Blob(["rejected upload"]), "rejected.txt");
    for (const [key, value] of Object.entries(numbers)) invalidForm.append(key, value);
    const invalid = await fetch(`${origin}/api/plans/${plan.id}/resources`, { method: "POST", headers: { cookie: creatorCookie }, body: invalidForm });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /#Seq|#Shot/);
  }
  assert.deepEqual(await mediaFiles(), mediaBefore);

  const resourceForm = new FormData();
  resourceForm.append("sequence_number", plan.sequence_number);
  resourceForm.append("shot_number", plan.shot_number);
  resourceForm.append("category", "Reference");
  resourceForm.append("asset_role", "First Frame");
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
  assert.equal(resource.asset_role, "First Frame");
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

  const outputForm = new FormData();
  outputForm.append("sequence_number", plan.sequence_number);
  outputForm.append("shot_number", plan.shot_number);
  outputForm.append("category", "Generation");
  outputForm.append("asset_role", "Output");
  outputForm.append("notes", "Primary generated output");
  const outputBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 79, 85, 84, 80, 85, 84]);
  outputForm.append("file", new Blob([outputBytes], { type: "image/png" }), "generation-output.png");
  const outputResponse = await fetch(`${origin}/api/plans/${plan.id}/resources`, {
    method: "POST",
    headers: { cookie: creatorCookie },
    body: outputForm
  });
  assert.equal(outputResponse.status, 201);
  const outputResource = await outputResponse.json();
  const latestMediaCoverResponse = await request(`/api/plans?sequence_number=${plan.sequence_number}&shot_number=${plan.shot_number}`, { cookie: creatorCookie });
  const latestMediaPlan = (await latestMediaCoverResponse.json())[0];
  assert.equal(latestMediaPlan.cover_id, outputResource.id);
  assert.equal(latestMediaPlan.cover_kind, "image");
  assert.equal(latestMediaPlan.cover_source, "latest");
  assert.equal(latestMediaPlan.cover_url, `/resources/${outputResource.id}/content`);

  const firstGenerationResponse = await request(`/api/plans/${plan.id}/generations`, {
    method: "POST",
    cookie: creatorCookie,
    body: {
      sequence_number: plan.sequence_number,
      shot_number: plan.shot_number,
      version_number: 1,
      model: "Seedance 2.5",
      prompt: "A precise test generation prompt",
      negative_prompt: "flicker, watermark",
      notes: "First complete candidate",
      platform_id: higgsfield.id,
      token_count: 12,
      seed: "12345",
      resources: [
        { resource_id: outputResource.id, role: "Output" },
        { resource_id: resource.id, role: "First Frame" }
      ]
    }
  });
  assert.equal(firstGenerationResponse.status, 201);
  const firstGeneration = (await firstGenerationResponse.json()).generation;
  assert.equal(firstGeneration.version_label, "v1");
  assert.equal(firstGeneration.sequence_number, 99);
  assert.equal(firstGeneration.shot_number, 7);
  assert.equal(firstGeneration.label, "v1");
  assert.equal(firstGeneration.generation_cost, 3);
  assert.equal(firstGeneration.total_tokens, 12);
  assert.equal(firstGeneration.platform_name, "Higgsfield");
  assert.equal(firstGeneration.token_price_snapshot, 0.25);
  assert.equal(firstGeneration.resources.length, 2);
  assert.equal(firstGeneration.resources.find((item) => item.role === "Output").id, outputResource.id);
  const planWithGeneration = await request(`/api/plans/${plan.id}`, { cookie: creatorCookie });
  const planFiles = await planWithGeneration.json();
  assert.ok(planFiles.resources.some((item) => item.id === outputResource.id));
  assert.deepEqual(planFiles.assets.map((item) => item.id), [resource.id]);
  assert.equal(planFiles.resource_count, 1);

  const duplicateVersionResponse = await request(`/api/plans/${plan.id}/generations`, {
    method: "POST",
    cookie: creatorCookie,
    body: { sequence_number: 99, shot_number: 7, version_number: 1, model: "Seedance 2.0", platform_id: higgsfield.id, token_count: 1 }
  });
  assert.equal(duplicateVersionResponse.status, 400);
  assert.match((await duplicateVersionResponse.json()).error, /v1 already exists/);
  for (const numbers of [{}, { sequence_number: 99 }, { sequence_number: 99, shot_number: 8 }, { sequence_number: 99, shot_number: 1.5 }]) {
    const invalid = await request(`/api/plans/${plan.id}/generations`, {
      method: "POST", cookie: creatorCookie,
      body: { version_number: 2, model: "Seedance 2.0", platform_id: higgsfield.id, ...numbers }
    });
    assert.equal(invalid.status, 400);
  }
  for (const body of [{ sequence_number: 100 }, { shot_number: 8 }, { plan_id: relatedPlans[0].id }]) {
    const invalid = await request(`/api/generations/${firstGeneration.id}`, { method: "PATCH", cookie: creatorCookie, body });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /locked/);
  }

  const newPriceResponse = await request(`/api/admin/catalogs/platforms/${higgsfield.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { token_price: 0.5 }
  });
  assert.equal(newPriceResponse.status, 200);

  const seedanceModel = catalogs.models.find((item) => item.name === "Seedance 2.5");
  const removeModelResponse = await request(`/api/admin/catalogs/models/${seedanceModel.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { active: false }
  });
  assert.equal(removeModelResponse.status, 200);

  const secondGenerationResponse = await request(`/api/plans/${plan.id}/generations`, {
    method: "POST",
    cookie: creatorCookie,
    body: {
      sequence_number: plan.sequence_number,
      shot_number: plan.shot_number,
      version_number: 2,
      model: "Seedance 2.0",
      prompt: "A revised test generation prompt",
      platform_id: higgsfield.id,
      token_count: 12,
      resources: [
        { resource_id: resource.id, role: "Style Reference" },
        { resource_id: outputResource.id, role: "Reference Image" }
      ]
    }
  });
  assert.equal(secondGenerationResponse.status, 201);
  const secondGeneration = (await secondGenerationResponse.json()).generation;
  assert.equal(secondGeneration.version_label, "v2");
  assert.equal(secondGeneration.generation_cost, 6);
  assert.equal(secondGeneration.token_price_snapshot, 0.5);
  assert.equal(secondGeneration.resources.find((item) => item.id === resource.id).role, "Style Reference");

  const updateGenerationResponse = await request(`/api/generations/${secondGeneration.id}`, {
    method: "PATCH",
    cookie: creatorCookie,
    body: {
      notes: "Reused the v1 first frame and output reference"
    }
  });
  assert.equal(updateGenerationResponse.status, 200);
  assert.match((await updateGenerationResponse.json()).generation.notes, /Reused the v1/);

  const renamedPlatformResponse = await request(`/api/admin/catalogs/platforms/${higgsfield.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { name: "Higgsfield Studio", token_price: 0.75 }
  });
  assert.equal(renamedPlatformResponse.status, 200);
  const removeRoleResponse = await request(`/api/admin/catalogs/resource_roles/${styleReferenceRole.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { active: false }
  });
  assert.equal(removeRoleResponse.status, 200);

  const historyResponse = await request(`/api/plans/${plan.id}`, { cookie: creatorCookie });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  const historicalFirst = history.generations.find((item) => item.id === firstGeneration.id);
  const historicalSecond = history.generations.find((item) => item.id === secondGeneration.id);
  assert.equal(historicalFirst.model, "Seedance 2.5");
  assert.equal(historicalFirst.platform_name, "Higgsfield");
  assert.equal(historicalFirst.token_price_snapshot, 0.25);
  assert.equal(historicalFirst.generation_cost, 3);
  assert.equal(historicalSecond.platform_name, "Higgsfield");
  assert.equal(historicalSecond.token_price_snapshot, 0.5);
  assert.equal(historicalSecond.generation_cost, 6);
  assert.equal(historicalSecond.resources.find((item) => item.id === resource.id).role, "Style Reference");

  const selectGenerationResponse = await request(`/api/plans/${plan.id}/selected-generation`, {
    method: "PATCH",
    cookie: creatorCookie,
    body: { generation_id: firstGeneration.id }
  });
  assert.equal(selectGenerationResponse.status, 403);
  const adminSelectionResponse = await request(`/api/plans/${plan.id}/selected-generation`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { generation_id: firstGeneration.id }
  });
  assert.equal(adminSelectionResponse.status, 200);
  const selectedPlan = await adminSelectionResponse.json();
  assert.equal(selectedPlan.selected_generation_id, firstGeneration.id);
  assert.equal(selectedPlan.selected_generation.id, firstGeneration.id);
  assert.equal(selectedPlan.resources.find((item) => item.id === resource.id).generation_usage_count, 2);

  const forbiddenApproval = await request(`/api/plans/${plan.id}/status`, {
    method: "PATCH",
    cookie: creatorCookie,
    body: { status: "Approved" }
  });
  assert.equal(forbiddenApproval.status, 403);
  const forbiddenGenApproval = await request(`/api/generations/${firstGeneration.id}/status`, {
    method: "PATCH",
    cookie: creatorCookie,
    body: { status: "Approved" }
  });
  assert.equal(forbiddenGenApproval.status, 403);
  const creatorApproval = await request(`/api/plans/${plan.id}/approval`, { method: "POST", cookie: creatorCookie });
  assert.equal(creatorApproval.status, 403);
  const adminApproval = await request(`/api/plans/${plan.id}/approval`, { method: "POST", cookie: adminCookie });
  assert.equal(adminApproval.status, 403);
  const adminGenerationApproval = await request(`/api/generations/${firstGeneration.id}/approval`, { method: "POST", cookie: adminCookie });
  assert.equal(adminGenerationApproval.status, 403);
  const customRoleApproval = await request(`/api/plans/${plan.id}/approval`, { method: "POST", cookie: assetCookie });
  assert.equal(customRoleApproval.status, 403);

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
  const supervisorNotifications = await (await request("/api/notifications", { cookie: supervisorCookie })).json();
  assert.ok(supervisorNotifications.notifications.some((item) => item.kind === "created_plan" && item.plan_id === plan.id));
  assert.ok(supervisorNotifications.notifications.some((item) => item.kind === "created_generation" && item.plan_id === plan.id));
  const supervisorAssignment = await request(`/api/plans/${plan.id}/assignees`, { method: "PUT", cookie: supervisorCookie,
    body: { user_ids: [creatorUserId] } });
  assert.equal(supervisorAssignment.status, 200);
  assert.deepEqual((await supervisorAssignment.json()).assignees.map((user) => user.id), [creatorUserId]);

  const prematureDelivery = await request(`/api/plans/${plan.id}/status`, { method: "PATCH", cookie: supervisorCookie, body: { status: "Delivered" } });
  assert.equal(prematureDelivery.status, 400);

  const directApproval = await request(`/api/plans/${plan.id}/status`, { method: "PATCH", cookie: supervisorCookie, body: { status: "Approved" } });
  assert.equal(directApproval.status, 200);
  assert.equal((await directApproval.json()).status, "Approved");

  const resetToWip = await request(`/api/plans/${plan.id}/status`, { method: "PATCH", cookie: supervisorCookie, body: { status: "WIP" } });
  assert.equal(resetToWip.status, 200);
  assert.equal((await resetToWip.json()).status, "WIP");

  const approval = await request(`/api/plans/${plan.id}/approval`, { method: "POST", cookie: supervisorCookie });
  assert.equal(approval.status, 200);
  const approvedPlan = await approval.json();
  assert.equal(approvedPlan.status, "Approved");
  assert.equal(approvedPlan.approval.approved_by_name, "Docker Supervisor");
  assert.equal(approvedPlan.approval.generation_id, firstGeneration.id);
  assert.equal(approvedPlan.selected_generation.status, "Approved");

  const toggleGenWip = await request(`/api/generations/${firstGeneration.id}/status`, { method: "PATCH", cookie: supervisorCookie, body: { status: "WIP" } });
  assert.equal(toggleGenWip.status, 200);
  assert.equal((await toggleGenWip.json()).generation.status, "WIP");

  const toggleGenApprove = await request(`/api/generations/${firstGeneration.id}/approval`, { method: "POST", cookie: supervisorCookie });
  assert.equal(toggleGenApprove.status, 200);
  assert.equal((await toggleGenApprove.json()).generation.status, "Approved");

  const approvedCoverResponse = await request(`/api/plans?sequence_number=${plan.sequence_number}&shot_number=${plan.shot_number}`, { cookie: creatorCookie });
  assert.equal((await approvedCoverResponse.json())[0].cover_source, "approved");

  const invalidCoverForm = new FormData();
  invalidCoverForm.append("file", new Blob(["not an image"], { type: "text/plain" }), "cover.txt");
  const invalidCoverResponse = await fetch(`${origin}/api/plans/${plan.id}/cover`, { method: "POST", headers: { cookie: creatorCookie }, body: invalidCoverForm });
  assert.equal(invalidCoverResponse.status, 400);

  const customCoverBytes = new Uint8Array([255, 216, 255, 224, 65, 73, 72, 85, 66, 255, 217]);
  const customCoverForm = new FormData();
  customCoverForm.append("file", new Blob([customCoverBytes], { type: "image/jpeg" }), "custom-cover.jpg");
  const customCoverResponse = await fetch(`${origin}/api/plans/${plan.id}/cover`, { method: "POST", headers: { cookie: creatorCookie }, body: customCoverForm });
  const customCoverPlan = await customCoverResponse.json();
  assert.equal(customCoverResponse.status, 201, JSON.stringify(customCoverPlan));
  assert.equal(customCoverPlan.cover_source, "custom");
  assert.match(customCoverPlan.cover_url, /^\/plan-covers\/\d+\/content$/);
  const customCoverContent = await fetch(`${origin}${customCoverPlan.cover_url}`, { headers: { cookie: creatorCookie } });
  assert.deepEqual(new Uint8Array(await customCoverContent.arrayBuffer()), customCoverBytes);

  const removeCustomCoverResponse = await request(`/api/plans/${plan.id}/cover`, { method: "DELETE", cookie: creatorCookie });
  assert.equal(removeCustomCoverResponse.status, 200);
  const automaticCoverPlan = await removeCustomCoverResponse.json();
  assert.equal(automaticCoverPlan.cover_source, "approved");
  assert.equal(automaticCoverPlan.cover_id, outputResource.id);

  const shotPage = await request(`/plans/${plan.id}`, { cookie: supervisorCookie });
  assert.equal(shotPage.status, 200);
  const html = await shotPage.text();
  assert.match(html, /Docker integration shot/);
  assert.doesNotMatch(html, /Current final version|Final preview/);
  assert.match(html, /Generation timeline/);
  assert.match(html, /Brief, notes, and assets/);
  assert.match(html, /id="assetBriefForm"/);
  assert.match(html, />Assets /);
  assert.match(html, /v1/);
  assert.match(html, /Higgsfield/);
  assert.match(html, /generation-output\.png/);
  const generationEditor = html.match(/<div id="generationEditorModal"[\s\S]*?<\/form>\s*<\/div>/)?.[0];
  assert.ok(generationEditor);
  assert.match(generationEditor, /id="generationOutputDropZone" data-file-drop-zone/);
  assert.doesNotMatch(generationEditor, /reference-frame\.png|generationResourcePicker|generationResourceSearch/);
  assert.match(html, /id="resourceDropZone" data-file-drop-zone/);
  const assetsPanel = html.match(/<section class="shot-panel hidden" data-panel="assets">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(assetsPanel);
  assert.match(assetsPanel, /reference-frame\.png/);
  assert.doesNotMatch(assetsPanel, /generation-output\.png/);
  assert.match(html, /Approved by Docker Supervisor/);
  assert.match(html, /reference-frame\.png/);
  assert.match(html, /\/js\/plan-detail\.js/);
  assert.doesNotMatch(html, /id="shotNavigationForm"/);
  assert.match(html, /class="plan-header-back" aria-label="Back to Production"/);
  assert.doesNotMatch(html, /back-to-production-button/);
  assert.match(html, /id="generationSequenceNumberInput"/);
  assert.match(html, /id="generationShotNumberInput"/);
  assert.doesNotMatch(html, /id="generationUploadRole"/);
  assert.doesNotMatch(html, /Due date|>Due</i);
  assert.doesNotMatch(html, />Notes</);
  assert.doesNotMatch(html, />Shot library/);
  assert.doesNotMatch(html, />Brief &amp; prompt/);
  const reportPage = await request("/reports", { cookie: creatorCookie });
  assert.equal(reportPage.status, 200);
  const reportHtml = await reportPage.text();
  assert.match(reportHtml, /Production report/);
  assert.match(reportHtml, /Generator workload/);
  assert.match(reportHtml, /Production pulse/);
  assert.match(reportHtml, /id="planStatusChart"/);
  assert.match(reportHtml, /id="platformCreditsChart"/);
  assert.match(reportHtml, /window\.__REPORT_DATA__/);
  assert.match(reportHtml, /Docker integration shot/);
  assert.match(reportHtml, /12/);
  assert.match(reportHtml, /\$9\.00/);
  const activityPage = await request("/activity", { cookie: creatorCookie });
  assert.equal(activityPage.status, 200);
  const activityHtml = await activityPage.text();
  assert.match(activityHtml, /Workspace activity/);
  assert.match(activityHtml, /Docker Supervisor/);
  assert.match(activityHtml, /Approved/);
  assert.match(activityHtml, /Uploaded generation-output\.png/);
  const filteredShotPage = await request(`/plans/${plan.id}?sequence_number=99&shot_number=7`, { cookie: supervisorCookie });
  assert.equal(filteredShotPage.status, 200);
  assert.match(await filteredShotPage.text(), /Back to Production/);

  // Sort by generation creation time, never by workflow or upload edits.
  const auditDb = new Database(process.env.DB_PATH);
  try {
    auditDb.prepare("UPDATE ai_plans SET created_at = ?, updated_at = ? WHERE id = ?").run("2020-01-01 00:00:00", "2099-01-01 00:00:00", relatedPlans[0].id);
    auditDb.prepare("UPDATE generations SET created_at = ? WHERE plan_id = ?").run("2021-01-01 00:00:00", plan.id);
    const sorted = await request("/api/plans?sequence_number=99", { cookie: creatorCookie });
    const rows = await sorted.json();
    assert.deepEqual(rows.map((item) => item.id), [plan.id, relatedPlans[0].id]);
    assert.equal(rows[0].generated_at, "2021-01-01 00:00:00");
    assert.equal(rows[1].generated_at, null);
    const edit = await request(`/api/plans/${relatedPlans[0].id}`, { method: "PATCH", cookie: creatorCookie, body: { description: "Edited after generation" } });
    assert.equal(edit.status, 200);
    const sortedAgain = await request("/api/plans?sequence_number=99", { cookie: creatorCookie });
    assert.deepEqual((await sortedAgain.json()).map((item) => item.id), [plan.id, relatedPlans[0].id]);
  } finally { auditDb.close(); }

  const generationDelete = await request(`/api/generations/${secondGeneration.id}`, { method: "DELETE", cookie: creatorCookie });
  assert.equal(generationDelete.status, 200);
  assert.ok(!(await generationDelete.json()).generations.some((generation) => generation.id === secondGeneration.id));

  const planDelete = await request(`/api/plans/${relatedPlans[1].id}`, { method: "DELETE", cookie: creatorCookie });
  assert.equal(planDelete.status, 204);
  assert.equal((await request(`/api/plans/${relatedPlans[1].id}`, { cookie: creatorCookie })).status, 404);

  const resourceDelete = await request(`/api/resources/${resource.id}`, {
    method: "DELETE",
    cookie: creatorCookie
  });
  assert.equal(resourceDelete.status, 204);

  const deletedContent = await fetch(`${origin}/resources/${resource.id}/content`, {
    headers: { cookie: creatorCookie }
  });
  assert.equal(deletedContent.status, 404);

  const promptDelete = await request(`/api/prompts/${savedPrompt.id}`, { method: "DELETE", cookie: creatorCookie });
  assert.equal(promptDelete.status, 204);
  assert.equal((await fetch(`${origin}${savedPromptAsset.content_url}`, { headers: { cookie: creatorCookie } })).status, 404);
  const assetDelete = await request(`/api/library-assets/${savedAsset.id}`, { method: "DELETE", cookie: creatorCookie });
  assert.equal(assetDelete.status, 204);
  assert.equal((await fetch(`${origin}${savedAsset.content_url}`, { headers: { cookie: creatorCookie } })).status, 404);

  const occupiedRoleDelete = await request(`/api/roles/${customRole.id}`, { method: "DELETE", cookie: adminCookie });
  assert.equal(occupiedRoleDelete.status, 400);
  assert.equal((await request(`/api/users/${assetUserId}`, { method: "PATCH", cookie: adminCookie, body: { role: "Viewer" } })).status, 200);
  const customRoleDelete = await request(`/api/roles/${customRole.id}`, { method: "DELETE", cookie: adminCookie });
  assert.equal(customRoleDelete.status, 204);

  const forbiddenPasswordReset = await request(`/api/users/${creatorUserId}/password`, {
    method: "POST",
    cookie: creatorCookie,
    body: { password: "Reset-Creator-Password-1", confirmation: "Reset-Creator-Password-1" }
  });
  assert.equal(forbiddenPasswordReset.status, 403);
  const passwordReset = await request(`/api/users/${creatorUserId}/password`, {
    method: "POST",
    cookie: adminCookie,
    body: { password: "Reset-Creator-Password-1", confirmation: "Reset-Creator-Password-1" }
  });
  assert.equal(passwordReset.status, 200);
  assert.equal((await passwordReset.json()).must_set_password, false);
  const oldPasswordLogin = await request("/auth/login", {
    method: "POST",
    body: { username: "docker.creator", password: "Creator-Test-Password-1" }
  });
  assert.equal(oldPasswordLogin.status, 401);
  const resetPasswordLogin = await request("/auth/login", {
    method: "POST",
    body: { username: "docker.creator", password: "Reset-Creator-Password-1" }
  });
  assert.equal(resetPasswordLogin.status, 200);
});
