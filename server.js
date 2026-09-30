import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { ZipArchive } from "@archiver/archiver";
import { matchingShotNumbers, shotFilters } from "./src/shot-numbers.js";
import {
  approveGeneration,
  approvePlan,
  createAccount,
  createLibraryAsset,
  createPrompt,
  createPromptAsset,
  createCatalogItem,
  createGeneration,
  createPlan,
  createResource,
  createWorkspaceRole,
  deleteGeneration,
  deleteLibraryAsset,
  deletePlan,
  deletePlanCover,
  deletePrompt,
  deletePromptAsset,
  deleteResourceRecord,
  getDashboard,
  getGenerationCatalogs,
  getGeneration,
  getLibraryAsset,
  getLibraryAssetFile,
  getPlan,
  getPlanCover,
  getPrompt,
  getPromptAsset,
  getReportData,
  getResource,
  getWorkspaceRole,
  listActivities,
  listLibraryAssets,
  listLibraryAssetTags,
  saveLibraryAssetTag,
  listAccounts,
  listAssignableUsers,
  listNotifications,
  listPrompts,
  listResources,
  listWorkspaceRoles,
  logActivity,
  markAllNotificationsRead,
  markNotificationRead,
  notifySupervisors,
  replacePlanCover,
  selectGeneration,
  setPlanAssignees,
  updatePlan,
  updatePlanStatus,
  updateAccount,
  updateLibraryAsset,
  updatePrompt,
  updateWorkspaceRole,
  deleteWorkspaceRole,
  updateCatalogItem,
  updateGeneration,
  updateGenerationStatus,
  updateResource
} from "./src/db.js";
import {
  activateAccount,
  authMiddleware,
  authenticateAccount,
  beginSession,
  endSession,
  identifyAccount,
  normalizeUsername,
  permissionsFor,
  resetAccountPassword,
  validateUsername
} from "./src/auth.js";
import {
  absoluteStoragePath,
  canPreviewInline,
  checksumFile,
  cinematicThumbnailChecksum,
  cinematicThumbnailStorageKey,
  contentDisposition,
  maxUploadBytes,
  maxCoverUploadBytes,
  removeStoredFile,
  resourceKind,
  safeOriginalName,
  storageKeyForFile,
  uploadAssetLibraryFiles,
  uploadPromptAssetFile,
  uploadPlanCoverFile,
  uploadResourceFile
} from "./src/storage.js";

