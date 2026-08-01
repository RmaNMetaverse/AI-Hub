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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  CREATE INDEX IF NOT EXISTS ai_plans_status_idx ON ai_plans(status);
  CREATE INDEX IF NOT EXISTS ai_plans_project_idx ON ai_plans(project_id);
  CREATE INDEX IF NOT EXISTS generations_plan_idx ON generations(plan_id);
  CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

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
  const generations = db.prepare("SELECT * FROM generations WHERE plan_id = ? ORDER BY id DESC").all(id);
  return { ...normalizePlan(plan), generations };
}

const allowedStatuses = new Set(["Idea", "Brief Ready", "Generating", "Review", "Revision", "Approved", "Delivered"]);

export function createPlan(input) {
  const title = String(input.title || "").trim();
  const shotCode = String(input.shot_code || "").trim();
  if (!title || !shotCode) throw new Error("Title and shot code are required");

  const project = db.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get();
  const status = allowedStatuses.has(input.status) ? input.status : "Idea";
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
    String(input.model || "Not selected"), input.due_date || null,
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
