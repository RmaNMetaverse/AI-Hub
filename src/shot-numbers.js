export const MAX_SHOT_NUMBER = 1_000_000;

export function shotNumber(value, label) {
  if ((typeof value !== "string" && typeof value !== "number")
    || !/^\d+$/.test(String(value).trim())) {
    throw new Error(`${label} is required and must be a whole number from 1 to ${MAX_SHOT_NUMBER}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_SHOT_NUMBER) {
    throw new Error(`${label} must be a whole number from 1 to ${MAX_SHOT_NUMBER}`);
  }
  return number;
}

export function sequenceNumber(value, label = "#Seq") {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} is required and must be a number or text up to 100 characters`);
  }
  const sequence = String(value).trim();
  if (!sequence || sequence.length > 100 || /[\u0000-\u001f\u007f]/.test(sequence)) {
    throw new Error(`${label} is required and must be a number or text up to 100 characters`);
  }
  // Keep numeric sequence IDs normalized and subject to the existing limits.
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(sequence)) return shotNumber(sequence, label);
  return sequence;
}

export function shotNumbers(input) {
  return {
    sequence_number: sequenceNumber(input.sequence_number),
    shot_number: shotNumber(input.shot_number, "#Shot")
  };
}

export function matchingShotNumbers(plan, input, { partial = false } = {}) {
  if (plan.is_test_plan) return { sequence_number: null, shot_number: null };
  const numbers = shotNumbers(partial ? {
    sequence_number: input.sequence_number === undefined ? plan.sequence_number : input.sequence_number,
    shot_number: input.shot_number === undefined ? plan.shot_number : input.shot_number
  } : input);
  if (String(numbers.sequence_number) !== String(plan.sequence_number) || numbers.shot_number !== plan.shot_number) {
    throw new Error(`#Seq and #Shot are locked to ${plan.sequence_number} / ${plan.shot_number} for this shot`);
  }
  return numbers;
}

export function shotFilters(input) {
  const filters = {};
  if (input.sequence_number !== undefined && input.sequence_number !== null && input.sequence_number !== "") {
    filters.sequence_number = sequenceNumber(input.sequence_number);
  }
  if (input.shot_number !== undefined && input.shot_number !== null && input.shot_number !== "") {
    filters.shot_number = shotNumber(input.shot_number, "#Shot");
  }
  return filters;
}