const serverPath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(serverPath);
const app = express();
const router = express.Router();
const port = Number(process.env.PORT || 4310);
const rawBasePath = (process.env.BASE_PATH || process.env.AI_HUB_BASE_PATH || "").trim();
const basePath = rawBasePath ? (rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`).replace(/\/+$/, "") : "";
const loginAttempts = new Map();
const resourceCategories = ["Reference", "Generation", "Final", "Audio", "Document", "Other"];

function resourceForClient(resource) {
  if (!resource) return null;
  const { storage_key: _storageKey, ...publicResource } = resource;
  return {
    ...publicResource,
    content_url: `${basePath}/resources/${resource.id}/content`,
    download_url: `${basePath}/resources/${resource.id}/content?download=1`
  };
}

function planCardForClient(plan) {
  if (!plan) return null;
  const { custom_cover_id: _customCoverId, automatic_cover_id: _automaticCoverId, due_date: _dueDate, ...publicPlan } = plan;
  const coverRoute = plan.cover_source === "custom" ? "/plan-covers" : "/resources";
  return {
    ...publicPlan,
    cover_url: plan.cover_id ? `${basePath}${coverRoute}/${plan.cover_id}/content` : null
  };
}

function planForClient(plan) {
  if (!plan) return null;
  const { due_date: _dueDate, ...publicPlan } = plan;
  const generationForClient = (generation) => generation ? {
    ...generation,
    resources: Array.isArray(generation.resources) ? generation.resources.map(resourceForClient) : []
  } : null;
  return {
    ...publicPlan,
    cover_url: plan.cover_id ? `${basePath}${plan.cover_source === "custom" ? "/plan-covers" : "/resources"}/${plan.cover_id}/content` : null,
    resources: Array.isArray(plan.resources) ? plan.resources.map(resourceForClient) : plan.resources,
    assets: Array.isArray(plan.assets) ? plan.assets.map(resourceForClient) : [],
    generations: Array.isArray(plan.generations) ? plan.generations.map(generationForClient) : [],
    selected_generation: generationForClient(plan.selected_generation)
  };
}

function fileForClient(file, route) {
  if (!file) return null;
  const { storage_key: _storageKey, ...publicFile } = file;
  return {
    ...publicFile,
    content_url: `${basePath}${route}/${file.id}/content`,
    download_url: `${basePath}${route}/${file.id}/content?download=1`
  };
}

function promptForClient(prompt) {
  if (!prompt) return null;
  return { ...prompt, assets: prompt.assets.map((asset) => fileForClient(asset, "/prompt-assets")) };
}

function libraryAssetForClient(asset) {
  if (!asset) return null;
  return {
    ...fileForClient(asset, "/library-assets"),
    files: (asset.files || []).map((file) => fileForClient(file, "/library-asset-files"))
  };
}

function roleDefinitions() {
  return Object.fromEntries(listWorkspaceRoles().map((role) => [role.name, role.description]));
}

function recordActivity(user, action, entityType, entityId, summary, { planId = null, details = {} } = {}) {
  if (!user) return;
  logActivity({
    userId: user.id,
    actorName: user.display_name,
    actorRole: user.role,
    action,
    entityType,
    entityId,
    planId,
    summary,
    details
  });
  const importantActions = new Set([
    "created_plan", "created_generation", "created_and_approved_generation", "updated_generation",
    "approved_generation", "approved_plan", "changed_plan_status", "updated_plan", "deleted_generation", "deleted_plan",
    "selected_final_generation", "uploaded_asset", "updated_asset", "deleted_asset", "updated_plan_cover", "removed_plan_cover",
    "created_prompt", "updated_prompt", "deleted_prompt", "uploaded_library_asset", "updated_library_asset", "deleted_library_asset"
  ]);
  if (importantActions.has(action)) notifySupervisors(action, summary, planId, user.id);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.locals.basePath = basePath;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.locals.basePath = basePath;
  next();
});

router.use(express.static(path.join(__dirname, "public")));
router.use(
  "/vendor/lucide",
  express.static(path.join(__dirname, "node_modules", "lucide", "dist", "umd"))
);
router.use(authMiddleware);

router.get("/login", (request, response) => {
  if (request.user) return response.redirect(`${basePath}/`);
  response.setHeader("Cache-Control", "no-store");
  response.render("login");
});

function attemptKey(request, username) {
  return `${request.ip}:${normalizeUsername(username)}`;
}

function isRateLimited(request, username) {
  const key = attemptKey(request, username);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt < Date.now()) {
    loginAttempts.set(key, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
    return false;
  }
  return current.count >= 8;
}

function recordFailedAttempt(request, username) {
  const key = attemptKey(request, username);
  const current = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  current.count += 1;
  loginAttempts.set(key, current);
}

function clearAttempts(request, username) {
  loginAttempts.delete(attemptKey(request, username));
}

router.post("/auth/identify", (request, response) => {
  const account = identifyAccount(request.body.username);
  if (!account) return response.status(404).json({ error: "We couldn't find an active account with that username" });
  response.json({
    username: account.username,
    displayName: account.display_name,
    role: account.role,
    setupRequired: account.must_set_password
  });
});

router.post("/auth/activate", async (request, response) => {
  const { username, password, confirmation } = request.body;
  if (isRateLimited(request, username)) return response.status(429).json({ error: "Too many attempts. Try again later" });
  if (password !== confirmation) return response.status(400).json({ error: "Passwords do not match" });
  try {
    const user = await activateAccount(username, password);
    clearAttempts(request, username);
    beginSession(response, request, user);
    recordActivity(user, "activated_account", "user", user.id, `${user.display_name} activated their account`);
    response.json({ user });
  } catch (error) {
    recordFailedAttempt(request, username);
    response.status(400).json({ error: error.message });
  }
});

router.post("/auth/login", async (request, response) => {
  const { username, password } = request.body;
  if (isRateLimited(request, username)) return response.status(429).json({ error: "Too many attempts. Try again later" });
  const user = await authenticateAccount(username, password);
  if (!user) {
    recordFailedAttempt(request, username);
    return response.status(401).json({ error: "The username or password is incorrect" });
  }
  clearAttempts(request, username);
  beginSession(response, request, user);
  recordActivity(user, "signed_in", "session", null, `${user.display_name} signed in`);
  response.json({ user });
});

router.post("/auth/logout", (request, response) => {
  recordActivity(request.user, "signed_out", "session", null, `${request.user?.display_name || "A user"} signed out`);
  endSession(response, request);
  response.status(204).end();
});

function requireAuth(request, response, next) {
  if (request.user) return next();
  if (request.path.startsWith("/api/")) return response.status(401).json({ error: "Sign in required" });
  response.redirect(`${basePath}/login`);
}

function requirePermission(permission) {
  return (request, response, next) => {
    if (request.permissions?.[permission]) return next();
    response.status(403).json({ error: "You do not have permission to perform this action" });
  };
}

function requireAdmin(request, response, next) {
  if (request.user?.role === "Admin") return next();
  response.status(403).json({ error: "Only an Admin can reset account passwords" });
}

router.get("/health", (_request, response) => {
  response.json({ status: "ok", product: "AI Hub" });
});

router.use(requireAuth);

router.get("/storage/thumbnails/cinematic-frames", (request, response) => {
  const thumbnailPath = absoluteStoragePath(cinematicThumbnailStorageKey);
  let thumbnailStats;
  try {
    thumbnailStats = fs.statSync(thumbnailPath);
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).send("Thumbnail not found");
    throw error;
  }

  const etag = `"${cinematicThumbnailChecksum}"`;
  response.setHeader("Cache-Control", "private, max-age=86400");
  response.setHeader("ETag", etag);
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Content-Length", thumbnailStats.size);
  response.setHeader("Content-Disposition", "inline");
  response.setHeader("Last-Modified", thumbnailStats.mtime.toUTCString());

  if (request.headers["if-none-match"] === etag) return response.status(304).end();
  fs.createReadStream(thumbnailPath).pipe(response);
});

router.get("/", (request, response) => {
  let numberFilters;
  try { numberFilters = shotFilters(request.query); } catch (error) { return response.status(400).send(error.message); }
  const dashboard = getDashboard();
  const generationCatalogs = getGenerationCatalogs();
  const workspaceRoles = listWorkspaceRoles();
  response.render("index", {
    ...dashboard,
    currentUser: request.user,
    permissions: request.permissions,
    roleDefinitions: roleDefinitions(),
    workspaceRoles,
    generationCatalogs,
    numberFilters,
    serializedPlans: JSON.stringify(dashboard.plans.map(planCardForClient)).replaceAll("<", "\\u003c"),
    serializedUser: JSON.stringify(request.user).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

function allowedStatusesForPlan(user, permissions, plan) {
  if (plan.status === "Approved" && !permissions.canApprovePlans) return [];
  return permissions.allowedStatuses;
}

router.get("/prompt-library", (request, response) => {
  const dashboard = getDashboard();
  const prompts = listPrompts().map(promptForClient);
  response.render("prompt-library", {
    project: dashboard.project,
    currentUser: request.user,
    permissions: request.permissions,
    maxUploadBytes,
    serializedPrompts: JSON.stringify(prompts).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

router.get("/asset-library", (request, response) => {
  const dashboard = getDashboard();
  const assets = listLibraryAssets().map(libraryAssetForClient);
  const assetCategories = getGenerationCatalogs().asset_categories.map((item) => item.name);
  response.render("asset-library", {
    project: dashboard.project,
    currentUser: request.user,
    permissions: request.permissions,
    assetCategories,
    assetTags: listLibraryAssetTags(),
    maxUploadBytes,
    serializedAssets: JSON.stringify(assets).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

router.get("/reports", (request, response) => {
  const dashboard = getDashboard();
  response.render("reports", {
    project: dashboard.project,
    currentUser: request.user,
    permissions: request.permissions,
    report: getReportData()
  });
});

router.get("/activity", (request, response) => {
  const dashboard = getDashboard();
  response.render("activity", {
    project: dashboard.project,
    currentUser: request.user,
    permissions: request.permissions,
    activities: listActivities({ limit: 1000 })
  });
});

router.get("/plans/:id", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).send("Shot not found");
  const displayPlan = planForClient(plan);
  const dashboard = getDashboard();
  let numberFilters;
  try { numberFilters = shotFilters(request.query); } catch (error) { return response.status(400).send(error.message); }
  const orderedPlans = getDashboard(numberFilters).plans;
  const planIndex = orderedPlans.findIndex((item) => item.id === plan.id);
  const previousPlan = planIndex > 0 ? orderedPlans[planIndex - 1] : null;
  const nextPlan = planIndex >= 0 && planIndex < orderedPlans.length - 1 ? orderedPlans[planIndex + 1] : null;
  const allowedStatuses = allowedStatusesForPlan(request.user, request.permissions, plan);
  const generationCatalogs = getGenerationCatalogs();

  response.render("plan", {
    project: dashboard.project,
    plan: displayPlan,
    previousPlan,
    nextPlan,
    currentUser: request.user,
    permissions: request.permissions,
    allowedStatuses,
    resourceCategories,
    generationCatalogs,
    numberFilters,
    filterQuery: new URLSearchParams(numberFilters).toString(),
    serializedNavigationPlans: JSON.stringify(dashboard.plans.map(({ id, title, sequence_number, shot_number }) => ({ id, title, sequence_number, shot_number }))).replaceAll("<", "\\u003c"),
    generationResourceRoles: generationCatalogs.resource_roles.map((item) => item.name),
    maxUploadBytes,
    serializedPlan: JSON.stringify(displayPlan).replaceAll("<", "\\u003c"),
    serializedUser: JSON.stringify(request.user).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

router.get("/api/plans", (request, response) => {
  try { response.json(getDashboard(request.query).plans.map(planCardForClient)); }
  catch (error) { response.status(400).json({ error: error.message }); }
});

router.get("/api/assignment-users", requirePermission("canAssignPlans"), (_request, response) => {
  response.json(listAssignableUsers());
});

router.put("/api/plans/:id/assignees", requirePermission("canAssignPlans"), (request, response) => {
  try {
    setPlanAssignees(Number(request.params.id), request.body.user_ids, request.user.id);
    const plan = getPlan(Number(request.params.id));
    recordActivity(request.user, "assigned_plan", "plan", plan.id,
      `Updated assignments for ${plan.shot_code} · ${plan.title}`, { planId: plan.id,
        details: { user_ids: plan.assignees.map((user) => user.id) } });
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/api/notifications", (request, response) => response.json(listNotifications(request.user.id)));
router.patch("/api/notifications/read-all", (request, response) => {
  markAllNotificationsRead(request.user.id);
  response.json(listNotifications(request.user.id));
});
router.patch("/api/notifications/:id/read", (request, response) => {
  markNotificationRead(Number(request.params.id), request.user.id);
  response.json(listNotifications(request.user.id));
});

router.get("/api/plans/:id", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });
  response.json(planForClient(plan));
});

router.post("/api/plans", requirePermission("canCreatePlans"), (request, response) => {
  try {
    if (request.body.status === "Approved" && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Only a Supervisor can approve a plan" });
    }
    const plan = createPlan(request.body);
    recordActivity(request.user, "created_plan", "plan", plan.id, `Created ${plan.shot_code} · ${plan.title}`, { planId: plan.id });
    response.status(201).json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/plans/:id/status", (request, response) => {
  try {
    const currentPlan = getPlan(Number(request.params.id));
    if (!currentPlan) return response.status(404).json({ error: "Plan not found" });
    if (currentPlan.status === "Approved" && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Approved work can only be changed by a Supervisor" });
    }
    if (request.body.status === "Approved" && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Only a Supervisor can approve a shot" });
    }
    if (!["WIP", "Approved"].includes(request.body.status) || !request.permissions.allowedStatuses.includes(request.body.status)) {
      return response.status(400).json({ error: "Invalid status or your role cannot move a plan to that status" });
    }
    const plan = updatePlanStatus(Number(request.params.id), request.body.status, request.user.id);
    recordActivity(request.user, request.body.status === "Approved" ? "approved_plan" : "changed_plan_status", "plan", plan.id,
      `${request.body.status === "Approved" ? "Approved" : "Changed status of"} ${plan.shot_code} · ${plan.title}${request.body.status === "Approved" ? "" : ` to ${request.body.status}`}`,
      { planId: plan.id, details: { status: request.body.status } });
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/plans/:id/approval", requirePermission("canApprovePlans"), (request, response) => {
  try {
    const plan = approvePlan(Number(request.params.id), request.user.id, request.body?.generation_id);
    recordActivity(request.user, "approved_plan", "plan", plan.id, `Approved ${plan.shot_code} · ${plan.title}`, {
      planId: plan.id,
      details: { generation_id: plan.selected_generation_id }
    });
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/plans/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const plan = updatePlan(Number(request.params.id), request.body);
    recordActivity(request.user, "updated_plan", "plan", plan.id, `Updated ${plan.shot_code} · ${plan.title}`, { planId: plan.id });
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/plans/:id/generations", requirePermission("canEditPlans"), (request, response) => {
  try {
    if (request.body.status === "Approved" && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Only a Supervisor can approve a generation" });
    }
    const generation = createGeneration(Number(request.params.id), request.body, request.user.id);
    const updatedPlan = planForClient(getPlan(Number(request.params.id)));
    recordActivity(request.user, generation.status === "Approved" ? "created_and_approved_generation" : "created_generation", "generation", generation.id,
      `Created ${generation.version_label} for ${updatedPlan.shot_code} · ${updatedPlan.title}`, {
        planId: updatedPlan.id,
        details: { tokens: generation.total_tokens, cost: generation.generation_cost, platform: generation.platform_name }
      });
    response.status(201).json({ generation: updatedPlan.generations.find((item) => item.id === generation.id), plan: updatedPlan });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/generations/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const generation = getGeneration(Number(request.params.id));
    if (!generation) return response.status(404).json({ error: "Generation not found" });
    if (request.body.status === "Approved" && !request.permissions.canApprovePlans && generation.status !== "Approved") {
      return response.status(403).json({ error: "Only a Supervisor can approve a generation" });
    }
    const savedGeneration = updateGeneration(generation.id, request.body);
    const updatedPlan = planForClient(getPlan(generation.plan_id));
    recordActivity(request.user, "updated_generation", "generation", generation.id,
      `Updated ${savedGeneration.version_label} for ${updatedPlan.shot_code} · ${updatedPlan.title}`, {
        planId: updatedPlan.id,
        details: { tokens: savedGeneration.total_tokens, cost: savedGeneration.generation_cost }
      });
    response.json({ generation: updatedPlan.generations.find((item) => item.id === generation.id), plan: updatedPlan });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/generations/:id/status", (request, response) => {
  try {
    const generation = getGeneration(Number(request.params.id));
    if (!generation) return response.status(404).json({ error: "Generation not found" });
    const targetStatus = request.body.status;
    if (!["WIP", "Approved"].includes(targetStatus)) {
      return response.status(400).json({ error: "Invalid status. Allowed statuses: WIP, Approved" });
    }
    if (targetStatus === "Approved" && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Only a Supervisor can approve a generation" });
    }
    if (targetStatus === "WIP" && !request.permissions.canManageWorkflow && !request.permissions.canApprovePlans) {
      return response.status(403).json({ error: "Your role cannot change generation status" });
    }
    const updatedPlan = planForClient(updateGenerationStatus(generation.id, targetStatus, request.user.id));
    recordActivity(request.user, targetStatus === "Approved" ? "approved_generation" : "changed_generation_status", "generation", generation.id,
      `${targetStatus === "Approved" ? "Approved" : "Changed status of"} ${generation.version_label} for ${updatedPlan.shot_code} · ${updatedPlan.title}${targetStatus === "Approved" ? "" : ` to ${targetStatus}`}`,
      { planId: updatedPlan.id, details: { status: targetStatus } });
    response.json({
      generation: updatedPlan.generations.find((item) => item.id === generation.id),
      plan: updatedPlan
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/generations/:id/approval", requirePermission("canApprovePlans"), (request, response) => {
  try {
    const generation = getGeneration(Number(request.params.id));
    if (!generation) return response.status(404).json({ error: "Generation not found" });
    const updatedPlan = planForClient(approveGeneration(generation.id, request.user.id));
    recordActivity(request.user, "approved_generation", "generation", generation.id,
      `Approved ${generation.version_label} for ${updatedPlan.shot_code} · ${updatedPlan.title}`, { planId: updatedPlan.id });
    response.json({
      generation: updatedPlan.generations.find((item) => item.id === generation.id),
      plan: updatedPlan
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/generations/:id", requirePermission("canDeletePlans"), (request, response) => {
  try {
    const generation = getGeneration(Number(request.params.id));
    if (!generation) return response.status(404).json({ error: "Generation not found" });
    const planId = deleteGeneration(generation.id);
    const plan = getPlan(planId);
    recordActivity(request.user, "deleted_generation", "generation", generation.id,
      `Deleted ${generation.version_label} from ${plan?.shot_code || "a plan"} · ${plan?.title || "Deleted plan"}`, { planId });
    response.json(planForClient(getPlan(planId)));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/plans/:id", requirePermission("canDeletePlans"), async (request, response) => {
  try {
    const plan = getPlan(Number(request.params.id));
    if (!plan) return response.status(404).json({ error: "Plan not found" });
    const storageKeys = deletePlan(plan.id);
    await Promise.allSettled(storageKeys.map((key) => removeStoredFile(key)));
    recordActivity(request.user, "deleted_plan", "plan", plan.id, `Deleted ${plan.shot_code} · ${plan.title}`);
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/plans/:id/selected-generation", requirePermission("canSetCurrentFinal"), (request, response) => {
  try {
    const plan = selectGeneration(Number(request.params.id), Number(request.body.generation_id));
    recordActivity(request.user, "selected_final_generation", "plan", plan.id,
      `Selected ${plan.selected_generation?.version_label || "a generation"} as final for ${plan.shot_code} · ${plan.title}`, {
        planId: plan.id,
        details: { generation_id: plan.selected_generation_id }
      });
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/api/plans/:id/resources", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });
  response.json({
    resources: listResources(plan.id).map(resourceForClient),
    maxUploadBytes,
    categories: resourceCategories,
    roles: getGenerationCatalogs().resource_roles.map((item) => item.name)
  });
});

function planCardById(id) {
  return planCardForClient(getDashboard().plans.find((plan) => plan.id === id));
}

router.post("/api/plans/:id/cover", requirePermission("canEditPlans"), (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });

  uploadPlanCoverFile(request, response, async (uploadError) => {
    let storageKey;
    try {
      if (uploadError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = uploadError.code === "LIMIT_FILE_SIZE"
          ? `Plan covers must be smaller than ${Math.round(maxCoverUploadBytes / 1024 / 1024)} MB`
          : uploadError.message;
        return response.status(status).json({ error: message });
      }
      if (!request.file) return response.status(400).json({ error: "Choose an image to use as the cover" });
      storageKey = storageKeyForFile(request.file.path);
      if (!request.file.size) {
        await removeStoredFile(storageKey);
        return response.status(400).json({ error: "Empty images cannot be used as covers" });
      }
      const originalName = safeOriginalName(request.file.originalname);
      if (resourceKind(request.file.mimetype, originalName) !== "image") {
        await removeStoredFile(storageKey);
        return response.status(400).json({ error: "Plan covers must be image files" });
      }
      const saved = replacePlanCover({
        planId: plan.id,
        uploadedBy: request.user.id,
        originalName,
        storageKey,
        mimeType: String(request.file.mimetype || "image/jpeg").slice(0, 160),
        sizeBytes: request.file.size,
        checksumSha256: await checksumFile(request.file.path)
      });
      if (saved.previousStorageKey && saved.previousStorageKey !== storageKey) {
        await removeStoredFile(saved.previousStorageKey).catch(() => {});
      }
      recordActivity(request.user, "updated_plan_cover", "plan", plan.id, `Updated the cover for ${plan.shot_code} · ${plan.title}`, { planId: plan.id });
      response.status(201).json(planCardById(plan.id));
    } catch (error) {
      if (storageKey) await removeStoredFile(storageKey).catch(() => {});
      response.status(500).json({ error: "The plan cover could not be saved" });
    }
  });
});

router.delete("/api/plans/:id/cover", requirePermission("canEditPlans"), async (request, response) => {
  try {
    const plan = getPlan(Number(request.params.id));
    if (!plan) return response.status(404).json({ error: "Plan not found" });
    const current = deletePlanCover(plan.id);
    if (current) await removeStoredFile(current.storage_key);
    if (current) recordActivity(request.user, "removed_plan_cover", "plan", plan.id, `Removed the custom cover from ${plan.shot_code} · ${plan.title}`, { planId: plan.id });
    response.json(planCardById(plan.id));
  } catch (_error) {
    response.status(500).json({ error: "The custom cover could not be removed" });
  }
});

router.post("/api/plans/:id/resources", requirePermission("canEditPlans"), (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });

  uploadResourceFile(request, response, async (uploadError) => {
    let storageKey;
    try {
      if (uploadError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = uploadError.code === "LIMIT_FILE_SIZE"
          ? `This file is larger than the ${Math.round(maxUploadBytes / 1024 / 1024 / 1024)} GB upload limit`
          : uploadError.message;
        return response.status(status).json({ error: message });
      }
      if (!request.file) return response.status(400).json({ error: "Choose a file to upload" });
      storageKey = storageKeyForFile(request.file.path);
      try { if (!plan.is_test_plan) matchingShotNumbers(plan, request.body); }
      catch (error) {
        await removeStoredFile(storageKey);
        return response.status(400).json({ error: error.message });
      }
      if (!request.file.size) {
        await removeStoredFile(storageKey);
        return response.status(400).json({ error: "Empty files cannot be uploaded" });
      }

      const originalName = safeOriginalName(request.file.originalname);
      const kind = resourceKind(request.file.mimetype, originalName);
      const suggestedCategory = kind === "audio" ? "Audio" : kind === "document" ? "Document" : "Generation";
      const category = resourceCategories.includes(request.body.category) ? request.body.category : suggestedCategory;
      const availableRoles = getGenerationCatalogs().resource_roles.map((item) => item.name);
      const requestedRole = String(request.body.asset_role || "").trim();
      const assetRole = availableRoles.includes(requestedRole)
        ? requestedRole
        : (availableRoles.includes("Other Input") ? "Other Input" : availableRoles.find((role) => role !== "Output") || "Other Input");
      const notes = String(request.body.notes || "").trim().slice(0, 2000);
      const checksumSha256 = await checksumFile(request.file.path);
      const resource = createResource({
        planId: plan.id,
        uploadedBy: request.user.id,
        originalName,
        storageKey,
        mimeType: String(request.file.mimetype || "application/octet-stream").slice(0, 160),
        kind,
        category,
        assetRole,
        sizeBytes: request.file.size,
        checksumSha256,
        notes
      });
      recordActivity(request.user, "uploaded_asset", "resource", resource.id,
        `Uploaded ${resource.original_name} as ${resource.asset_role} to ${plan.shot_code} · ${plan.title}`, {
          planId: plan.id,
          details: { asset_role: resource.asset_role, kind: resource.kind, size_bytes: resource.size_bytes }
        });
      response.status(201).json(resourceForClient(resource));
    } catch (error) {
      if (storageKey) await removeStoredFile(storageKey).catch(() => {});
      response.status(500).json({ error: "The upload could not be saved" });
    }
  });
});

router.patch("/api/resources/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const current = getResource(Number(request.params.id));
    if (!current) return response.status(404).json({ error: "Resource not found" });
    const category = request.body.category === undefined ? current.category : String(request.body.category);
    if (!resourceCategories.includes(category)) return response.status(400).json({ error: "Invalid resource category" });
    const assetRole = request.body.asset_role === undefined ? current.asset_role : String(request.body.asset_role).trim();
    const availableRoles = getGenerationCatalogs({ includeInactive: true }).resource_roles.map((item) => item.name);
    if (!availableRoles.includes(assetRole)) return response.status(400).json({ error: "Invalid asset type" });
    const notes = request.body.notes === undefined ? current.notes : String(request.body.notes).trim().slice(0, 2000);
    const resource = updateResource(current.id, { category, assetRole, notes });
    const plan = getPlan(resource.plan_id);
    recordActivity(request.user, "updated_asset", "resource", resource.id,
      `Updated ${resource.original_name} in ${plan?.shot_code || "a plan"} · ${plan?.title || "Unknown plan"}`, {
        planId: resource.plan_id,
        details: { asset_role: resource.asset_role, category: resource.category }
      });
    response.json(resourceForClient(resource));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/resources/:id", requirePermission("canEditPlans"), async (request, response) => {
  try {
    const resource = getResource(Number(request.params.id));
    if (!resource) return response.status(404).json({ error: "Resource not found" });
    await removeStoredFile(resource.storage_key);
    deleteResourceRecord(resource.id);
    const plan = getPlan(resource.plan_id);
    recordActivity(request.user, "deleted_asset", "resource", resource.id,
      `Deleted ${resource.original_name} from ${plan?.shot_code || "a plan"} · ${plan?.title || "Unknown plan"}`, { planId: resource.plan_id });
    response.status(204).end();
  } catch (_error) {
    response.status(500).json({ error: "The resource could not be removed" });
  }
});

async function streamStoredFile(record, request, response) {
  let filePath;
  let fileStat;
  try {
    filePath = absoluteStoragePath(record.storage_key);
    fileStat = await fsp.stat(filePath);
  } catch (_error) {
    return response.status(404).json({ error: "Stored file not found" });
  }

  const totalSize = fileStat.size;
  const forceDownload = request.query.download === "1";
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "private, max-age=3600");
  response.setHeader("Content-Type", record.mime_type || "application/octet-stream");
  if (record.mime_type === "application/pdf") response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Content-Disposition", contentDisposition(record.original_name, !forceDownload && canPreviewInline(record.mime_type)));
  response.setHeader("ETag", `\"${record.checksum_sha256}\"`);
  response.setHeader("Last-Modified", fileStat.mtime.toUTCString());

  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.setHeader("Content-Range", `bytes */${totalSize}`);
      return response.status(416).end();
    }
    const requestedStart = match[1] ? Number(match[1]) : null;
    const requestedEnd = match[2] ? Number(match[2]) : null;
    const start = requestedStart === null ? Math.max(0, totalSize - requestedEnd) : requestedStart;
    const end = requestedStart === null ? totalSize - 1 : Math.min(requestedEnd ?? totalSize - 1, totalSize - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= totalSize) {
      response.setHeader("Content-Range", `bytes */${totalSize}`);
      return response.status(416).end();
    }
    response.status(206);
    response.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    response.setHeader("Content-Length", end - start + 1);
    if (request.method === "HEAD") return response.end();
    return fs.createReadStream(filePath, { start, end }).pipe(response);
  }

  response.setHeader("Content-Length", totalSize);
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(filePath).pipe(response);
}

