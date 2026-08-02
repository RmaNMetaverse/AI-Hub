import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

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
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Idea',
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

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("ai_plans", "selected_generation_id", "INTEGER");
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
ensureColumn("generations", "updated_at", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS ai_plans_selected_generation_idx ON ai_plans(selected_generation_id)");

const defaultGenerationModels = ["Seedance 2.5", "Seedance 2.0", "Seedance 2.0 Fast", "Kling 3.0", "Gemini Omni", "LTX"];
const defaultGenerationPlatforms = ["ComfyUI", "Higgsfield", "Vidax"];
const defaultGenerationResourceRoles = [
  "Output", "First Frame", "Last Frame", "Depth Map", "Reference Video", "Reference Image",
  "Motion Reference", "Mask", "Control Pose", "Audio Reference", "Other Input"
];

const seedCatalogs = db.transaction(() => {
  const insertModel = db.prepare("INSERT OR IGNORE INTO generation_models (name) VALUES (?)");
  defaultGenerationModels.forEach((name) => insertModel.run(name));
  const insertPlatform = db.prepare("INSERT OR IGNORE INTO generation_platforms (name, token_price) VALUES (?, 0)");
  defaultGenerationPlatforms.forEach((name) => insertPlatform.run(name));
  const insertRole = db.prepare("INSERT OR IGNORE INTO generation_resource_roles (name, sort_order) VALUES (?, ?)");
  defaultGenerationResourceRoles.forEach((name, index) => insertRole.run(name, index + 1));
});

seedCatalogs();

function seedInitialAdmin() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount > 0) return;
  db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash, must_set_password, active)
    VALUES ('admin', 'Workspace Admin', 'Admin', NULL, 1, 1)
  `).run();
}

seedInitialAdmin();

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
      shot_code: "SC01-SH006", title: "First Light", status: "Brief Ready",
      description: "Mara reaches the survey ridge as the planet's twin dawn breaks over the basin.",
      model: "Sora 2 Pro", quality: 3.8, due_date: "2026-08-08", priority: "High",
      experiments_count: 6, next_action: "Lock the astronaut silhouette", issue: "",
      prompt: "Wide anamorphic establishing shot of a lone astronaut reaching a rocky ridge at first light, restrained warm haze, slow push forward, practical suit detail, monumental empty landscape.",
      tags: "desert,astronaut,establishing", image_position: "0% 0%", owner: "Nika", duration: "8 sec"
    },
    {
      shot_code: "SC02-SH014", title: "Signal District", status: "Generating",
      description: "A courier crosses the flooded lower city while the first signal interrupts every display.",
      model: "Veo 3.1", quality: 3.4, due_date: "2026-08-09", priority: "Critical",
      experiments_count: 12, next_action: "Reduce background flicker", issue: "Signage flickers between frames",
      prompt: "Night exterior, narrow rain-soaked future city alley, solitary courier walking away from camera, cyan practicals and restrained red signage, wet reflections, controlled handheld camera.",
      tags: "city,rain,night", image_position: "50% 0%", owner: "Arman", duration: "6 sec"
    },
    {
      shot_code: "SC03-SH002", title: "The Memory Test", status: "Review",
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
      shot_code: "SC01-SH011", title: "Salt Run", status: "Revision",
      description: "The survey vehicle races toward the horizon as the storm begins to erase the road behind it.",
      model: "Luma Ray 3", quality: 3.9, due_date: "2026-08-10", priority: "Medium",
      experiments_count: 14, next_action: "Correct wheel motion", issue: "Rear wheel motion drifts",
      prompt: "Rear tracking shot of a vintage black sedan crossing an endless pale salt flat under a heavy sky, natural tire dust, slow cinematic acceleration, muted neutral grade.",
      tags: "car,salt-flat,motion", image_position: "50% 100%", owner: "Nika", duration: "7 sec"
    },
    {
      shot_code: "SC05-SH004", title: "Forest Gate", status: "Idea",
      description: "A geometric aperture appears inside the forest after the signal reaches Earth.",
      model: "Not selected", quality: 0, due_date: "2026-08-14", priority: "Low",
      experiments_count: 0, next_action: "Build the reference board", issue: "",
      prompt: "Ancient dark forest after rain, subtle luminous geometric aperture suspended between trees, lone human silhouette for scale, physically grounded light interaction.",
      tags: "forest,portal,finale", image_position: "100% 100%", owner: "Unassigned", duration: "6 sec"
    }
  ];

  const insertGeneration = db.prepare(`
    INSERT INTO generations (plan_id, label, prompt_version, model, rating, verdict, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
          Math.max(2.8, plan.quality - 0.4), "Needs revision", "Strong composition; motion needs refinement."
        );
        insertGeneration.run(
          Number(result.lastInsertRowid), "Take D", "v5", plan.model,
          plan.quality, plan.status === "Approved" ? "Approved" : "Final candidate",
          "Best balance of continuity, atmosphere, and prompt adherence."
        );
      }
    });
  });

  seed();
}

