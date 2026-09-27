import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { matchingShotNumbers, shotFilters } from "./src/shot-numbers.js";
import {
  createAccount,
  createCatalogItem,
  createGeneration,
  createPlan,
  createResource,
  deleteResourceRecord,
  getDashboard,
  getGenerationCatalogs,
  getGeneration,
  getPlan,
  getResource,
  listAccounts,
  listResources,
  selectGeneration,
  updatePlan,
  updatePlanStatus,
  updateAccount,
  updateCatalogItem,
  updateGeneration,
  updateResource
} from "./src/db.js";
import {
  ROLE_DEFINITIONS,
  activateAccount,
  authMiddleware,
  authenticateAccount,
  beginSession,
  endSession,
  identifyAccount,
  normalizeUsername,
  permissionsFor,
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
  removeStoredFile,
  resourceKind,
  safeOriginalName,
  storageKeyForFile,
  uploadResourceFile
} from "./src/storage.js";

const serverPath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(serverPath);
const app = express();
const port = Number(process.env.PORT || 4310);
const loginAttempts = new Map();
const resourceCategories = ["Reference", "Generation", "Final", "Audio", "Document", "Other"];

function resourceForClient(resource) {
  if (!resource) return null;
  const { storage_key: _storageKey, ...publicResource } = resource;
  return {
    ...publicResource,
    content_url: `/resources/${resource.id}/content`,
    download_url: `/resources/${resource.id}/content?download=1`
  };
}

function planForClient(plan) {
  if (!plan) return null;
  const generationForClient = (generation) => generation ? {
    ...generation,
    resources: Array.isArray(generation.resources) ? generation.resources.map(resourceForClient) : []
  } : null;
  return {
    ...plan,
    resources: Array.isArray(plan.resources) ? plan.resources.map(resourceForClient) : plan.resources,
    generations: Array.isArray(plan.generations) ? plan.generations.map(generationForClient) : [],
    selected_generation: generationForClient(plan.selected_generation)
  };
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  "/vendor/lucide",
  express.static(path.join(__dirname, "node_modules", "lucide", "dist", "umd"))
);

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(authMiddleware);