router.get("/resources/:id/content", async (request, response) => {
  const resource = getResource(Number(request.params.id));
  if (!resource) return response.status(404).json({ error: "Resource not found" });
  await streamStoredFile(resource, request, response);
});

async function downloadPlanArchive(request, response, kind) {
  const planId = Number(request.params.id);
  if (!Number.isSafeInteger(planId) || planId < 1) return response.status(404).json({ error: "Plan not found" });
  const plan = getPlan(planId);
  if (!plan) return response.status(404).json({ error: "Plan not found" });

  const records = kind === "generations"
    ? plan.generations.flatMap((generation) => generation.resources
      .filter((resource) => resource.role === "Output")
      .map((resource) => ({ resource, folder: `v${generation.version_number || generation.id}` })))
    : plan.assets.map((resource) => ({ resource, folder: "assets" }));
  if (!records.length) return response.status(404).json({ error: `This plan has no ${kind === "generations" ? "generation outputs" : "assets"} to download` });

  const files = [];
  try {
    for (const { resource, folder } of records) {
      const filePath = absoluteStoragePath(resource.storage_key);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error("Stored file is not available");
      const safeName = safeOriginalName(resource.original_name).replace(/[\\/]/g, "_").replace(/^\.+$/, "file");
      files.push({ filePath, entryName: `${folder}/${resource.id}-${safeName}` });
    }
  } catch (_error) {
    return response.status(409).json({ error: "One or more stored files are missing. The ZIP could not be created." });
  }

  const archive = new ZipArchive({ forceZip64: true, zlib: { level: 1 } });
  const archiveName = `Seq-${plan.sequence_number}_Shot-${plan.shot_number}-${kind}.zip`;
  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Content-Disposition", contentDisposition(archiveName, false));
  response.setHeader("Cache-Control", "private, no-store");
  archive.on("error", () => response.destroy());
  response.on("close", () => { if (!response.writableFinished) archive.abort(); });
  archive.pipe(response);
  files.forEach(({ filePath, entryName }) => archive.file(filePath, { name: entryName }));
  try { await archive.finalize(); }
  catch (_error) { response.destroy(); }
}