seedDatabase();

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

export function getDashboard() {
  const project = db.prepare("SELECT * FROM projects ORDER BY id LIMIT 1").get();
  const plans = db.prepare("SELECT * FROM ai_plans WHERE project_id = ? ORDER BY updated_at DESC, id DESC").all(project.id).map(normalizePlan);
  return { project, plans };
}

export function getPlan(id) {
  const plan = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(id);
  if (!plan) return null;
  const generations = listGenerations(id);
  const resources = listResources(id);
  const selectedGeneration = generations.find((generation) => generation.id === plan.selected_generation_id) || null;
  return {
    ...normalizePlan(plan),
    generations,
    selected_generation: selectedGeneration,
    generation_count: generations.length,
    resources,
    resource_count: resources.length,
    resource_bytes: resources.reduce((total, resource) => total + resource.size_bytes, 0)
  };
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
  resource_roles: "generation_resource_roles"
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
    resource_roles: catalogRows("resource_roles", includeInactive)
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
    seed: String(input.seed ?? current.seed ?? "").trim().slice(0, 240)
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
  const fields = generationFields(planId, input, { prompt: plan.prompt, negative_prompt: plan.negative_prompt, model: plan.model });
  const links = generationLinks(planId, input.resources);

  const generationId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO generations (
        plan_id, label, prompt_version, version_number, model, notes, prompt, negative_prompt,
        platform_id, platform_name, token_count, token_price_snapshot, seed, created_by
      ) VALUES (
        @plan_id, @label, @prompt_version, @version_number, @model, @notes, @prompt, @negative_prompt,
        @platform_id, @platform_name, @token_count, @token_price_snapshot, @seed, @created_by
      )
    `).run({ plan_id: planId, created_by: createdBy, ...fields });
    const id = Number(result.lastInsertRowid);
    replaceGenerationResources(id, links);
    db.prepare(`
      UPDATE ai_plans
      SET experiments_count = experiments_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(planId);
    return id;
  })();

  return getGeneration(generationId);
}