app.get("/login", (request, response) => {
  if (request.user) return response.redirect("/");
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

app.post("/auth/identify", (request, response) => {
  const account = identifyAccount(request.body.username);
  if (!account) return response.status(404).json({ error: "We couldn't find an active account with that username" });
  response.json({
    username: account.username,
    displayName: account.display_name,
    role: account.role,
    setupRequired: account.must_set_password
  });
});

app.post("/auth/activate", async (request, response) => {
  const { username, password, confirmation } = request.body;
  if (isRateLimited(request, username)) return response.status(429).json({ error: "Too many attempts. Try again later" });
  if (password !== confirmation) return response.status(400).json({ error: "Passwords do not match" });
  try {
    const user = await activateAccount(username, password);
    clearAttempts(request, username);
    beginSession(response, request, user);
    response.json({ user });
  } catch (error) {
    recordFailedAttempt(request, username);
    response.status(400).json({ error: error.message });
  }
});

app.post("/auth/login", async (request, response) => {
  const { username, password } = request.body;
  if (isRateLimited(request, username)) return response.status(429).json({ error: "Too many attempts. Try again later" });
  const user = await authenticateAccount(username, password);
  if (!user) {
    recordFailedAttempt(request, username);
    return response.status(401).json({ error: "The username or password is incorrect" });
  }
  clearAttempts(request, username);
  beginSession(response, request, user);
  response.json({ user });
});

app.post("/auth/logout", (request, response) => {
  endSession(response, request);
  response.status(204).end();
});

function requireAuth(request, response, next) {
  if (request.user) return next();
  if (request.path.startsWith("/api/")) return response.status(401).json({ error: "Sign in required" });
  response.redirect("/login");
}

function requirePermission(permission) {
  return (request, response, next) => {
    if (request.permissions?.[permission]) return next();
    response.status(403).json({ error: "You do not have permission to perform this action" });
  };
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok", product: "AI Hub" });
});

app.use(requireAuth);

app.get("/storage/thumbnails/cinematic-frames", (request, response) => {
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

app.get("/", (request, response) => {
  let numberFilters;
  try { numberFilters = shotFilters(request.query); } catch (error) { return response.status(400).send(error.message); }
  const dashboard = getDashboard();
  const generationCatalogs = getGenerationCatalogs();
  response.render("index", {
    ...dashboard,
    currentUser: request.user,
    permissions: request.permissions,
    roleDefinitions: ROLE_DEFINITIONS,
    generationCatalogs,
    numberFilters,
    serializedPlans: JSON.stringify(dashboard.plans).replaceAll("<", "\\u003c"),
    serializedUser: JSON.stringify(request.user).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

function allowedStatusesForPlan(user, permissions, plan) {
  if (["Admin", "Supervisor"].includes(user.role)) return permissions.allowedStatuses;
  if (user.role === "Creator" && ["Approved", "Delivered"].includes(plan.status)) return [];
  if (user.role === "Reviewer" && plan.status !== "Review") return [];
  return permissions.allowedStatuses;
}

app.get("/plans/:id", (request, response) => {
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

app.get("/api/plans", (request, response) => {
  try { response.json(getDashboard(request.query).plans); }
  catch (error) { response.status(400).json({ error: error.message }); }
});

app.get("/api/plans/:id", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });
  response.json(planForClient(plan));
});

app.post("/api/plans", requirePermission("canCreatePlans"), (request, response) => {
  try {
    const plan = createPlan(request.body);
    response.status(201).json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/plans/:id/status", (request, response) => {
  try {
    const currentPlan = getPlan(Number(request.params.id));
    if (!currentPlan) return response.status(404).json({ error: "Plan not found" });
    if (request.user.role === "Creator" && ["Approved", "Delivered"].includes(currentPlan.status)) {
      return response.status(403).json({ error: "Approved work can only be changed by an Admin or Supervisor" });
    }
    if (request.user.role === "Reviewer" && currentPlan.status !== "Review") {
      return response.status(403).json({ error: "Reviewers can only act on plans currently in review" });
    }
    if (["Approved", "Delivered"].includes(request.body.status) && !currentPlan.selected_generation_id) {
      return response.status(400).json({ error: "Select a current final generation before approving this shot" });
    }
    if (!request.permissions.allowedStatuses.includes(request.body.status)) {
      return response.status(403).json({ error: "Your role cannot move a plan to that status" });
    }
    const plan = updatePlanStatus(Number(request.params.id), request.body.status);
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/plans/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const plan = updatePlan(Number(request.params.id), request.body);
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/plans/:id/generations", requirePermission("canEditPlans"), (request, response) => {
  try {
    const generation = createGeneration(Number(request.params.id), request.body, request.user.id);
    const updatedPlan = planForClient(getPlan(Number(request.params.id)));
    response.status(201).json({ generation: updatedPlan.generations.find((item) => item.id === generation.id), plan: updatedPlan });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/generations/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const generation = getGeneration(Number(request.params.id));
    if (!generation) return response.status(404).json({ error: "Generation not found" });
    updateGeneration(generation.id, request.body);
    const updatedPlan = planForClient(getPlan(generation.plan_id));
    response.json({ generation: updatedPlan.generations.find((item) => item.id === generation.id), plan: updatedPlan });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/plans/:id/selected-generation", requirePermission("canEditPlans"), (request, response) => {
  try {
    const plan = selectGeneration(Number(request.params.id), Number(request.body.generation_id));
    response.json(planForClient(plan));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/plans/:id/resources", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });
  response.json({
    resources: listResources(plan.id).map(resourceForClient),
    maxUploadBytes,
    categories: resourceCategories
  });
});

app.post("/api/plans/:id/resources", requirePermission("canEditPlans"), (request, response) => {
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
      try { matchingShotNumbers(plan, request.body); }
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
        sizeBytes: request.file.size,
        checksumSha256,
        notes
      });
      response.status(201).json(resourceForClient(resource));
    } catch (error) {
      if (storageKey) await removeStoredFile(storageKey).catch(() => {});
      response.status(500).json({ error: "The upload could not be saved" });
    }
  });
});

app.patch("/api/resources/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const current = getResource(Number(request.params.id));
    if (!current) return response.status(404).json({ error: "Resource not found" });
    const category = request.body.category === undefined ? current.category : String(request.body.category);
    if (!resourceCategories.includes(category)) return response.status(400).json({ error: "Invalid resource category" });
    const notes = request.body.notes === undefined ? current.notes : String(request.body.notes).trim().slice(0, 2000);
    response.json(resourceForClient(updateResource(current.id, { category, notes })));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.delete("/api/resources/:id", requirePermission("canEditPlans"), async (request, response) => {
  try {
    const resource = getResource(Number(request.params.id));
    if (!resource) return response.status(404).json({ error: "Resource not found" });
    await removeStoredFile(resource.storage_key);
    deleteResourceRecord(resource.id);
    response.status(204).end();
  } catch (_error) {
    response.status(500).json({ error: "The resource could not be removed" });
  }
});

app.get("/resources/:id/content", async (request, response) => {
  const resource = getResource(Number(request.params.id));
  if (!resource) return response.status(404).json({ error: "Resource not found" });

  let filePath;
  let fileStat;
  try {
    filePath = absoluteStoragePath(resource.storage_key);
    fileStat = await fsp.stat(filePath);
  } catch (_error) {
    return response.status(404).json({ error: "Stored file not found" });
  }

  const totalSize = fileStat.size;
  const forceDownload = request.query.download === "1";
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "private, max-age=3600");
  response.setHeader("Content-Type", resource.mime_type || "application/octet-stream");
  response.setHeader("Content-Disposition", contentDisposition(resource.original_name, !forceDownload && canPreviewInline(resource.mime_type)));
  response.setHeader("ETag", `\"${resource.checksum_sha256}\"`);
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
});

app.get("/api/users", requirePermission("canManageAccounts"), (_request, response) => {
  response.json({ users: listAccounts(), roles: ROLE_DEFINITIONS });
});

app.post("/api/users", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const username = normalizeUsername(request.body.username);
    const displayName = String(request.body.display_name || "").trim();
    const role = String(request.body.role || "Viewer");
    if (!validateUsername(username)) throw new Error("Use 3–32 lowercase letters, numbers, dots, dashes, or underscores");
    if (!displayName || displayName.length > 80) throw new Error("Display name is required");
    if (!Object.hasOwn(ROLE_DEFINITIONS, role)) throw new Error("Invalid role");
    const user = createAccount({ username, displayName, role, createdBy: request.user.id });
    response.status(201).json(user);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/users/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    const role = request.body.role;
    if (role !== undefined && !Object.hasOwn(ROLE_DEFINITIONS, role)) throw new Error("Invalid role");
    const user = updateAccount(Number(request.params.id), { role, active: request.body.active });
    response.json(user);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/catalogs", requirePermission("canManageAccounts"), (_request, response) => {
  response.json(getGenerationCatalogs({ includeInactive: true }));
});

app.post("/api/admin/catalogs/:type", requirePermission("canManageAccounts"), (request, response) => {
  try {
    response.status(201).json(createCatalogItem(request.params.type, request.body));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/catalogs/:type/:id", requirePermission("canManageAccounts"), (request, response) => {
  try {
    response.json(updateCatalogItem(request.params.type, Number(request.params.id), request.body));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/session", (request, response) => {
  response.json({ user: request.user, permissions: permissionsFor(request.user.role) });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === serverPath) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`AI Hub is running at http://localhost:${port}`);
  });
}

export { app };