router.get("/plans/:id/generations.zip", (request, response) => downloadPlanArchive(request, response, "generations"));
router.get("/plans/:id/assets.zip", (request, response) => downloadPlanArchive(request, response, "assets"));

router.get("/plan-covers/:id/content", async (request, response) => {
  const cover = getPlanCover(Number(request.params.id));
  if (!cover) return response.status(404).json({ error: "Plan cover not found" });
  await streamStoredFile(cover, request, response);
});

function receiveLibraryUpload(upload, request, response, save) {
  upload(request, response, async (uploadError) => {
    let storageKey;
    try {
      if (uploadError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = uploadError.code === "LIMIT_FILE_SIZE"
          ? `This file is larger than the ${Math.round(maxUploadBytes / 1024 / 1024 / 1024)} GB upload limit`
          : uploadError.message;
        return response.status(status).json({ error: message });
      }
      if (!request.file) return response.status(400).json({ error: "Choose a file to upload" });
      storageKey = storageKeyForFile(request.file.path);
      if (!request.file.size) {
        await removeStoredFile(storageKey);
        return response.status(400).json({ error: "Empty files cannot be uploaded" });
      }
      const originalName = safeOriginalName(request.file.originalname);
      const saved = await save({
        originalName,
        storageKey,
        mimeType: String(request.file.mimetype || "application/octet-stream").slice(0, 160),
        kind: resourceKind(request.file.mimetype, originalName),
        sizeBytes: request.file.size,
        checksumSha256: await checksumFile(request.file.path)
      });
      response.status(201).json(saved);
    } catch (error) {
      if (storageKey) await removeStoredFile(storageKey).catch(() => {});
      response.status(400).json({ error: error.message || "The upload could not be saved" });
    }
  });
}

