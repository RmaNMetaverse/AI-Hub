import crypto from "node:crypto";
import { promisify } from "node:util";
import {
  deleteSession,
  findUserByUsername,
  getWorkspaceRole,
  getUserBySessionHash,
  markUserLogin,
  resetUserPassword,
  saveSession,
  setUserPassword
} from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "ai_hub_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_ACCOUNT_PASSWORD = "AIHub@12345";

export const ROLE_DEFINITIONS = {
  Admin: "Workspace and account management, excluding production approvals.",
  Supervisor: "Manage production, assign work, and approve final media.",
  Generator: "Create shots, upload assets, and manage generations.",
  Creator: "Create plans, edit creative details, and manage generations.",
  Reviewer: "Review work and add feedback.",
  Viewer: "Read-only access to projects and approved production data."
};

export function permissionsFor(role) {
  const definition = getWorkspaceRole(role);
  const canManageWorkflow = Boolean(definition?.can_manage_workflow);
  const canReviewPlans = Boolean(definition?.can_review_plans);
  const canApprovePlans = role === "Supervisor";
  const canSetCurrentFinal = ["Admin", "Supervisor"].includes(role);
  const allowedStatuses = canApprovePlans
    ? ["WIP", "Approved"]
    : canManageWorkflow ? ["WIP"] : [];
  return {
    canManageAccounts: Boolean(definition?.can_manage_accounts),
    canCreatePlans: Boolean(definition?.can_create_plans),
    canEditPlans: Boolean(definition?.can_edit_plans),
    canDeletePlans: Boolean(definition?.can_delete_plans),
    canManageWorkflow,
    canReviewPlans,
    canApprovePlans,
    canSetCurrentFinal,
    canAssignPlans: ["Admin", "Supervisor"].includes(role),
    canManageLibraries: Boolean(definition?.can_manage_libraries),
    allowedStatuses
  };
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateUsername(username) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username);
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("Password must contain at least 10 characters");
  }
  if (password.length > 128) throw new Error("Password is too long");
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const settings = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derived = await scrypt(password, salt, 64, settings);
  return `scrypt$${settings.N}$${settings.r}$${settings.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof password !== "string") return false;
  const [algorithm, n, r, p, saltValue, hashValue] = storedHash.split("$");
  if (algorithm !== "scrypt" || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
  });
  return crypto.timingSafeEqual(expected, actual);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    must_set_password: Boolean(user.must_set_password),
    active: Boolean(user.active),
    last_login_at: user.last_login_at,
    created_at: user.created_at
  };
}

export function identifyAccount(usernameValue) {
  const username = normalizeUsername(usernameValue);
  if (!validateUsername(username)) return null;
  const user = findUserByUsername(username);
  if (!user || !user.active) return null;
  return publicUser(user);
}

export async function activateAccount(usernameValue, password) {
  const username = normalizeUsername(usernameValue);
  const user = findUserByUsername(username);
  if (!user || !user.active || !user.must_set_password || user.password_hash) {
    throw new Error("This account cannot be activated");
  }
  const passwordHash = await hashPassword(password);
  const activated = setUserPassword(user.id, passwordHash);
  return publicUser(activated);
}

export async function resetAccountPassword(id, password) {
  return publicUser(resetUserPassword(id, await hashPassword(password)));
}

export async function authenticateAccount(usernameValue, password) {
  const username = normalizeUsername(usernameValue);
  const user = findUserByUsername(username);
  if (!user || !user.active || user.must_set_password || !user.password_hash) return null;
  if (!(await verifyPassword(password, user.password_hash))) return null;
  markUserLogin(user.id);
  return publicUser(findUserByUsername(username));
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) return cookies;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, request) {
  const forwardedProtocol = request.get("x-forwarded-proto");
  const secure = request.secure || forwardedProtocol === "https";
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? "Secure" : null
  ].filter(Boolean).join("; ");
}

export function beginSession(response, request, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  saveSession(tokenHash(token), user.id, expiresAt);
  markUserLogin(user.id);
  response.setHeader("Set-Cookie", sessionCookie(token, request));
}

export function endSession(response, request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (token) deleteSession(tokenHash(token));
  const forwardedProtocol = request.get("x-forwarded-proto");
  const secure = request.secure || forwardedProtocol === "https";
  response.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", secure ? "Secure" : null
  ].filter(Boolean).join("; "));
}

export function authMiddleware(request, _response, next) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  const user = token ? getUserBySessionHash(tokenHash(token)) : null;
  request.user = publicUser(user);
  request.permissions = request.user ? permissionsFor(request.user.role) : null;
  next();
}
