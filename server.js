import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  createAccount,
  createPlan,
  getDashboard,
  getPlan,
  listAccounts,
  updatePlan,
  updatePlanStatus,
  updateAccount
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4310);
const loginAttempts = new Map();

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

app.get("/", (request, response) => {
  const dashboard = getDashboard();
  response.render("index", {
    ...dashboard,
    currentUser: request.user,
    permissions: request.permissions,
    roleDefinitions: ROLE_DEFINITIONS,
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
  const dashboard = getDashboard();
  const orderedPlans = [...dashboard.plans].sort((first, second) => first.shot_code.localeCompare(second.shot_code, undefined, { numeric: true }));
  const planIndex = orderedPlans.findIndex((item) => item.id === plan.id);
  const previousPlan = planIndex > 0 ? orderedPlans[planIndex - 1] : null;
  const nextPlan = planIndex < orderedPlans.length - 1 ? orderedPlans[planIndex + 1] : null;
  const allowedStatuses = allowedStatusesForPlan(request.user, request.permissions, plan);

  response.render("plan", {
    project: dashboard.project,
    plan,
    previousPlan,
    nextPlan,
    currentUser: request.user,
    permissions: request.permissions,
    allowedStatuses,
    serializedPlan: JSON.stringify(plan).replaceAll("<", "\\u003c"),
    serializedUser: JSON.stringify(request.user).replaceAll("<", "\\u003c"),
    serializedPermissions: JSON.stringify(request.permissions).replaceAll("<", "\\u003c")
  });
});

app.get("/api/plans/:id", (request, response) => {
  const plan = getPlan(Number(request.params.id));
  if (!plan) return response.status(404).json({ error: "Plan not found" });
  response.json(plan);
});

app.post("/api/plans", requirePermission("canCreatePlans"), (request, response) => {
  try {
    const plan = createPlan(request.body);
    response.status(201).json(plan);
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
    if (!request.permissions.allowedStatuses.includes(request.body.status)) {
      return response.status(403).json({ error: "Your role cannot move a plan to that status" });
    }
    const plan = updatePlanStatus(Number(request.params.id), request.body.status);
    response.json(plan);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.patch("/api/plans/:id", requirePermission("canEditPlans"), (request, response) => {
  try {
    const plan = updatePlan(Number(request.params.id), request.body);
    response.json(plan);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
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

app.get("/api/session", (request, response) => {
  response.json({ user: request.user, permissions: permissionsFor(request.user.role) });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`AI Hub is running at http://localhost:${port}`);
});