function receiveLibraryUploads(upload, request, response, save) {
  upload(request, response, async (uploadError) => {
    const storageKeys = [];
    try {
      if (uploadError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = uploadError.code === "LIMIT_FILE_SIZE"
          ? `A file is larger than the ${Math.round(maxUploadBytes / 1024 / 1024 / 1024)} GB upload limit`
          : uploadError.message;
        return response.status(status).json({ error: message });
      }
      const uploaded = Array.isArray(request.files)
        ? request.files
        : [...(request.files?.files || []), ...(request.files?.file || [])];
      if (!uploaded.length) return response.status(400).json({ error: "Choose at least one file to upload" });
      const files = await Promise.all(uploaded.map(async (file) => {
        const storageKey = storageKeyForFile(file.path);
        storageKeys.push(storageKey);
        if (!file.size) throw new Error("Empty files cannot be uploaded");
        const originalName = safeOriginalName(file.originalname);
        return {
          originalName,
          storageKey,
          mimeType: String(file.mimetype || "application/octet-stream").slice(0, 160),
          kind: resourceKind(file.mimetype, originalName),
          sizeBytes: file.size,
          checksumSha256: await checksumFile(file.path)
        };
      }));
      const saved = await save(files);
      response.status(201).json(saved);
    } catch (error) {
      await Promise.all(storageKeys.map((storageKey) => removeStoredFile(storageKey).catch(() => {})));
      response.status(400).json({ error: error.message || "The upload could not be saved" });
    }
  });
}

