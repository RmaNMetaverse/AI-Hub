import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { matchingShotNumbers, migrateShotNumbers, shotFilters, shotNumbers } from "./shot-numbers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, "..", "data", "ai-hub.db");
const dbPath = process.env.DB_PATH || defaultDbPath;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_code TEXT NOT NULL,
    title TEXT NOT NULL,
    is_test_plan INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'WIP',
    media_type TEXT NOT NULL DEFAULT 'Video',
    sequence_name TEXT NOT NULL DEFAULT 'Sequence 01',
    scene_name TEXT NOT NULL DEFAULT 'Scene 01',
    owner TEXT NOT NULL DEFAULT 'Unassigned',
    model TEXT NOT NULL DEFAULT 'Not selected',
    quality REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'Medium',
    experiments_count INTEGER NOT NULL DEFAULT 0,
    next_action TEXT NOT NULL DEFAULT 'Complete creative brief',
    issue TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    duration TEXT NOT NULL DEFAULT '5 sec',
    tags TEXT NOT NULL DEFAULT '',
    image_position TEXT NOT NULL DEFAULT '0% 0%',
    selected_generation_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'WIP',
    rating REAL NOT NULL DEFAULT 0,
    verdict TEXT NOT NULL DEFAULT 'Promising',
    notes TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost_per_million REAL NOT NULL DEFAULT 0,
    output_cost_per_million REAL NOT NULL DEFAULT 0,
    provider_job_id TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    version_number INTEGER,
    platform_id INTEGER,
    platform_name TEXT NOT NULL DEFAULT '',
    token_count INTEGER NOT NULL DEFAULT 0,
    token_price_snapshot REAL NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Admin', 'Supervisor', 'Creator', 'Reviewer', 'Viewer')),
    password_hash TEXT,
    must_set_password INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    kind TEXT NOT NULL DEFAULT 'other',
    category TEXT NOT NULL DEFAULT 'Other',
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plan_covers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL UNIQUE REFERENCES ai_plans(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generation_resources (
    generation_id INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (generation_id, resource_id)
  );

  CREATE TABLE IF NOT EXISTS generation_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generation_platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    token_price REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generation_resource_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS ai_plans_status_idx ON ai_plans(status);
  CREATE INDEX IF NOT EXISTS ai_plans_project_idx ON ai_plans(project_id);
  CREATE INDEX IF NOT EXISTS generations_plan_idx ON generations(plan_id);
  CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS resources_plan_idx ON resources(plan_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS resources_category_idx ON resources(category);
  CREATE INDEX IF NOT EXISTS generation_resources_resource_idx ON generation_resources(resource_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    protected INTEGER NOT NULL DEFAULT 0,
    can_manage_accounts INTEGER NOT NULL DEFAULT 0,
    can_create_plans INTEGER NOT NULL DEFAULT 0,
    can_edit_plans INTEGER NOT NULL DEFAULT 0,
    can_delete_plans INTEGER NOT NULL DEFAULT 0,
    can_manage_workflow INTEGER NOT NULL DEFAULT 0,
    can_review_plans INTEGER NOT NULL DEFAULT 0,
    can_manage_libraries INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plan_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
    generation_id INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    negative_prompt TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prompt_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    kind TEXT NOT NULL DEFAULT 'other',
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asset_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    tags TEXT NOT NULL DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    kind TEXT NOT NULL DEFAULT 'other',
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asset_library_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES asset_library(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    kind TEXT NOT NULL DEFAULT 'other',
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asset_library_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS asset_library_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    plan_id INTEGER,
    summary TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plan_assignments (
    plan_id INTEGER NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    plan_id INTEGER REFERENCES ai_plans(id) ON DELETE SET NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS plan_approvals_plan_idx ON plan_approvals(plan_id, approved_at DESC);
  CREATE INDEX IF NOT EXISTS plan_covers_plan_idx ON plan_covers(plan_id);
  CREATE INDEX IF NOT EXISTS prompt_library_updated_idx ON prompt_library(updated_at DESC);
  CREATE INDEX IF NOT EXISTS prompt_assets_prompt_idx ON prompt_assets(prompt_id);
  CREATE INDEX IF NOT EXISTS asset_library_category_idx ON asset_library(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS asset_library_files_asset_idx ON asset_library_files(asset_id, id);
  CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS activity_log_plan_idx ON activity_log(plan_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS plan_assignments_user_idx ON plan_assignments(user_id, plan_id);
  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at, id DESC);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("ai_plans", "selected_generation_id", "INTEGER");
ensureColumn("ai_plans", "sequence_number", "INTEGER");
ensureColumn("ai_plans", "shot_number", "INTEGER");
ensureColumn("ai_plans", "is_test_plan", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("generations", "sequence_number", "INTEGER");
ensureColumn("generations", "shot_number", "INTEGER");
ensureColumn("generations", "prompt", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generations", "negative_prompt", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generations", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("generations", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("generations", "input_cost_per_million", "REAL NOT NULL DEFAULT 0");
ensureColumn("generations", "output_cost_per_million", "REAL NOT NULL DEFAULT 0");
ensureColumn("generations", "provider_job_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generations", "seed", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generations", "version_number", "INTEGER");
ensureColumn("generations", "platform_id", "INTEGER");
ensureColumn("generations", "platform_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generations", "token_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("generations", "token_price_snapshot", "REAL NOT NULL DEFAULT 0");
ensureColumn("generations", "created_by", "INTEGER");
ensureColumn("generations", "status", "TEXT NOT NULL DEFAULT 'WIP'");
ensureColumn("generations", "updated_at", "TEXT");
ensureColumn("resources", "asset_role", "TEXT NOT NULL DEFAULT 'Other Input'");
ensureColumn("users", "role_id", "INTEGER REFERENCES workspace_roles(id)");
db.exec(`
  CREATE INDEX IF NOT EXISTS ai_plans_selected_generation_idx ON ai_plans(selected_generation_id);
  CREATE INDEX IF NOT EXISTS generations_status_idx ON generations(status);
  UPDATE ai_plans SET status = 'WIP' WHERE status NOT IN ('WIP', 'Approved');
  UPDATE ai_plans SET status = 'Approved' WHERE status = 'Delivered';
  UPDATE generations SET status = 'WIP' WHERE status NOT IN ('WIP', 'Approved') OR status IS NULL;
  UPDATE generations SET status = 'Approved' WHERE id IN (SELECT generation_id FROM plan_approvals);
`);

const defaultWorkspaceRoles = [
  ["Admin", "Workspace and account management, excluding production approvals.", 1, 1, 1, 1, 1, 1, 1, 1],
  ["Supervisor", "Manage production and approve generated shots.", 1, 0, 1, 1, 1, 1, 1, 1],
  ["Generator", "Create shots, upload assets, and manage generations.", 1, 0, 1, 1, 1, 1, 0, 1],
  ["Creator", "Create plans, edit creative details, and manage generations.", 1, 0, 1, 1, 1, 1, 0, 1],
  ["Reviewer", "Review work and add feedback.", 1, 0, 0, 0, 0, 0, 1, 0],
  ["Viewer", "Read-only workspace access.", 1, 0, 0, 0, 0, 0, 0, 0]
];
const seedWorkspaceRoles = db.transaction(() => {
  const insert = db.prepare(`
    INSERT INTO workspace_roles (
      name, description, protected, can_manage_accounts, can_create_plans, can_edit_plans,
      can_delete_plans, can_manage_workflow, can_review_plans, can_manage_libraries
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description, protected = 1,
      can_manage_accounts = excluded.can_manage_accounts,
      can_create_plans = excluded.can_create_plans,
      can_edit_plans = excluded.can_edit_plans,
      can_delete_plans = excluded.can_delete_plans,
      can_manage_workflow = excluded.can_manage_workflow,
      can_review_plans = excluded.can_review_plans,
      can_manage_libraries = excluded.can_manage_libraries
  `);
  defaultWorkspaceRoles.forEach((role) => insert.run(...role));
});
seedWorkspaceRoles();

const defaultGenerationModels = ["Seedance 2.5", "Seedance 2.0", "Seedance 2.0 Fast", "Kling 3.0", "Gemini Omni", "LTX"];
const defaultGenerationPlatforms = ["ComfyUI", "Higgsfield", "Vidax"];
const defaultGenerationResourceRoles = [
  "Output", "First Frame", "Last Frame", "Depth Map", "Reference Video", "Reference Image",
  "Motion Reference", "Mask", "Control Pose", "Audio Reference", "Other Input"
];
const defaultAssetLibraryCategories = ["Character Sheet", "Image", "Video Tutorial", "Documentation", "Reference", "Audio", "Other"];

const seedCatalogs = db.transaction(() => {
  const insertModel = db.prepare("INSERT OR IGNORE INTO generation_models (name) VALUES (?)");
  defaultGenerationModels.forEach((name) => insertModel.run(name));
  const insertPlatform = db.prepare("INSERT OR IGNORE INTO generation_platforms (name, token_price) VALUES (?, 0)");
  defaultGenerationPlatforms.forEach((name) => insertPlatform.run(name));
  const insertRole = db.prepare("INSERT OR IGNORE INTO generation_resource_roles (name, sort_order) VALUES (?, ?)");
  defaultGenerationResourceRoles.forEach((name, index) => insertRole.run(name, index + 1));
  const insertAssetCategory = db.prepare("INSERT OR IGNORE INTO asset_library_categories (name) VALUES (?)");
  defaultAssetLibraryCategories.forEach((name) => insertAssetCategory.run(name));
});

seedCatalogs();

const migrateLibraryAssetFiles = db.transaction(() => {
  const legacyAssets = db.prepare("SELECT * FROM asset_library").all();
  const insertFile = db.prepare(`
    INSERT OR IGNORE INTO asset_library_files (
      asset_id, original_name, storage_key, mime_type, kind, size_bytes, checksum_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = db.prepare("INSERT OR IGNORE INTO asset_library_tags (name) VALUES (?)");
  legacyAssets.forEach((asset) => {
    insertFile.run(asset.id, asset.original_name, asset.storage_key, asset.mime_type, asset.kind, asset.size_bytes, asset.checksum_sha256);
    String(asset.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).forEach((tag) => insertTag.run(tag));
  });
});

migrateLibraryAssetFiles();

function seedInitialAdmin() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount > 0) return;
  db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash, must_set_password, active)
    VALUES ('admin', 'Workspace Admin', 'Admin', NULL, 1, 1)
  `).run();
}

seedInitialAdmin();

db.exec(`
  UPDATE users
  SET role_id = (SELECT id FROM workspace_roles WHERE name = users.role COLLATE NOCASE)
  WHERE role_id IS NULL;
`);

function roleRowByName(name) {
  return db.prepare("SELECT * FROM workspace_roles WHERE name = ? COLLATE NOCASE").get(String(name || "").trim());
}

export function getWorkspaceRole(name) {
  const role = roleRowByName(name);
  return role ? normalizeWorkspaceRole(role) : null;
}

function normalizeWorkspaceRole(role) {
  if (!role) return null;
  return {
    ...role,
    protected: Boolean(role.protected),
    can_manage_accounts: Boolean(role.can_manage_accounts),
    can_create_plans: Boolean(role.can_create_plans),
    can_edit_plans: Boolean(role.can_edit_plans),
    can_delete_plans: Boolean(role.can_delete_plans),
    can_manage_workflow: Boolean(role.can_manage_workflow),
    can_review_plans: Boolean(role.can_review_plans),
    can_manage_libraries: Boolean(role.can_manage_libraries)
  };
}

export function listWorkspaceRoles() {
  return db.prepare(`
    SELECT wr.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = wr.id) AS user_count
    FROM workspace_roles wr
    ORDER BY CASE wr.name WHEN 'Admin' THEN 1 WHEN 'Supervisor' THEN 2 WHEN 'Generator' THEN 3 ELSE 4 END,
      wr.name COLLATE NOCASE
  `).all().map(normalizeWorkspaceRole);
}

function roleInput(input, current = {}) {
  const name = String(input.name ?? current.name ?? "").trim().slice(0, 40);
  if (!/^[A-Za-z][A-Za-z0-9 _-]{1,39}$/.test(name)) throw new Error("Role name must be 2–40 letters, numbers, spaces, dashes, or underscores");
  return {
    name,
    description: String(input.description ?? current.description ?? "").trim().slice(0, 240),
    can_manage_accounts: Number(Boolean(input.can_manage_accounts ?? current.can_manage_accounts)),
    can_create_plans: Number(Boolean(input.can_create_plans ?? current.can_create_plans)),
    can_edit_plans: Number(Boolean(input.can_edit_plans ?? current.can_edit_plans)),
    can_delete_plans: Number(Boolean(input.can_delete_plans ?? current.can_delete_plans)),
    can_manage_workflow: Number(Boolean(input.can_manage_workflow ?? current.can_manage_workflow)),
    can_review_plans: Number(Boolean(input.can_review_plans ?? current.can_review_plans)),
    can_manage_libraries: Number(Boolean(input.can_manage_libraries ?? current.can_manage_libraries))
  };
}

export function createWorkspaceRole(input) {
  const role = roleInput(input);
  try {
    const result = db.prepare(`
      INSERT INTO workspace_roles (
        name, description, can_manage_accounts, can_create_plans, can_edit_plans,
        can_delete_plans, can_manage_workflow, can_review_plans, can_manage_libraries
      ) VALUES (
        @name, @description, @can_manage_accounts, @can_create_plans, @can_edit_plans,
        @can_delete_plans, @can_manage_workflow, @can_review_plans, @can_manage_libraries
      )
    `).run(role);
    return normalizeWorkspaceRole(db.prepare("SELECT * FROM workspace_roles WHERE id = ?").get(Number(result.lastInsertRowid)));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That role name already exists");
    throw error;
  }
}

export function updateWorkspaceRole(id, input) {
  const current = db.prepare("SELECT * FROM workspace_roles WHERE id = ?").get(id);
  if (!current) throw new Error("Role not found");
  if (current.protected) throw new Error("Built-in roles cannot be changed");
  const role = roleInput(input, current);
  try {
    db.prepare(`
      UPDATE workspace_roles SET
        name = @name, description = @description, can_manage_accounts = @can_manage_accounts,
        can_create_plans = @can_create_plans, can_edit_plans = @can_edit_plans,
        can_delete_plans = @can_delete_plans, can_manage_workflow = @can_manage_workflow,
        can_review_plans = @can_review_plans, can_manage_libraries = @can_manage_libraries,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id, ...role });
    return normalizeWorkspaceRole(db.prepare("SELECT * FROM workspace_roles WHERE id = ?").get(id));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That role name already exists");
    throw error;
  }
}

export function deleteWorkspaceRole(id) {
  const role = db.prepare("SELECT * FROM workspace_roles WHERE id = ?").get(id);
  if (!role) throw new Error("Role not found");
  if (role.protected) throw new Error("Built-in roles cannot be deleted");
  const users = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role_id = ?").get(id).count;
  if (users) throw new Error("Move users to another role before deleting this role");
  db.prepare("DELETE FROM workspace_roles WHERE id = ?").run(id);
}

function seedDatabase() {
  const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
  if (projectCount > 0) return;

  const insertProject = db.prepare(`
    INSERT INTO projects (title, code, description)
    VALUES (?, ?, ?)
  `);
  const project = insertProject.run(
    "The Last Signal",
    "TLS-01",
    "A cinematic science-fiction short about a signal hidden beyond Earth's orbit."
  );

  const insertPlan = db.prepare(`
    INSERT INTO ai_plans (
      project_id, shot_code, title, description, status, media_type,
      sequence_name, scene_name, owner, model, quality, due_date, priority,
      experiments_count, next_action, issue, prompt, negative_prompt,
      aspect_ratio, duration, tags, image_position
    ) VALUES (
      @project_id, @shot_code, @title, @description, @status, @media_type,
      @sequence_name, @scene_name, @owner, @model, @quality, @due_date, @priority,
      @experiments_count, @next_action, @issue, @prompt, @negative_prompt,
      @aspect_ratio, @duration, @tags, @image_position
    )
  `);

  const plans = [
    {
      shot_code: "SC01-SH006", title: "First Light", status: "WIP",
      description: "Mara reaches the survey ridge as the planet's twin dawn breaks over the basin.",
      model: "Sora 2 Pro", quality: 3.8, due_date: "2026-08-08", priority: "High",
      experiments_count: 6, next_action: "Lock the astronaut silhouette", issue: "",
      prompt: "Wide anamorphic establishing shot of a lone astronaut reaching a rocky ridge at first light, restrained warm haze, slow push forward, practical suit detail, monumental empty landscape.",
      tags: "desert,astronaut,establishing", image_position: "0% 0%", owner: "Nika", duration: "8 sec"
    },
    {
      shot_code: "SC02-SH014", title: "Signal District", status: "WIP",
      description: "A courier crosses the flooded lower city while the first signal interrupts every display.",
      model: "Veo 3.1", quality: 3.4, due_date: "2026-08-09", priority: "Critical",
      experiments_count: 12, next_action: "Reduce background flicker", issue: "Signage flickers between frames",
      prompt: "Night exterior, narrow rain-soaked future city alley, solitary courier walking away from camera, cyan practicals and restrained red signage, wet reflections, controlled handheld camera.",
      tags: "city,rain,night", image_position: "50% 0%", owner: "Arman", duration: "6 sec"
    },
    {
      shot_code: "SC03-SH002", title: "The Memory Test", status: "WIP",
      description: "Close portrait as fragments of the recovered transmission pass across Mara's face.",
      model: "Kling 3.0", quality: 4.6, due_date: "2026-08-06", priority: "High",
      experiments_count: 18, next_action: "Director selects take A or D", issue: "",
      prompt: "Intimate 85mm close-up portrait in a dark archive, warm projector light moving softly across the subject's eyes, minimal expression, delicate film grain, shallow focus.",
      tags: "portrait,projector,emotion", image_position: "100% 0%", owner: "Sara", duration: "5 sec"
    },
    {
      shot_code: "SC04-SH021", title: "Orbital Silence", status: "Approved",
      description: "The station rotates above the cloud line before all exterior lights fail at once.",
      model: "Runway Gen-4.5", quality: 4.9, due_date: "2026-08-04", priority: "Medium",
      experiments_count: 9, next_action: "Send 4K master to editorial", issue: "",
      prompt: "Slow orbital pass around a colossal brutalist communications station above Earth, scale emphasized by tiny service lights, realistic orbital mechanics, deep black space.",
      tags: "space,station,vfx", image_position: "0% 100%", owner: "Reza", duration: "10 sec"
    },
    {
      shot_code: "SC01-SH011", title: "Salt Run", status: "WIP",
      description: "The survey vehicle races toward the horizon as the storm begins to erase the road behind it.",
      model: "Luma Ray 3", quality: 3.9, due_date: "2026-08-10", priority: "Medium",
      experiments_count: 14, next_action: "Correct wheel motion", issue: "Rear wheel motion drifts",
      prompt: "Rear tracking shot of a vintage black sedan crossing an endless pale salt flat under a heavy sky, natural tire dust, slow cinematic acceleration, muted neutral grade.",
      tags: "car,salt-flat,motion", image_position: "50% 100%", owner: "Nika", duration: "7 sec"
    },
    {
      shot_code: "SC05-SH004", title: "Forest Gate", status: "WIP",
      description: "A geometric aperture appears inside the forest after the signal reaches Earth.",
      model: "Not selected", quality: 0, due_date: "2026-08-14", priority: "Low",
      experiments_count: 0, next_action: "Build the reference board", issue: "",
      prompt: "Ancient dark forest after rain, subtle luminous geometric aperture suspended between trees, lone human silhouette for scale, physically grounded light interaction.",
      tags: "forest,portal,finale", image_position: "100% 100%", owner: "Unassigned", duration: "6 sec"
    }
  ];

  const insertGeneration = db.prepare(`
    INSERT INTO generations (plan_id, label, prompt_version, model, rating, verdict, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    plans.forEach((plan, index) => {
      const result = insertPlan.run({
        project_id: Number(project.lastInsertRowid),
        media_type: "Video",
        sequence_name: `Sequence ${String(Math.min(index + 1, 5)).padStart(2, "0")}`,
        scene_name: `Scene ${String(index + 1).padStart(2, "0")}`,
        negative_prompt: "text, watermark, temporal flicker, warped anatomy, artificial oversharpening",
        aspect_ratio: "16:9",
        ...plan
      });

      if (plan.experiments_count > 0) {
        insertGeneration.run(
          Number(result.lastInsertRowid), "Take A", "v3", plan.model,
          Math.max(2.8, plan.quality - 0.4), "Needs revision", "Strong composition; motion needs refinement.",
          "WIP"
        );
        insertGeneration.run(
          Number(result.lastInsertRowid), "Take D", "v5", plan.model,
          plan.quality, plan.status === "Approved" ? "Approved" : "Final candidate",
          "Best balance of continuity, atmosphere, and prompt adherence.",
          plan.status === "Approved" ? "Approved" : "WIP"
        );
      }
    });
  });

  seed();
}

seedDatabase();
migrateShotNumbers(db);

const backfillVersionNumbers = db.transaction(() => {
  const generations = db.prepare("SELECT id, plan_id, prompt_version, version_number FROM generations ORDER BY plan_id, id").all();
  const usedByPlan = new Map();
  const update = db.prepare("UPDATE generations SET version_number = ?, label = ?, prompt_version = ? WHERE id = ?");
  generations.forEach((generation) => {
    if (!usedByPlan.has(generation.plan_id)) usedByPlan.set(generation.plan_id, new Set());
    const used = usedByPlan.get(generation.plan_id);
    let version = Number(generation.version_number);
    if (!Number.isSafeInteger(version) || version < 1 || used.has(version)) {
      const parsed = Number(String(generation.prompt_version || "").match(/\d+/)?.[0]);
      version = Number.isSafeInteger(parsed) && parsed > 0 && !used.has(parsed) ? parsed : 1;
      while (used.has(version)) version += 1;
    }
    used.add(version);
    const versionLabel = `v${version}`;
    update.run(version, versionLabel, versionLabel, generation.id);
  });
});

backfillVersionNumbers();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS generations_plan_version_idx ON generations(plan_id, version_number)");

db.exec(`
  UPDATE generations
  SET prompt = COALESCE(NULLIF(prompt, ''), (SELECT prompt FROM ai_plans WHERE ai_plans.id = generations.plan_id), ''),
      negative_prompt = COALESCE(NULLIF(negative_prompt, ''), (SELECT negative_prompt FROM ai_plans WHERE ai_plans.id = generations.plan_id), ''),
      updated_at = COALESCE(updated_at, created_at)
  WHERE prompt = '' OR negative_prompt = '' OR updated_at IS NULL;

  UPDATE ai_plans
  SET selected_generation_id = (
    SELECT generations.id
    FROM generations
    WHERE generations.plan_id = ai_plans.id
    ORDER BY generations.id DESC
    LIMIT 1
  )
  WHERE selected_generation_id IS NULL
    AND EXISTS (SELECT 1 FROM generations WHERE generations.plan_id = ai_plans.id);
`);

function normalizePlan(plan) {
  return {
    ...plan,
    tags: plan.tags ? plan.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : []
  };
}

export function getDashboard(input = {}) {
  const filters = shotFilters(input);
  const project = db.prepare("SELECT * FROM projects ORDER BY id LIMIT 1").get();
  const conditions = Object.keys(filters).map((key) => `p.${key} = @${key}`);
  const plans = db.prepare(`
    WITH cover_candidates AS (
      SELECT p.*,
        (SELECT pc.id FROM plan_covers pc WHERE pc.plan_id = p.id) AS custom_cover_id,
        COALESCE(
          (
            SELECT r.id
            FROM generations g
            JOIN generation_resources gr ON gr.generation_id = g.id
            JOIN resources r ON r.id = gr.resource_id
            WHERE g.plan_id = p.id AND g.status = 'Approved' AND r.kind IN ('image', 'video')
            ORDER BY g.created_at DESC, g.id DESC, CASE WHEN gr.role = 'Output' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC
            LIMIT 1
          ),
          (
            SELECT r.id FROM resources r
            WHERE r.plan_id = p.id AND r.kind = 'image'
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT 1
          ),
          (
            SELECT r.id FROM resources r
            WHERE r.plan_id = p.id AND r.kind = 'video'
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT 1
          )
        ) AS automatic_cover_id
      FROM ai_plans p
      WHERE p.project_id = @project_id ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
    )
    SELECT c.*,
      CASE WHEN pc.id IS NOT NULL THEN pc.id ELSE r.id END AS cover_id,
      CASE WHEN pc.id IS NOT NULL THEN pc.kind ELSE r.kind END AS cover_kind,
      CASE WHEN pc.id IS NOT NULL THEN pc.mime_type ELSE r.mime_type END AS cover_mime_type,
      CASE
        WHEN pc.id IS NOT NULL THEN 'custom'
        WHEN r.id IS NULL THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM generation_resources gr
          JOIN generations g ON g.id = gr.generation_id
          WHERE gr.resource_id = r.id AND g.plan_id = c.id AND g.status = 'Approved'
        ) THEN 'approved'
        ELSE 'latest'
      END AS cover_source,
      (SELECT MAX(g.created_at) FROM generations g WHERE g.plan_id = c.id) AS generated_at,
      COALESCE((SELECT MAX(g.created_at) FROM generations g WHERE g.plan_id = c.id), c.created_at) AS sort_at,
      (SELECT COUNT(*) FROM generations g WHERE g.plan_id = c.id) AS generation_count
    FROM cover_candidates c
    LEFT JOIN plan_covers pc ON pc.id = c.custom_cover_id
    LEFT JOIN resources r ON r.id = c.automatic_cover_id
    ORDER BY sort_at DESC, c.id DESC
  `).all({ project_id: project.id, ...filters }).map((plan) => ({ ...normalizePlan(plan), assignees: listPlanAssignees(plan.id) }));
  return { project, plans };
}

export function getPlan(id) {
  const plan = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(id);
  if (!plan) return null;
  const generations = listGenerations(id);
  const resources = listResources(id);
  const assets = resources.filter((resource) => resource.category !== "Generation" && resource.asset_role !== "Output");
  const selectedGeneration = generations.find((generation) => generation.id === plan.selected_generation_id) || null;
  const approval = db.prepare(`
    SELECT pa.*, u.display_name AS approved_by_name, u.username AS approved_by_username,
           g.label AS generation_label
    FROM plan_approvals pa
    LEFT JOIN users u ON u.id = pa.approved_by
    LEFT JOIN generations g ON g.id = pa.generation_id
    WHERE pa.plan_id = ?
    ORDER BY pa.approved_at DESC, pa.id DESC LIMIT 1
  `).get(id) || null;
  const card = getDashboard({ sequence_number: plan.sequence_number, shot_number: plan.shot_number }).plans.find((item) => item.id === plan.id) || {};
  return {
    ...normalizePlan(plan),
    cover_id: card.cover_id || null,
    cover_kind: card.cover_kind || null,
    cover_mime_type: card.cover_mime_type || null,
    cover_source: card.cover_source || null,
    generated_at: generations[0]?.created_at || null,
    sort_at: generations[0]?.created_at || plan.created_at,
    generations,
    selected_generation: selectedGeneration,
    approval,
    generation_count: generations.length,
    assignees: listPlanAssignees(id),
    resources,
    assets,
    resource_count: assets.length,
    resource_bytes: assets.reduce((total, resource) => total + resource.size_bytes, 0)
  };
}

export function listAssignableUsers() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, COALESCE(wr.name, u.role) AS role
    FROM users u LEFT JOIN workspace_roles wr ON wr.id = u.role_id
    WHERE u.active = 1 ORDER BY u.display_name COLLATE NOCASE, u.id`).all();
}

export function listPlanAssignees(planId) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, COALESCE(wr.name, u.role) AS role
    FROM plan_assignments pa JOIN users u ON u.id = pa.user_id
    LEFT JOIN workspace_roles wr ON wr.id = u.role_id
    WHERE pa.plan_id = ? ORDER BY u.display_name COLLATE NOCASE`).all(planId);
}

export function setPlanAssignees(planId, userIds, actorId) {
  if (!Array.isArray(userIds)) throw new Error("Send an array of user IDs");
  const ids = [...new Set(userIds.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error("Invalid user ID");
  const assign = db.transaction(() => {
    const plan = db.prepare("SELECT id, shot_code, title FROM ai_plans WHERE id = ?").get(planId);
    if (!plan) throw new Error("Plan not found");
    const active = new Set(listAssignableUsers().map((user) => user.id));
    if (ids.some((id) => !active.has(id))) throw new Error("Select active users only");
    const previous = new Set(db.prepare("SELECT user_id FROM plan_assignments WHERE plan_id = ?").all(planId).map((row) => row.user_id));
    const next = new Set(ids);
    const remove = db.prepare("DELETE FROM plan_assignments WHERE plan_id = ? AND user_id = ?");
    const insert = db.prepare("INSERT INTO plan_assignments (plan_id, user_id, assigned_by) VALUES (?, ?, ?)");
    previous.forEach((id) => { if (!next.has(id)) remove.run(planId, id); });
    ids.forEach((id) => {
      if (previous.has(id)) return;
      insert.run(planId, id, actorId);
      createNotification(id, "plan_assigned", `You were assigned to ${plan.shot_code} · ${plan.title}`, planId, actorId);
    });
    return listPlanAssignees(planId);
  });
  return assign();
}

export function createNotification(userId, kind, message, planId = null, actorId = null) {
  db.prepare("INSERT INTO notifications (user_id, kind, message, plan_id, actor_id) VALUES (?, ?, ?, ?, ?)")
    .run(userId, kind, String(message).slice(0, 500), planId, actorId);
}

export function notifySupervisors(kind, message, planId = null, actorId = null) {
  const supervisors = db.prepare(`SELECT u.id FROM users u LEFT JOIN workspace_roles wr ON wr.id = u.role_id
    WHERE u.active = 1 AND COALESCE(wr.name, u.role) = 'Supervisor'`).all();
  supervisors.forEach((user) => createNotification(user.id, kind, message, planId, actorId));
}

export function listNotifications(userId, limit = 50) {
  const notifications = db.prepare(`SELECT id, kind, message, plan_id, read_at, created_at
    FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit);
  const unreadCount = db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId).count;
  return { notifications, unread_count: unreadCount };
}

export function markNotificationRead(id, userId) {
  return db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL").run(id, userId).changes;
}

export function markAllNotificationsRead(userId) {
  db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").run(userId);
}

export function listResources(planId) {
  return db.prepare(`
    SELECT r.*, u.display_name AS uploaded_by_name, u.username AS uploaded_by_username,
           (SELECT COUNT(*) FROM generation_resources gr WHERE gr.resource_id = r.id) AS generation_usage_count
    FROM resources r
    LEFT JOIN users u ON u.id = r.uploaded_by
    WHERE r.plan_id = ?
    ORDER BY
      CASE r.category WHEN 'Final' THEN 1 WHEN 'Generation' THEN 2 WHEN 'Reference' THEN 3 ELSE 4 END,
      r.created_at DESC,
      r.id DESC
  `).all(planId);
}

export function getResource(id) {
  return db.prepare(`
    SELECT r.*, u.display_name AS uploaded_by_name, u.username AS uploaded_by_username,
           (SELECT COUNT(*) FROM generation_resources gr WHERE gr.resource_id = r.id) AS generation_usage_count
    FROM resources r
    LEFT JOIN users u ON u.id = r.uploaded_by
    WHERE r.id = ?
  `).get(id);
}

const catalogTables = {
  models: "generation_models",
  platforms: "generation_platforms",
  resource_roles: "generation_resource_roles",
  asset_categories: "asset_library_categories"
};

function catalogTable(type) {
  const table = catalogTables[type];
  if (!table) throw new Error("Invalid catalog type");
  return table;
}

function catalogRows(type, includeInactive = false) {
  const table = catalogTable(type);
  const ordering = type === "resource_roles" ? "sort_order, id" : "active DESC, name COLLATE NOCASE";
  return db.prepare(`SELECT * FROM ${table} ${includeInactive ? "" : "WHERE active = 1"} ORDER BY ${ordering}`).all()
    .map((item) => ({ ...item, active: Boolean(item.active) }));
}

export function getGenerationCatalogs({ includeInactive = false } = {}) {
  return {
    models: catalogRows("models", includeInactive),
    platforms: catalogRows("platforms", includeInactive),
    resource_roles: catalogRows("resource_roles", includeInactive),
    asset_categories: catalogRows("asset_categories", includeInactive)
  };
}

function catalogName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
  if (!name) throw new Error("Name is required");
  return name;
}

export function createCatalogItem(type, input) {
  const table = catalogTable(type);
  const name = catalogName(input.name);
  try {
    let result;
    if (type === "platforms") {
      const tokenPrice = finiteNumber(input.token_price, 0, 0, 1_000_000, "Token price");
      result = db.prepare(`INSERT INTO ${table} (name, token_price) VALUES (?, ?)`).run(name, tokenPrice);
    } else if (type === "resource_roles") {
      const nextOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM ${table}`).get().value;
      result = db.prepare(`INSERT INTO ${table} (name, sort_order) VALUES (?, ?)`).run(name, nextOrder);
    } else {
      result = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
    }
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(result.lastInsertRowid));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That name is already in this catalog");
    throw error;
  }
}

export function updateCatalogItem(type, id, input) {
  const table = catalogTable(type);
  const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!current) throw new Error("Catalog item not found");
  const name = input.name === undefined ? current.name : catalogName(input.name);
  const active = input.active === undefined ? Boolean(current.active) : Boolean(input.active);
  if (type === "resource_roles" && current.name === "Output" && (name !== "Output" || !active)) {
    throw new Error("Output is a required system resource type and cannot be renamed or removed");
  }
  if (!active && current.active) {
    const activeCount = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE active = 1`).get().count;
    if (activeCount <= 1) throw new Error("Keep at least one active option in this catalog");
  }
  const tokenPrice = type === "platforms"
    ? finiteNumber(input.token_price, current.token_price, 0, 1_000_000, "Token price")
    : null;
  try {
    if (type === "platforms") {
      db.prepare(`UPDATE ${table} SET name = ?, token_price = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, tokenPrice, active ? 1 : 0, id);
    } else {
      db.prepare(`UPDATE ${table} SET name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, active ? 1 : 0, id);
    }
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That name is already in this catalog");
    throw error;
  }
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

function listGenerationResources(generationId) {
  return db.prepare(`
    SELECT r.*, gr.role, u.display_name AS uploaded_by_name, u.username AS uploaded_by_username,
           (SELECT COUNT(*) FROM generation_resources usage WHERE usage.resource_id = r.id) AS generation_usage_count
    FROM generation_resources gr
    JOIN resources r ON r.id = gr.resource_id
    LEFT JOIN users u ON u.id = r.uploaded_by
    WHERE gr.generation_id = ?
    ORDER BY CASE gr.role
      WHEN 'Output' THEN 1 WHEN 'First Frame' THEN 2 WHEN 'Last Frame' THEN 3
      WHEN 'Depth Map' THEN 4 WHEN 'Reference Video' THEN 5 WHEN 'Reference Image' THEN 6 ELSE 7 END,
      r.id DESC
  `).all(generationId);
}

function normalizeGeneration(generation) {
  if (!generation) return null;
  const tokenCount = Number(generation.token_count || 0);
  const tokenPrice = Number(generation.token_price_snapshot || 0);
  const legacyInputTokens = Number(generation.input_tokens || 0);
  const legacyOutputTokens = Number(generation.output_tokens || 0);
  const legacyInputRate = Number(generation.input_cost_per_million || 0);
  const legacyOutputRate = Number(generation.output_cost_per_million || 0);
  const hasPlatformSnapshot = Boolean(generation.platform_name);
  const generationCost = hasPlatformSnapshot
    ? tokenCount * tokenPrice
    : ((legacyInputTokens * legacyInputRate) + (legacyOutputTokens * legacyOutputRate)) / 1_000_000;
  const versionNumber = Number(generation.version_number) || Number(String(generation.prompt_version || "").match(/\d+/)?.[0]) || generation.id;
  return {
    ...generation,
    status: generation.status || "WIP",
    version_number: versionNumber,
    version_label: `v${versionNumber}`,
    total_tokens: hasPlatformSnapshot ? tokenCount : legacyInputTokens + legacyOutputTokens,
    generation_cost: generationCost,
    cost_is_legacy: !hasPlatformSnapshot && (legacyInputTokens > 0 || legacyOutputTokens > 0),
    resources: listGenerationResources(generation.id)
  };
}

export function listGenerations(planId) {
  return db.prepare(`
    SELECT g.*, u.display_name AS created_by_name
    FROM generations g
    LEFT JOIN users u ON u.id = g.created_by
    WHERE g.plan_id = ?
    ORDER BY g.created_at DESC, g.id DESC
  `).all(planId).map(normalizeGeneration);
}

export function getGeneration(id) {
  return normalizeGeneration(db.prepare(`
    SELECT g.*, u.display_name AS created_by_name
    FROM generations g
    LEFT JOIN users u ON u.id = g.created_by
    WHERE g.id = ?
  `).get(id));
}

function finiteNumber(value, fallback, minimum, maximum, label) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} is invalid`);
  return number;
}

function generationFields(planId, input, current = {}) {
  const versionNumber = finiteNumber(input.version_number, current.version_number, 1, 1_000_000, "Generation version");
  if (!Number.isSafeInteger(versionNumber)) throw new Error("Generation version must be a whole number");
  const duplicate = db.prepare("SELECT id FROM generations WHERE plan_id = ? AND version_number = ? AND id <> ?").get(planId, versionNumber, current.id || 0);
  if (duplicate) throw new Error(`Generation v${versionNumber} already exists for this shot`);

  const model = String(input.model ?? current.model ?? "").trim().slice(0, 120);
  if (!model) throw new Error("AI model is required");
  if (!current.id || model !== current.model) {
    const availableModel = db.prepare("SELECT id FROM generation_models WHERE name = ? COLLATE NOCASE AND active = 1").get(model);
    if (!availableModel) throw new Error("Select an available AI model");
  }

  const tokenCount = finiteNumber(input.token_count, current.token_count || 0, 0, 1_000_000_000_000, "Token count");
  if (!Number.isSafeInteger(tokenCount)) throw new Error("Token count must be a whole number");

  const requestedPlatformId = input.platform_id === undefined ? Number(current.platform_id || 0) : Number(input.platform_id);
  let platformId = Number(current.platform_id || 0) || null;
  let platformName = String(current.platform_name || "");
  let tokenPriceSnapshot = Number(current.token_price_snapshot || 0);
  const platformChanged = input.platform_id !== undefined && requestedPlatformId !== Number(current.platform_id || 0);
  if (!current.id || platformChanged) {
    const platform = db.prepare("SELECT * FROM generation_platforms WHERE id = ? AND active = 1").get(requestedPlatformId);
    if (!platform) throw new Error("Select an available generation platform");
    platformId = platform.id;
    platformName = platform.name;
    tokenPriceSnapshot = Number(platform.token_price || 0);
  }

  const versionLabel = `v${versionNumber}`;
  return {
    label: versionLabel,
    prompt_version: versionLabel,
    version_number: versionNumber,
    model,
    notes: String(input.notes ?? current.notes ?? "").trim().slice(0, 5000),
    prompt: String(input.prompt ?? current.prompt ?? "").trim().slice(0, 20000),
    negative_prompt: String(input.negative_prompt ?? current.negative_prompt ?? "").trim().slice(0, 10000),
    platform_id: platformId,
    platform_name: platformName,
    token_count: tokenCount,
    token_price_snapshot: tokenPriceSnapshot,
    seed: String(input.seed ?? current.seed ?? "").trim().slice(0, 240),
    status: ["WIP", "Approved"].includes(input.status) ? input.status : (current.status || "WIP")
  };
}

function generationLinks(planId, links, generationId = null) {
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  const activeRoles = new Set(catalogRows("resource_roles").map((item) => item.name));
  const existingRoles = generationId
    ? new Map(db.prepare("SELECT resource_id, role FROM generation_resources WHERE generation_id = ?").all(generationId).map((item) => [item.resource_id, item.role]))
    : new Map();
  return links.map((link) => {
    const resourceId = Number(link.resource_id);
    const role = String(link.role || "Other Input");
    if (!Number.isSafeInteger(resourceId) || resourceId < 1) throw new Error("Invalid generation resource");
    if (!activeRoles.has(role) && existingRoles.get(resourceId) !== role) throw new Error("Select an available generation resource role");
    if (seen.has(resourceId)) throw new Error("A resource can only have one role in a generation");
    seen.add(resourceId);
    const resource = db.prepare("SELECT id, plan_id FROM resources WHERE id = ?").get(resourceId);
    if (!resource || resource.plan_id !== planId) throw new Error("Generation resources must belong to this shot");
    return { resourceId, role };
  });
}

function replaceGenerationResources(generationId, links) {
  db.prepare("DELETE FROM generation_resources WHERE generation_id = ?").run(generationId);
  const insert = db.prepare("INSERT INTO generation_resources (generation_id, resource_id, role) VALUES (?, ?, ?)");
  links.forEach((link) => insert.run(generationId, link.resourceId, link.role));
}

export function createGeneration(planId, input, createdBy) {
  const plan = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(planId);
  if (!plan) throw new Error("Shot not found");
  const numbers = plan.is_test_plan ? { sequence_number: null, shot_number: null } : matchingShotNumbers(plan, input);
  const fields = generationFields(planId, input, { prompt: plan.prompt, negative_prompt: plan.negative_prompt, model: plan.model });
  const links = generationLinks(planId, input.resources);

  const generationId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO generations (
        plan_id, label, prompt_version, version_number, model, notes, prompt, negative_prompt,
        platform_id, platform_name, token_count, token_price_snapshot, seed, created_by, sequence_number, shot_number, status
      ) VALUES (
        @plan_id, @label, @prompt_version, @version_number, @model, @notes, @prompt, @negative_prompt,
        @platform_id, @platform_name, @token_count, @token_price_snapshot, @seed, @created_by, @sequence_number, @shot_number, @status
      )
    `).run({ plan_id: planId, created_by: createdBy, ...fields, ...numbers });
    const id = Number(result.lastInsertRowid);
    replaceGenerationResources(id, links);
    db.prepare(`
      UPDATE ai_plans
      SET experiments_count = experiments_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(planId);
    if (fields.status === "Approved") {
      db.prepare("INSERT INTO plan_approvals (plan_id, generation_id, approved_by) VALUES (?, ?, ?)").run(planId, id, createdBy);
      db.prepare("UPDATE ai_plans SET selected_generation_id = ?, status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id, planId);
    }
    return id;
  })();

  return getGeneration(generationId);
}

export function updateGeneration(id, input) {
  const current = db.prepare("SELECT * FROM generations WHERE id = ?").get(id);
  if (!current) throw new Error("Generation not found");
  matchingShotNumbers(current, input, { partial: true });
  if (input.plan_id !== undefined && Number(input.plan_id) !== current.plan_id) throw new Error("Generation shot is locked");
  const fields = generationFields(current.plan_id, input, current);
  const links = input.resources === undefined ? null : generationLinks(current.plan_id, input.resources, id);

  db.transaction(() => {
    db.prepare(`
      UPDATE generations SET
        label = @label, prompt_version = @prompt_version, version_number = @version_number,
        model = @model, notes = @notes, prompt = @prompt, negative_prompt = @negative_prompt,
        platform_id = @platform_id, platform_name = @platform_name, token_count = @token_count,
        token_price_snapshot = @token_price_snapshot, seed = @seed, status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id, ...fields });
    if (links) replaceGenerationResources(id, links);
    if (fields.status === "Approved") {
      db.prepare("UPDATE ai_plans SET selected_generation_id = ?, status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id, current.plan_id);
    }
    db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(current.plan_id);
  })();

  return getGeneration(id);
}

export function selectGeneration(planId, generationId) {
  const plan = db.prepare("SELECT id FROM ai_plans WHERE id = ?").get(planId);
  if (!plan) throw new Error("Shot not found");
  const generation = db.prepare("SELECT id FROM generations WHERE id = ? AND plan_id = ?").get(generationId, planId);
  if (!generation) throw new Error("Generation does not belong to this shot");
  db.prepare(`
    UPDATE ai_plans SET selected_generation_id = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(generationId, planId);
  return getPlan(planId);
}

export function approvePlan(planId, userId, generationId = null) {
  const plan = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(planId);
  if (!plan) throw new Error("Plan not found");
  const targetGenId = generationId || plan.selected_generation_id;
  if (!targetGenId) {
    const latestGen = db.prepare("SELECT id FROM generations WHERE plan_id = ? ORDER BY version_number DESC, id DESC LIMIT 1").get(planId);
    if (latestGen) {
      return approvePlan(planId, userId, latestGen.id);
    }
  }
  db.transaction(() => {
    if (targetGenId) {
      const gen = db.prepare("SELECT id FROM generations WHERE id = ? AND plan_id = ?").get(targetGenId, planId);
      if (gen) {
        db.prepare("UPDATE generations SET status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(targetGenId);
        db.prepare("INSERT INTO plan_approvals (plan_id, generation_id, approved_by) VALUES (?, ?, ?)")
          .run(planId, targetGenId, userId);
        db.prepare("UPDATE ai_plans SET selected_generation_id = ?, status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(targetGenId, planId);
        return;
      }
    }
    db.prepare("UPDATE ai_plans SET status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(planId);
  })();
  return getPlan(planId);
}

export function approveGeneration(generationId, userId) {
  const generation = db.prepare("SELECT * FROM generations WHERE id = ?").get(generationId);
  if (!generation) throw new Error("Generation not found");
  return approvePlan(generation.plan_id, userId, generation.id);
}

export function updateGenerationStatus(generationId, status, userId = null) {
  if (!["WIP", "Approved"].includes(status)) throw new Error("Invalid generation status");
  const generation = db.prepare("SELECT * FROM generations WHERE id = ?").get(generationId);
  if (!generation) throw new Error("Generation not found");

  if (status === "Approved") {
    return approvePlan(generation.plan_id, userId, generationId);
  }

  db.transaction(() => {
    db.prepare("UPDATE generations SET status = 'WIP', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(generationId);
    const hasApproved = db.prepare("SELECT 1 FROM generations WHERE plan_id = ? AND status = 'Approved' AND id <> ?").get(generation.plan_id, generationId);
    if (!hasApproved) {
      db.prepare("UPDATE ai_plans SET status = 'WIP', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(generation.plan_id);
    }
  })();
  return getPlan(generation.plan_id);
}

export function deleteGeneration(id) {
  const generation = db.prepare("SELECT * FROM generations WHERE id = ?").get(id);
  if (!generation) throw new Error("Generation not found");
  db.transaction(() => {
    const plan = db.prepare("SELECT selected_generation_id, status FROM ai_plans WHERE id = ?").get(generation.plan_id);
    db.prepare("DELETE FROM generations WHERE id = ?").run(id);
    const remainingApproved = db.prepare("SELECT 1 FROM generations WHERE plan_id = ? AND status = 'Approved'").get(generation.plan_id);
    db.prepare(`
      UPDATE ai_plans SET
        selected_generation_id = CASE WHEN selected_generation_id = ? THEN NULL ELSE selected_generation_id END,
        status = CASE WHEN ? THEN 'Approved' ELSE 'WIP' END,
        experiments_count = (SELECT COUNT(*) FROM generations WHERE plan_id = ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id, remainingApproved ? 1 : 0, generation.plan_id, generation.plan_id);
    if (!plan) throw new Error("Plan not found");
  })();
  return generation.plan_id;
}

export function deletePlan(id) {
  const plan = db.prepare("SELECT id FROM ai_plans WHERE id = ?").get(id);
  if (!plan) throw new Error("Plan not found");
  const storageKeys = [
    ...db.prepare("SELECT storage_key FROM resources WHERE plan_id = ?").all(id),
    ...db.prepare("SELECT storage_key FROM plan_covers WHERE plan_id = ?").all(id)
  ].map((item) => item.storage_key);
  db.prepare("DELETE FROM ai_plans WHERE id = ?").run(id);
  return storageKeys;
}

export function getPlanCover(id) {
  return db.prepare("SELECT * FROM plan_covers WHERE id = ?").get(id) || null;
}

export function getPlanCoverByPlanId(planId) {
  return db.prepare("SELECT * FROM plan_covers WHERE plan_id = ?").get(planId) || null;
}

export function replacePlanCover(input) {
  const current = getPlanCoverByPlanId(input.planId);
  db.prepare(`
    INSERT INTO plan_covers (
      plan_id, uploaded_by, original_name, storage_key, mime_type, kind,
      size_bytes, checksum_sha256
    ) VALUES (
      @planId, @uploadedBy, @originalName, @storageKey, @mimeType, 'image',
      @sizeBytes, @checksumSha256
    )
    ON CONFLICT(plan_id) DO UPDATE SET
      uploaded_by = excluded.uploaded_by,
      original_name = excluded.original_name,
      storage_key = excluded.storage_key,
      mime_type = excluded.mime_type,
      kind = 'image',
      size_bytes = excluded.size_bytes,
      checksum_sha256 = excluded.checksum_sha256,
      updated_at = CURRENT_TIMESTAMP
  `).run(input);
  db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.planId);
  return { cover: getPlanCoverByPlanId(input.planId), previousStorageKey: current?.storage_key || null };
}

export function deletePlanCover(planId) {
  const current = getPlanCoverByPlanId(planId);
  if (!current) return null;
  db.prepare("DELETE FROM plan_covers WHERE plan_id = ?").run(planId);
  db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(planId);
  return current;
}

export function createResource(input) {
  const resourceId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO resources (
        plan_id, uploaded_by, original_name, storage_key, mime_type, kind,
        category, asset_role, size_bytes, checksum_sha256, notes
      ) VALUES (
        @planId, @uploadedBy, @originalName, @storageKey, @mimeType, @kind,
        @category, @assetRole, @sizeBytes, @checksumSha256, @notes
      )
    `).run(input);
    db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.planId);
    return Number(result.lastInsertRowid);
  })();
  return getResource(resourceId);
}

export function updateResource(id, { category, assetRole, notes }) {
  const current = getResource(id);
  if (!current) throw new Error("Resource not found");
  db.prepare(`
    UPDATE resources
    SET category = ?, asset_role = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(category ?? current.category, assetRole ?? current.asset_role, notes ?? current.notes, id);
  db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(current.plan_id);
  return getResource(id);
}

export function deleteResourceRecord(id) {
  const current = getResource(id);
  if (!current) return false;
  return db.transaction(() => {
    const deleted = db.prepare("DELETE FROM resources WHERE id = ?").run(id).changes > 0;
    if (deleted) db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(current.plan_id);
    return deleted;
  })();
}

export function logActivity({ userId, actorName, actorRole, action, entityType, entityId = null, planId = null, summary, details = {} }) {
  const result = db.prepare(`
    INSERT INTO activity_log (
      user_id, actor_name, actor_role, action, entity_type, entity_id, plan_id, summary, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    String(actorName || "Unknown user").slice(0, 120),
    String(actorRole || "Unknown").slice(0, 80),
    String(action || "updated").slice(0, 80),
    String(entityType || "workspace").slice(0, 80),
    entityId || null,
    planId || null,
    String(summary || "Workspace activity").slice(0, 500),
    JSON.stringify(details || {}).slice(0, 10000)
  );
  return Number(result.lastInsertRowid);
}

export function listActivities({ limit = 500 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  return db.prepare(`
    SELECT activity_log.*,
      p.title AS plan_title, p.sequence_number, p.shot_number
    FROM activity_log
    LEFT JOIN ai_plans p ON p.id = activity_log.plan_id
    ORDER BY activity_log.created_at DESC, activity_log.id DESC
    LIMIT ?
  `).all(safeLimit).map((item) => {
    let details = {};
    try { details = JSON.parse(item.details || "{}"); } catch { details = {}; }
    return { ...item, details };
  });
}

const reportGenerationCostSql = `CASE
  WHEN COALESCE(g.platform_name, '') <> '' THEN COALESCE(g.token_count, 0) * COALESCE(g.token_price_snapshot, 0)
  ELSE ((COALESCE(g.input_tokens, 0) * COALESCE(g.input_cost_per_million, 0))
    + (COALESCE(g.output_tokens, 0) * COALESCE(g.output_cost_per_million, 0))) / 1000000.0
END`;

export function getReportData() {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, COALESCE(wr.name, u.role) AS role, u.active,
      COUNT(DISTINCT g.id) AS generation_count,
      COUNT(DISTINCT g.plan_id) AS plan_count,
      COUNT(DISTINCT CASE WHEN g.status = 'Approved' THEN g.id END) AS approved_generation_count,
      COALESCE(SUM(CASE WHEN COALESCE(g.platform_name, '') <> ''
        THEN COALESCE(g.token_count, 0)
        ELSE COALESCE(g.input_tokens, 0) + COALESCE(g.output_tokens, 0) END), 0) AS token_count,
      COALESCE(SUM(${reportGenerationCostSql}), 0) AS generation_cost,
      (SELECT COUNT(*) FROM activity_log a WHERE a.user_id = u.id) AS activity_count,
      (SELECT COUNT(*) FROM plan_approvals pa WHERE pa.approved_by = u.id) AS approval_count,
      MAX(g.created_at) AS last_generation_at
    FROM users u
    LEFT JOIN workspace_roles wr ON wr.id = u.role_id
    LEFT JOIN generations g ON g.created_by = u.id
    GROUP BY u.id
    ORDER BY CASE COALESCE(wr.name, u.role) WHEN 'Generator' THEN 1 WHEN 'Creator' THEN 2 ELSE 3 END,
      generation_count DESC, u.display_name COLLATE NOCASE
  `).all().map((item) => ({ ...item, active: Boolean(item.active) }));

  const plans = db.prepare(`
    SELECT p.id, p.title, p.shot_code, p.sequence_number, p.shot_number, p.status, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM generations g WHERE g.plan_id = p.id) AS generation_count,
      (SELECT COUNT(*) FROM generations g WHERE g.plan_id = p.id AND g.status = 'Approved') AS approved_generation_count,
      (SELECT COUNT(*) FROM resources r WHERE r.plan_id = p.id) AS asset_count,
      (SELECT COALESCE(SUM(r.size_bytes), 0) FROM resources r WHERE r.plan_id = p.id) AS asset_bytes,
      (SELECT COALESCE(SUM(CASE WHEN COALESCE(g.platform_name, '') <> ''
        THEN COALESCE(g.token_count, 0)
        ELSE COALESCE(g.input_tokens, 0) + COALESCE(g.output_tokens, 0) END), 0)
        FROM generations g WHERE g.plan_id = p.id) AS token_count,
      (SELECT COALESCE(SUM(${reportGenerationCostSql}), 0) FROM generations g WHERE g.plan_id = p.id) AS generation_cost,
      (SELECT MAX(g.created_at) FROM generations g WHERE g.plan_id = p.id) AS last_generation_at
    FROM ai_plans p
    ORDER BY p.updated_at DESC, p.id DESC
  `).all();

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM ai_plans) AS plan_count,
      (SELECT COUNT(*) FROM generations) AS generation_count,
      (SELECT COUNT(*) FROM resources) AS asset_count,
      (SELECT COUNT(*) FROM activity_log) AS activity_count,
      (SELECT COALESCE(SUM(CASE WHEN COALESCE(g.platform_name, '') <> ''
        THEN COALESCE(g.token_count, 0)
        ELSE COALESCE(g.input_tokens, 0) + COALESCE(g.output_tokens, 0) END), 0) FROM generations g) AS token_count,
      (SELECT COALESCE(SUM(${reportGenerationCostSql}), 0) FROM generations g) AS generation_cost
  `).get();

  const planStatuses = db.prepare(`
    SELECT status AS label, COUNT(*) AS value
    FROM ai_plans
    GROUP BY status
    ORDER BY value DESC, status COLLATE NOCASE
  `).all();

  const generationStatuses = db.prepare(`
    SELECT status AS label, COUNT(*) AS value
    FROM generations
    GROUP BY status
    ORDER BY value DESC, status COLLATE NOCASE
  `).all();

  const platforms = db.prepare(`
    SELECT CASE WHEN TRIM(COALESCE(g.platform_name, '')) = '' THEN 'Legacy / untracked' ELSE g.platform_name END AS label,
      COUNT(*) AS generation_count,
      COALESCE(SUM(CASE WHEN COALESCE(g.platform_name, '') <> ''
        THEN COALESCE(g.token_count, 0)
        ELSE COALESCE(g.input_tokens, 0) + COALESCE(g.output_tokens, 0) END), 0) AS token_count,
      COALESCE(SUM(${reportGenerationCostSql}), 0) AS generation_cost
    FROM generations g
    GROUP BY label
    ORDER BY generation_cost DESC, token_count DESC, label COLLATE NOCASE
  `).all();

  const dailyPulse = db.prepare(`
    WITH RECURSIVE days(day) AS (
      SELECT DATE('now', '-13 days')
      UNION ALL
      SELECT DATE(day, '+1 day') FROM days WHERE day < DATE('now')
    )
    SELECT days.day,
      (SELECT COUNT(*) FROM generations g WHERE DATE(g.created_at) = days.day) AS generations,
      (SELECT COALESCE(SUM(CASE WHEN COALESCE(g.platform_name, '') <> ''
        THEN COALESCE(g.token_count, 0)
        ELSE COALESCE(g.input_tokens, 0) + COALESCE(g.output_tokens, 0) END), 0)
        FROM generations g WHERE DATE(g.created_at) = days.day) AS tokens,
      (SELECT COALESCE(SUM(${reportGenerationCostSql}), 0)
        FROM generations g WHERE DATE(g.created_at) = days.day) AS cost,
      (SELECT COUNT(*) FROM activity_log a WHERE DATE(a.created_at) = days.day) AS activities
    FROM days
    ORDER BY days.day
  `).all();

  const activityTypes = db.prepare(`
    SELECT CASE
      WHEN action LIKE '%approv%' THEN 'Approvals'
      WHEN action LIKE '%generat%' OR entity_type = 'generation' THEN 'Generations'
      WHEN action LIKE '%upload%' OR entity_type IN ('resource', 'asset') THEN 'Uploads & assets'
      WHEN action LIKE '%plan%' OR entity_type = 'plan' THEN 'Plan work'
      WHEN entity_type = 'auth' THEN 'Authentication'
      ELSE 'Other activity'
    END AS label, COUNT(*) AS value
    FROM activity_log
    GROUP BY label
    ORDER BY value DESC, label COLLATE NOCASE
  `).all();

  return {
    summary,
    users,
    plans,
    charts: { planStatuses, generationStatuses, platforms, dailyPulse, activityTypes }
  };
}

function normalizeTags(row) {
  return { ...row, tags: String(row.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean) };
}

function normalizedAssetTags(value) {
  const unique = new Map();
  (Array.isArray(value) ? value : String(value || "").split(",")).forEach((tag) => {
    const name = String(tag).trim().replace(/\s+/g, " ").slice(0, 80);
    if (name && !unique.has(name.toLocaleLowerCase())) unique.set(name.toLocaleLowerCase(), name);
  });
  return [...unique.values()];
}

function rememberAssetTags(tags) {
  const insert = db.prepare("INSERT OR IGNORE INTO asset_library_tags (name) VALUES (?)");
  tags.forEach((tag) => insert.run(tag));
}

function promptAssetRows(promptId) {
  return db.prepare(`
    SELECT pa.*, u.display_name AS uploaded_by_name
    FROM prompt_assets pa LEFT JOIN users u ON u.id = pa.uploaded_by
    WHERE pa.prompt_id = ? ORDER BY pa.created_at DESC, pa.id DESC
  `).all(promptId);
}

export function listPrompts() {
  return db.prepare(`
    SELECT p.*, u.display_name AS created_by_name,
      (SELECT COUNT(*) FROM prompt_assets pa WHERE pa.prompt_id = p.id) AS asset_count
    FROM prompt_library p LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.updated_at DESC, p.id DESC
  `).all().map((prompt) => ({ ...normalizeTags(prompt), assets: promptAssetRows(prompt.id) }));
}

export function getPrompt(id) {
  const prompt = db.prepare(`
    SELECT p.*, u.display_name AS created_by_name
    FROM prompt_library p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?
  `).get(id);
  return prompt ? { ...normalizeTags(prompt), assets: promptAssetRows(id) } : null;
}

export function createPrompt(input, createdBy) {
  const title = String(input.title || "").trim().slice(0, 160);
  const prompt = String(input.prompt || "").trim().slice(0, 30000);
  if (!title || !prompt) throw new Error("Title and prompt are required");
  const result = db.prepare(`
    INSERT INTO prompt_library (title, prompt, negative_prompt, tags, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, prompt, String(input.negative_prompt || "").trim().slice(0, 15000), String(input.tags || "").trim().slice(0, 1000), createdBy);
  return getPrompt(Number(result.lastInsertRowid));
}

export function updatePrompt(id, input) {
  const current = getPrompt(id);
  if (!current) throw new Error("Prompt not found");
  const title = String(input.title ?? current.title).trim().slice(0, 160);
  const prompt = String(input.prompt ?? current.prompt).trim().slice(0, 30000);
  if (!title || !prompt) throw new Error("Title and prompt are required");
  const tags = Array.isArray(input.tags) ? input.tags.join(",") : String(input.tags ?? current.tags.join(","));
  db.prepare(`
    UPDATE prompt_library SET title = ?, prompt = ?, negative_prompt = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, prompt, String(input.negative_prompt ?? current.negative_prompt).trim().slice(0, 15000), tags.trim().slice(0, 1000), id);
  return getPrompt(id);
}

export function createPromptAsset(input) {
  const result = db.prepare(`
    INSERT INTO prompt_assets (
      prompt_id, uploaded_by, original_name, storage_key, mime_type, kind, size_bytes, checksum_sha256
    ) VALUES (@promptId, @uploadedBy, @originalName, @storageKey, @mimeType, @kind, @sizeBytes, @checksumSha256)
  `).run(input);
  db.prepare("UPDATE prompt_library SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.promptId);
  return db.prepare("SELECT * FROM prompt_assets WHERE id = ?").get(Number(result.lastInsertRowid));
}

export function getPromptAsset(id) {
  return db.prepare("SELECT * FROM prompt_assets WHERE id = ?").get(id);
}

export function deletePromptAsset(id) {
  const asset = getPromptAsset(id);
  if (!asset) throw new Error("Prompt asset not found");
  db.prepare("DELETE FROM prompt_assets WHERE id = ?").run(id);
  return asset;
}

export function deletePrompt(id) {
  const prompt = getPrompt(id);
  if (!prompt) throw new Error("Prompt not found");
  const storageKeys = prompt.assets.map((asset) => asset.storage_key);
  db.prepare("DELETE FROM prompt_library WHERE id = ?").run(id);
  return storageKeys;
}

export function listLibraryAssets() {
  return db.prepare(`
    SELECT a.*, u.display_name AS uploaded_by_name
    FROM asset_library a LEFT JOIN users u ON u.id = a.uploaded_by
    ORDER BY a.created_at DESC, a.id DESC
  `).all().map((asset) => ({ ...normalizeTags(asset), files: assetLibraryFileRows(asset.id) }));
}

function assetLibraryFileRows(assetId) {
  return db.prepare(`
    SELECT * FROM asset_library_files WHERE asset_id = ? ORDER BY id ASC
  `).all(assetId);
}

export function getLibraryAsset(id) {
  const asset = db.prepare(`
    SELECT a.*, u.display_name AS uploaded_by_name
    FROM asset_library a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = ?
  `).get(id);
  return asset ? { ...normalizeTags(asset), files: assetLibraryFileRows(asset.id) } : null;
}

export function getLibraryAssetFile(id) {
  return db.prepare("SELECT * FROM asset_library_files WHERE id = ?").get(id);
}

export function listLibraryAssetTags() {
  return db.prepare("SELECT name FROM asset_library_tags ORDER BY name COLLATE NOCASE").all().map((row) => row.name);
}

export function saveLibraryAssetTag(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || name.includes(",")) throw new Error("Enter a tag of up to 80 characters without a comma");
  db.prepare("INSERT OR IGNORE INTO asset_library_tags (name) VALUES (?)").run(name);
  return db.prepare("SELECT name FROM asset_library_tags WHERE name = ? COLLATE NOCASE").get(name).name;
}

export function createLibraryAsset(input) {
  const files = Array.isArray(input.files) ? input.files : [];
  if (!files.length) throw new Error("Choose at least one file to upload");
  const firstFile = files[0];
  const title = String(input.title || firstFile.originalName || "").trim().slice(0, 160);
  if (!title) throw new Error("Asset title is required");
  const tags = normalizedAssetTags(input.tags);
  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO asset_library (
        title, description, category, tags, uploaded_by, original_name, storage_key,
        mime_type, kind, size_bytes, checksum_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, String(input.description || "").trim().slice(0, 3000), String(input.category || "Other").trim().slice(0, 80),
      tags.join(","), input.uploadedBy, firstFile.originalName, firstFile.storageKey, firstFile.mimeType, firstFile.kind, firstFile.sizeBytes, firstFile.checksumSha256);
    const assetId = Number(result.lastInsertRowid);
    const insertFile = db.prepare(`
      INSERT INTO asset_library_files (asset_id, original_name, storage_key, mime_type, kind, size_bytes, checksum_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    files.forEach((file) => insertFile.run(assetId, file.originalName, file.storageKey, file.mimeType, file.kind, file.sizeBytes, file.checksumSha256));
    rememberAssetTags(tags);
    return assetId;
  });
  return getLibraryAsset(create());
}

export function updateLibraryAsset(id, input) {
  const current = getLibraryAsset(id);
  if (!current) throw new Error("Asset not found");
  const title = String(input.title ?? current.title).trim().slice(0, 160);
  if (!title) throw new Error("Asset title is required");
  const tags = normalizedAssetTags(input.tags ?? current.tags);
  db.transaction(() => {
    db.prepare(`
      UPDATE asset_library SET title = ?, description = ?, category = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, String(input.description ?? current.description).trim().slice(0, 3000),
      String(input.category ?? current.category).trim().slice(0, 80), tags.join(",").slice(0, 1000), id);
    rememberAssetTags(tags);
  })();
  return getLibraryAsset(id);
}

export function deleteLibraryAsset(id) {
  const asset = getLibraryAsset(id);
  if (!asset) throw new Error("Asset not found");
  db.prepare("DELETE FROM asset_library WHERE id = ?").run(id);
  return asset;
}

const allowedStatuses = new Set(["WIP", "Approved"]);

export function createPlan(input) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Title is required");
  const isTestPlan = input.is_test_plan === true || input.is_test_plan === 1 || ["true", "1", "on"].includes(String(input.is_test_plan || "").toLowerCase());
  const numbers = isTestPlan ? { sequence_number: null, shot_number: null } : shotNumbers(input);
  const shotCode = isTestPlan ? "TEST" : `SQ${String(numbers.sequence_number).padStart(2, "0")}-SH${String(numbers.shot_number).padStart(3, "0")}`;

  const project = db.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get();
  const status = allowedStatuses.has(input.status) ? input.status : "WIP";
  const model = String(input.model || "Not selected").trim();
  if (model !== "Not selected" && !db.prepare("SELECT id FROM generation_models WHERE name = ? COLLATE NOCASE AND active = 1").get(model)) {
    throw new Error("Select an available AI model");
  }
  const imagePositions = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"];
  const count = db.prepare("SELECT COUNT(*) AS count FROM ai_plans").get().count;

  const result = db.prepare(`
    INSERT INTO ai_plans (
      project_id, shot_code, title, is_test_plan, description, status, media_type, owner, model,
      due_date, priority, next_action, prompt, aspect_ratio, duration, tags, image_position, sequence_number, shot_number, sequence_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id, shotCode, title, Number(isTestPlan), String(input.description || ""), status,
    String(input.media_type || "Video"), String(input.owner || "Unassigned"),
    model, null,
    String(input.priority || "Medium"), String(input.next_action || "Complete creative brief"),
    String(input.prompt || ""), String(input.aspect_ratio || "16:9"),
    String(input.duration || "5 sec"), String(input.tags || ""),
    imagePositions[count % imagePositions.length], numbers.sequence_number, numbers.shot_number, `Sequence ${numbers.sequence_number}`
  );

  return getPlan(Number(result.lastInsertRowid));
}

export function updatePlanStatus(id, status, userId = null) {
  if (!allowedStatuses.has(status)) throw new Error("Invalid status");
  if (status === "Approved") {
    return approvePlan(id, userId);
  }
  db.transaction(() => {
    db.prepare("UPDATE ai_plans SET status = 'WIP', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    db.prepare("UPDATE generations SET status = 'WIP', updated_at = CURRENT_TIMESTAMP WHERE plan_id = ?").run(id);
  })();
  return getPlan(id);
}

export function updatePlan(id, input) {
  const current = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(id);
  if (!current) throw new Error("Plan not found");
  matchingShotNumbers(current, input, { partial: true });

  if (Object.hasOwn(input, "model")) {
    const requestedModel = String(input.model || "Not selected").trim();
    if (requestedModel !== current.model && requestedModel !== "Not selected"
      && !db.prepare("SELECT id FROM generation_models WHERE name = ? COLLATE NOCASE AND active = 1").get(requestedModel)) {
      throw new Error("Select an available AI model");
    }
    input = { ...input, model: requestedModel };
  }

  const fields = ["title", "description", "owner", "model", "quality", "priority", "next_action", "issue", "prompt", "negative_prompt", "aspect_ratio", "duration", "tags"];
  const changes = {};
  fields.forEach((field) => {
    if (Object.hasOwn(input, field)) {
      changes[field] = field === "tags" && Array.isArray(input[field]) ? input[field].join(",") : input[field];
    }
  });
  if (!Object.keys(changes).length) return getPlan(id);

  const assignments = Object.keys(changes).map((field) => `${field} = @${field}`).join(", ");
  db.prepare(`UPDATE ai_plans SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, ...changes });
  return getPlan(id);
}

export function findUserByUsername(username) {
  return hydrateUser(db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username));
}

function hydrateUser(user) {
  if (!user) return null;
  const role = user.role_id ? db.prepare("SELECT name FROM workspace_roles WHERE id = ?").get(user.role_id) : null;
  return { ...user, role: role?.name || user.role };
}

export function setUserPassword(id, passwordHash) {
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?, must_set_password = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND must_set_password = 1 AND password_hash IS NULL AND active = 1
  `).run(passwordHash, id);
  if (!result.changes) throw new Error("This account cannot be activated");
  return hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

export function resetUserPassword(id, passwordHash) {
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!current || !current.active) throw new Error("Active account not found");
  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, must_set_password = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  })();
  return hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

export function markUserLogin(id) {
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function saveSession(tokenHash, userId, expiresAt) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function getUserBySessionHash(tokenHash) {
  return hydrateUser(db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(tokenHash, new Date().toISOString()));
}

export function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function listAccounts() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, COALESCE(wr.name, u.role) AS role, u.must_set_password, u.active,
           u.last_login_at, u.created_at, creator.username AS created_by_username
    FROM users u
    LEFT JOIN workspace_roles wr ON wr.id = u.role_id
    LEFT JOIN users creator ON creator.id = u.created_by
    ORDER BY u.active DESC,
      CASE COALESCE(wr.name, u.role) WHEN 'Admin' THEN 1 WHEN 'Supervisor' THEN 2 WHEN 'Generator' THEN 3 ELSE 4 END,
      u.display_name COLLATE NOCASE
  `).all();
}

export function createAccount({ username, displayName, role, createdBy }) {
  const roleRow = roleRowByName(role);
  if (!roleRow) throw new Error("Invalid role");
  const legacyRole = ["Admin", "Supervisor", "Creator", "Reviewer", "Viewer"].includes(roleRow.name) ? roleRow.name : "Viewer";
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, role, role_id, password_hash, must_set_password, active, created_by)
      VALUES (?, ?, ?, ?, NULL, 1, 1, ?)
    `).run(username, displayName, legacyRole, roleRow.id, createdBy);
    return listAccounts().find((user) => user.id === Number(result.lastInsertRowid));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That username is already in use");
    throw error;
  }
}

export function updateAccount(id, { role, active }) {
  const current = hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  if (!current) throw new Error("Account not found");
  const nextRole = role ?? current.role;
  const nextRoleRow = roleRowByName(nextRole);
  if (!nextRoleRow) throw new Error("Invalid role");
  const nextActive = active === undefined ? current.active : Number(Boolean(active));

  if (current.role === "Admin" && current.active && (nextRole !== "Admin" || !nextActive)) {
    const adminRole = roleRowByName("Admin");
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND active = 1").get(adminRole.id).count;
    if (adminCount <= 1) throw new Error("AI Hub must keep at least one active Admin");
  }

  const legacyRole = ["Admin", "Supervisor", "Creator", "Reviewer", "Viewer"].includes(nextRoleRow.name) ? nextRoleRow.name : "Viewer";
  db.prepare(`
    UPDATE users SET role = ?, role_id = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(legacyRole, nextRoleRow.id, nextActive, id);
  if (!nextActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);

  return listAccounts().find((user) => user.id === id);
}