// Existing names take precedence over legacy SC codes, which may identify a scene.
export function migrateShotNumbers(db) {
  db.transaction(() => {
    const hasTestFlag = db.prepare("PRAGMA table_info(ai_plans)").all().some((item) => item.name === "is_test_plan");
    const plans = db.prepare(`SELECT id, sequence_number, shot_number, sequence_name, shot_code${hasTestFlag ? ", is_test_plan" : ""} FROM ai_plans ORDER BY id`).all();
    const valid = (value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_SHOT_NUMBER;
    const usableSequence = (value) => typeof value === "string"
      ? value.trim().length > 0 && value.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(value)
      : valid(value);
    const storedSequence = (value) => {
      try { return sequenceNumber(value); }
      catch (_error) { return null; }
    };
    const used = new Map();
    const numbered = plans.map((plan) => {
      const sequence = [storedSequence(plan.sequence_number), Number(plan.sequence_name.match(/\d+/)?.[0]), Number(plan.shot_code.match(/(?:SQ|SEQ|SC)(\d+)/i)?.[1]), 1].find(usableSequence);
      const shot = [plan.shot_number, Number(plan.shot_code.match(/SH(?:OT)?[\s-]*(\d+)/i)?.[1])].find(valid);
      if (!used.has(sequence)) used.set(sequence, new Set());
      if (shot) used.get(sequence).add(shot);
      return { ...plan, sequence, shot };
    });
    const update = db.prepare("UPDATE ai_plans SET sequence_number = ?, shot_number = ? WHERE id = ?");
    for (const plan of numbered) {
      if (hasTestFlag && plan.is_test_plan) continue;
      let shot = plan.shot || 1;
      if (!plan.shot) {
        while (used.get(plan.sequence).has(shot)) shot += 1;
        if (shot > MAX_SHOT_NUMBER) throw new Error("No available shot number for migration");
        used.get(plan.sequence).add(shot);
      }
      update.run(plan.sequence, shot, plan.id);
    }
    db.exec(`
      DROP TRIGGER IF EXISTS ai_plans_numbers_insert;
      DROP TRIGGER IF EXISTS ai_plans_numbers_locked;
      DROP TRIGGER IF EXISTS generations_numbers_insert;
      DROP TRIGGER IF EXISTS generations_numbers_locked;
      UPDATE generations SET
        sequence_number = (SELECT sequence_number FROM ai_plans WHERE id = generations.plan_id),
        shot_number = (SELECT shot_number FROM ai_plans WHERE id = generations.plan_id)
      WHERE sequence_number IS NULL OR shot_number IS NULL;
      CREATE INDEX IF NOT EXISTS ai_plans_numbers_idx ON ai_plans(project_id, sequence_number, shot_number);
      CREATE TRIGGER ai_plans_numbers_insert BEFORE INSERT ON ai_plans
      WHEN ${hasTestFlag
        ? "(COALESCE(NEW.is_test_plan, 0) = 0 AND ((typeof(NEW.sequence_number) = 'integer' AND NEW.sequence_number NOT BETWEEN 1 AND 1000000) OR (typeof(NEW.sequence_number) = 'text' AND length(trim(NEW.sequence_number)) NOT BETWEEN 1 AND 100) OR typeof(NEW.sequence_number) NOT IN ('integer', 'text') OR typeof(NEW.shot_number) <> 'integer' OR NEW.shot_number NOT BETWEEN 1 AND 1000000)) OR (COALESCE(NEW.is_test_plan, 0) = 1 AND (NEW.sequence_number IS NOT NULL OR NEW.shot_number IS NOT NULL))"
        : "((typeof(NEW.sequence_number) = 'integer' AND NEW.sequence_number NOT BETWEEN 1 AND 1000000) OR (typeof(NEW.sequence_number) = 'text' AND length(trim(NEW.sequence_number)) NOT BETWEEN 1 AND 100) OR typeof(NEW.sequence_number) NOT IN ('integer', 'text') OR typeof(NEW.shot_number) <> 'integer' OR NEW.shot_number NOT BETWEEN 1 AND 1000000)"}
      BEGIN SELECT RAISE(ABORT, '#Seq must be a number or text and #Shot must be a positive integer'); END;
      CREATE TRIGGER ai_plans_numbers_locked BEFORE UPDATE OF sequence_number, shot_number, ${hasTestFlag ? "is_test_plan" : "sequence_number"} ON ai_plans
      WHEN NEW.sequence_number IS NOT OLD.sequence_number OR NEW.shot_number IS NOT OLD.shot_number
      BEGIN SELECT RAISE(ABORT, '#Seq and #Shot are locked'); END;
      CREATE TRIGGER generations_numbers_insert BEFORE INSERT ON generations
      WHEN ${hasTestFlag
        ? "NOT EXISTS (SELECT 1 FROM ai_plans WHERE id = NEW.plan_id AND is_test_plan = 1) AND (NEW.sequence_number IS NOT (SELECT sequence_number FROM ai_plans WHERE id = NEW.plan_id) OR NEW.shot_number IS NOT (SELECT shot_number FROM ai_plans WHERE id = NEW.plan_id) OR NEW.sequence_number IS NULL OR NEW.shot_number IS NULL)"
        : "NEW.sequence_number IS NOT (SELECT sequence_number FROM ai_plans WHERE id = NEW.plan_id) OR NEW.shot_number IS NOT (SELECT shot_number FROM ai_plans WHERE id = NEW.plan_id) OR NEW.sequence_number IS NULL OR NEW.shot_number IS NULL"}
      BEGIN SELECT RAISE(ABORT, 'Generation numbers must match its shot'); END;
      CREATE TRIGGER generations_numbers_locked BEFORE UPDATE OF plan_id, sequence_number, shot_number ON generations
      WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.sequence_number IS NOT OLD.sequence_number OR NEW.shot_number IS NOT OLD.shot_number
      BEGIN SELECT RAISE(ABORT, 'Generation shot and numbers are locked'); END;
    `);
  })();
}