router.get("/api/prompts", (_request, response) => {
  response.json(listPrompts().map(promptForClient));
});

router.post("/api/prompts", requirePermission("canManageLibraries"), (request, response) => {
  try {
    const prompt = createPrompt(request.body, request.user.id);
    recordActivity(request.user, "created_prompt", "prompt", prompt.id, `Created prompt · ${prompt.title}`);
    response.status(201).json(promptForClient(prompt));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/prompts/:id", requirePermission("canManageLibraries"), (request, response) => {
  try {
    const prompt = updatePrompt(Number(request.params.id), request.body);
    recordActivity(request.user, "updated_prompt", "prompt", prompt.id, `Updated prompt · ${prompt.title}`);
    response.json(promptForClient(prompt));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/prompts/:id", requirePermission("canManageLibraries"), async (request, response) => {
  try {
    const prompt = getPrompt(Number(request.params.id));
    if (!prompt) return response.status(404).json({ error: "Prompt not found" });
    const storageKeys = deletePrompt(prompt.id);
    await Promise.allSettled(storageKeys.map((key) => removeStoredFile(key)));
    recordActivity(request.user, "deleted_prompt", "prompt", prompt.id, `Deleted prompt · ${prompt.title}`);
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/prompts/:id/assets", requirePermission("canManageLibraries"), (request, response) => {
  const prompt = getPrompt(Number(request.params.id));
  if (!prompt) return response.status(404).json({ error: "Prompt not found" });
  receiveLibraryUpload(uploadPromptAssetFile, request, response, (file) => {
    const asset = createPromptAsset({ promptId: prompt.id, uploadedBy: request.user.id, ...file });
    recordActivity(request.user, "uploaded_prompt_asset", "prompt_asset", asset.id, `Added ${asset.original_name} to prompt · ${prompt.title}`);
    return fileForClient(asset, "/prompt-assets");
  });
});

router.delete("/api/prompt-assets/:id", requirePermission("canManageLibraries"), async (request, response) => {
  try {
    const asset = deletePromptAsset(Number(request.params.id));
    await removeStoredFile(asset.storage_key);
    recordActivity(request.user, "deleted_prompt_asset", "prompt_asset", asset.id, `Deleted prompt asset · ${asset.original_name}`);
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/prompt-assets/:id/content", async (request, response) => {
  const asset = getPromptAsset(Number(request.params.id));
  if (!asset) return response.status(404).json({ error: "Prompt asset not found" });
  await streamStoredFile(asset, request, response);
});

router.get("/api/library-assets", (_request, response) => {
  response.json({
    assets: listLibraryAssets().map(libraryAssetForClient),
    categories: getGenerationCatalogs().asset_categories.map((item) => item.name),
    tags: listLibraryAssetTags()
  });
});

router.post("/api/library-asset-tags", requirePermission("canManageLibraries"), (request, response) => {
  try {
    response.status(201).json({ tag: saveLibraryAssetTag(request.body.tag) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/library-assets", requirePermission("canManageLibraries"), (request, response) => {
  receiveLibraryUploads(uploadAssetLibraryFiles, request, response, async (files) => {
    const assetCategories = getGenerationCatalogs().asset_categories.map((item) => item.name);
    const category = assetCategories.includes(request.body.category) ? request.body.category : "Other";
    const asset = createLibraryAsset({
      title: String(request.body.title || files[0].originalName).trim().slice(0, 160),
      description: String(request.body.description || "").trim().slice(0, 3000),
      category,
      tags: String(request.body.tags || "").trim().slice(0, 1000),
      uploadedBy: request.user.id,
      files
    });
    recordActivity(request.user, "uploaded_library_asset", "library_asset", asset.id, `Uploaded ${files.length} file${files.length === 1 ? "" : "s"} for library asset · ${asset.title}`);
    return libraryAssetForClient(asset);
  });
});

router.patch("/api/library-assets/:id", requirePermission("canManageLibraries"), (request, response) => {
  try {
    const assetCategories = getGenerationCatalogs().asset_categories.map((item) => item.name);
    if (request.body.category !== undefined && !assetCategories.includes(request.body.category)) throw new Error("Invalid asset category");
    const asset = updateLibraryAsset(Number(request.params.id), request.body);
    recordActivity(request.user, "updated_library_asset", "library_asset", asset.id, `Updated library asset · ${asset.title}`);
    response.json(libraryAssetForClient(asset));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/library-assets/:id", requirePermission("canManageLibraries"), async (request, response) => {
  try {
    const asset = deleteLibraryAsset(Number(request.params.id));
    await Promise.all((asset.files || []).map((file) => removeStoredFile(file.storage_key)));
    recordActivity(request.user, "deleted_library_asset", "library_asset", asset.id, `Deleted library asset · ${asset.title}`);
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/library-assets/:id/content", async (request, response) => {
  const asset = getLibraryAsset(Number(request.params.id));
  if (!asset) return response.status(404).json({ error: "Asset not found" });
  await streamStoredFile(asset, request, response);
});

router.get("/library-asset-files/:id/content", async (request, response) => {
  const file = getLibraryAssetFile(Number(request.params.id));
  if (!file) return response.status(404).json({ error: "Asset file not found" });
  await streamStoredFile(file, request, response);
});

router.get("/api/users", requirePermission("canManageAccounts"), (_request, response) => {
  response.json({ users: listAccounts(), roles: listWorkspaceRoles() });
});

router.post("/api/users", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const username = normalizeUsername(request.body.username);
    const displayName = String(request.body.display_name || "").trim();
    const role = String(request.body.role || "Viewer");
    if (!validateUsername(username)) throw new Error("Use 3–32 lowercase letters, numbers, dots, dashes, or underscores");
    if (!displayName || displayName.length > 80) throw new Error("Display name is required");
    if (!getWorkspaceRole(role)) throw new Error("Invalid role");
    const user = createAccount({ username, displayName, role, createdBy: request.user.id });
    recordActivity(request.user, "created_user", "user", user.id, `Created account for ${user.display_name} · ${user.role}`);
    response.status(201).json(user);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/users/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const role = request.body.role;
    if (role !== undefined && !getWorkspaceRole(role)) throw new Error("Invalid role");
    const user = updateAccount(Number(request.params.id), { role, active: request.body.active });
    recordActivity(request.user, "updated_user", "user", user.id, `Updated account for ${user.display_name} · ${user.role}`, {
      details: { active: user.active, role: user.role }
    });
    response.json(user);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/users/:id/password", requireAdmin, async (request, response) => {
  try {
    const password = String(request.body.password || "");
    const confirmation = String(request.body.confirmation || "");
    if (password !== confirmation) throw new Error("Passwords do not match");
    const user = await resetAccountPassword(Number(request.params.id), password);
    recordActivity(request.user, "reset_user_password", "user", user.id, `Reset password for ${user.display_name}`);
    response.json(user);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post("/api/roles", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const role = createWorkspaceRole(request.body);
    recordActivity(request.user, "created_role", "role", role.id, `Created workspace role · ${role.name}`);
    response.status(201).json(role);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/roles/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const role = updateWorkspaceRole(Number(request.params.id), request.body);
    recordActivity(request.user, "updated_role", "role", role.id, `Updated workspace role · ${role.name}`);
    response.json(role);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete("/api/roles/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const role = listWorkspaceRoles().find((item) => item.id === Number(request.params.id));
    deleteWorkspaceRole(Number(request.params.id));
    recordActivity(request.user, "deleted_role", "role", Number(request.params.id), `Deleted workspace role · ${role?.name || request.params.id}`);
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/api/admin/catalogs", requirePermission("canManageAccounts"), (_request, response) => {
  response.json(getGenerationCatalogs({ includeInactive: true }));
});

router.post("/api/admin/catalogs/:type", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const item = createCatalogItem(request.params.type, request.body);
    recordActivity(request.user, "created_catalog_item", "catalog_item", item.id, `Added ${item.name} to ${request.params.type}`);
    response.status(201).json(item);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.patch("/api/admin/catalogs/:type/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const item = updateCatalogItem(request.params.type, Number(request.params.id), request.body);
    recordActivity(request.user, "updated_catalog_item", "catalog_item", item.id, `Updated ${item.name} in ${request.params.type}`);
    response.json(item);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.get("/api/session", (request, response) => {
  response.json({ user: request.user, permissions: permissionsFor(request.user.role) });
});

router.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

if (basePath) {
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", product: "AI Hub" });
  });
  app.get("/", (_request, response) => response.redirect(basePath + "/"));
  app.use(basePath, router);
} else {
  app.use(router);
}

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === serverPath) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`AI Hub is running at http://localhost:${port}`);
  });
}

export { app };
