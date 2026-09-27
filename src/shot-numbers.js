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

export function shotNumbers(input) {
  return {
    sequence_number: shotNumber(input.sequence_number, "#Seq"),
    shot_number: shotNumber(input.shot_number, "#Shot")
  };
}

export function matchingShotNumbers(plan, input, { partial = false } = {}) {
  const numbers = shotNumbers(partial ? {
    sequence_number: input.sequence_number === undefined ? plan.sequence_number : input.sequence_number,
    shot_number: input.shot_number === undefined ? plan.shot_number : input.shot_number
  } : input);
  if (numbers.sequence_number !== plan.sequence_number || numbers.shot_number !== plan.shot_number) {
    throw new Error(`#Seq and #Shot are locked to ${plan.sequence_number} / ${plan.shot_number} for this shot`);
  }
  return numbers;
}

export function shotFilters(input) {
  const filters = {};
  for (const [key, label] of [["sequence_number", "#Seq"], ["shot_number", "#Shot"]]) {
    if (input[key] !== undefined && input[key] !== "") filters[key] = shotNumber(input[key], label);
  }
  return filters;
}

// Existing names take precedence over legacy SC codes, which may identify a scene.
export function migrateShotNumbers(db) {
  db.transaction(() => {
    const plans = db.prepare("SELECT id, sequence_number, shot_number, sequence_name, shot_code FROM ai_plans ORDER BY id").all();
    const valid = (value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_SHOT_NUMBER;
    const used = new Map();
    const numbered = plans.map((plan) => {
      const sequence = [plan.sequence_number, Number(plan.sequence_name.match(/\d+/)?.[0]), Number(plan.shot_code.match(/(?:SQ|SEQ|SC)(\d+)/i)?.[1]), 1].find(valid);
      const shot = [plan.shot_number, Number(plan.shot_code.match(/SH(?:OT)?[\s-]*(\d+)/i)?.[1])].find(valid);
      if (!used.has(sequence)) used.set(sequence, new Set());
      if (shot) used.get(sequence).add(shot);
      return { ...plan, sequence, shot };
    });
    const update = db.prepare("UPDATE ai_plans SET sequence_number = ?, shot_number = ? WHERE id = ?");
    for (const plan of numbered) {
      let shot = plan.shot || 1;
      if (!plan.shot) {
        while (used.get(plan.sequence).has(shot)) shot += 1;
        if (shot > MAX_SHOT_NUMBER) throw new Error("No available shot number for migration");
        used.get(plan.sequence).add(shot);
      }
      update.run(plan.sequence, shot, plan.id);
    }
    db.exec(`
      UPDATE generations SET
        sequence_number = (SELECT sequence_number FROM ai_plans WHERE id = generations.plan_id),
        shot_number = (SELECT shot_number FROM ai_plans WHERE id = generations.plan_id)
      WHERE sequence_number IS NULL OR shot_number IS NULL;
      CREATE INDEX IF NOT EXISTS ai_plans_numbers_idx ON ai_plans(project_id, sequence_number, shot_number);
      CREATE TRIGGER IF NOT EXISTS ai_plans_numbers_insert BEFORE INSERT ON ai_plans
      WHEN typeof(NEW.sequence_number) <> 'integer' OR NEW.sequence_number NOT BETWEEN 1 AND 1000000
        OR typeof(NEW.shot_number) <> 'integer' OR NEW.shot_number NOT BETWEEN 1 AND 1000000
      BEGIN SELECT RAISE(ABORT, '#Seq and #Shot are required positive integers'); END;
      CREATE TRIGGER IF NOT EXISTS ai_plans_numbers_locked BEFORE UPDATE OF sequence_number, shot_number ON ai_plans
      WHEN NEW.sequence_number IS NOT OLD.sequence_number OR NEW.shot_number IS NOT OLD.shot_number
      BEGIN SELECT RAISE(ABORT, '#Seq and #Shot are locked'); END;
      CREATE TRIGGER IF NOT EXISTS generations_numbers_insert BEFORE INSERT ON generations
      WHEN NEW.sequence_number IS NOT (SELECT sequence_number FROM ai_plans WHERE id = NEW.plan_id)
        OR NEW.shot_number IS NOT (SELECT shot_number FROM ai_plans WHERE id = NEW.plan_id)
        OR NEW.sequence_number IS NULL OR NEW.shot_number IS NULL
      BEGIN SELECT RAISE(ABORT, 'Generation numbers must match its shot'); END;
      CREATE TRIGGER IF NOT EXISTS generations_numbers_locked BEFORE UPDATE OF plan_id, sequence_number, shot_number ON generations
      WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.sequence_number IS NOT OLD.sequence_number OR NEW.shot_number IS NOT OLD.shot_number
      BEGIN SELECT RAISE(ABORT, 'Generation shot and numbers are locked'); END;
    `);
  })();
}