export function updateGeneration(id, input) {
  const current = db.prepare("SELECT * FROM generations WHERE id = ?").get(id);
  if (!current) throw new Error("Generation not found");
  const fields = generationFields(current.plan_id, input, current);
  const links = input.resources === undefined ? null : generationLinks(current.plan_id, input.resources, id);

  db.transaction(() => {
    db.prepare(`
      UPDATE generations SET
        label = @label, prompt_version = @prompt_version, version_number = @version_number,
        model = @model, notes = @notes, prompt = @prompt, negative_prompt = @negative_prompt,
        platform_id = @platform_id, platform_name = @platform_name, token_count = @token_count,
        token_price_snapshot = @token_price_snapshot, seed = @seed, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id, ...fields });
    if (links) replaceGenerationResources(id, links);
    db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(current.plan_id);
  })();

  return getGeneration(id);
}

export function selectGeneration(planId, generationId) {
  const plan = db.prepare("SELECT id FROM ai_plans WHERE id = ?").get(planId);
  if (!plan) throw new Error("Shot not found");
  const generation = db.prepare("SELECT id FROM generations WHERE id = ? AND plan_id = ?").get(generationId, planId);
  if (!generation) throw new Error("Generation does not belong to this shot");
  db.prepare("UPDATE ai_plans SET selected_generation_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(generationId, planId);
  return getPlan(planId);
}

export function createResource(input) {
  const resourceId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO resources (
        plan_id, uploaded_by, original_name, storage_key, mime_type, kind,
        category, size_bytes, checksum_sha256, notes
      ) VALUES (
        @planId, @uploadedBy, @originalName, @storageKey, @mimeType, @kind,
        @category, @sizeBytes, @checksumSha256, @notes
      )
    `).run(input);
    db.prepare("UPDATE ai_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.planId);
    return Number(result.lastInsertRowid);
  })();
  return getResource(resourceId);
}

export function updateResource(id, { category, notes }) {
  const current = getResource(id);
  if (!current) throw new Error("Resource not found");
  db.prepare(`
    UPDATE resources
    SET category = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(category ?? current.category, notes ?? current.notes, id);
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

const allowedStatuses = new Set(["Idea", "Brief Ready", "Generating", "Review", "Revision", "Approved", "Delivered"]);

export function createPlan(input) {
  const title = String(input.title || "").trim();
  const shotCode = String(input.shot_code || "").trim();
  if (!title || !shotCode) throw new Error("Title and shot code are required");

  const project = db.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get();
  const status = allowedStatuses.has(input.status) ? input.status : "Idea";
  const model = String(input.model || "Not selected").trim();
  if (model !== "Not selected" && !db.prepare("SELECT id FROM generation_models WHERE name = ? COLLATE NOCASE AND active = 1").get(model)) {
    throw new Error("Select an available AI model");
  }
  const imagePositions = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"];
  const count = db.prepare("SELECT COUNT(*) AS count FROM ai_plans").get().count;

  const result = db.prepare(`
    INSERT INTO ai_plans (
      project_id, shot_code, title, description, status, media_type, owner, model,
      due_date, priority, next_action, prompt, aspect_ratio, duration, tags, image_position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id, shotCode, title, String(input.description || ""), status,
    String(input.media_type || "Video"), String(input.owner || "Unassigned"),
    model, input.due_date || null,
    String(input.priority || "Medium"), String(input.next_action || "Complete creative brief"),
    String(input.prompt || ""), String(input.aspect_ratio || "16:9"),
    String(input.duration || "5 sec"), String(input.tags || ""),
    imagePositions[count % imagePositions.length]
  );

  return getPlan(Number(result.lastInsertRowid));
}

export function updatePlanStatus(id, status) {
  if (!allowedStatuses.has(status)) throw new Error("Invalid status");
  const result = db.prepare("UPDATE ai_plans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  if (!result.changes) throw new Error("Plan not found");
  return getPlan(id);
}

export function updatePlan(id, input) {
  const current = db.prepare("SELECT * FROM ai_plans WHERE id = ?").get(id);
  if (!current) throw new Error("Plan not found");

  if (Object.hasOwn(input, "model")) {
    const requestedModel = String(input.model || "Not selected").trim();
    if (requestedModel !== current.model && requestedModel !== "Not selected"
      && !db.prepare("SELECT id FROM generation_models WHERE name = ? COLLATE NOCASE AND active = 1").get(requestedModel)) {
      throw new Error("Select an available AI model");
    }
    input = { ...input, model: requestedModel };
  }

  const fields = ["title", "description", "owner", "model", "quality", "due_date", "priority", "next_action", "issue", "prompt", "negative_prompt", "aspect_ratio", "duration", "tags"];
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
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
}

export function setUserPassword(id, passwordHash) {
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?, must_set_password = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND must_set_password = 1 AND password_hash IS NULL AND active = 1
  `).run(passwordHash, id);
  if (!result.changes) throw new Error("This account cannot be activated");
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function markUserLogin(id) {
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function saveSession(tokenHash, userId, expiresAt) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function getUserBySessionHash(tokenHash) {
  return db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(tokenHash, new Date().toISOString());
}

export function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function listAccounts() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.must_set_password, u.active,
           u.last_login_at, u.created_at, creator.username AS created_by_username
    FROM users u
    LEFT JOIN users creator ON creator.id = u.created_by
    ORDER BY u.active DESC,
      CASE u.role WHEN 'Admin' THEN 1 WHEN 'Supervisor' THEN 2 WHEN 'Creator' THEN 3 WHEN 'Reviewer' THEN 4 ELSE 5 END,
      u.display_name COLLATE NOCASE
  `).all();
}

export function createAccount({ username, displayName, role, createdBy }) {
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, role, password_hash, must_set_password, active, created_by)
      VALUES (?, ?, ?, NULL, 1, 1, ?)
    `).run(username, displayName, role, createdBy);
    return db.prepare(`
      SELECT id, username, display_name, role, must_set_password, active, last_login_at, created_at
      FROM users WHERE id = ?
    `).get(Number(result.lastInsertRowid));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("That username is already in use");
    throw error;
  }
}

export function updateAccount(id, { role, active }) {
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!current) throw new Error("Account not found");
  const nextRole = role ?? current.role;
  const nextActive = active === undefined ? current.active : Number(Boolean(active));

  if (current.role === "Admin" && current.active && (nextRole !== "Admin" || !nextActive)) {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND active = 1").get().count;
    if (adminCount <= 1) throw new Error("AI Hub must keep at least one active Admin");
  }

  db.prepare(`
    UPDATE users SET role = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(nextRole, nextActive, id);
  if (!nextActive) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);

  return db.prepare(`
    SELECT id, username, display_name, role, must_set_password, active, last_login_at, created_at
    FROM users WHERE id = ?
  `).get(id);
}
