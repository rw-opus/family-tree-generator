/**
 * Replays the privilege-granting statements in a SQL script and reports the
 * state they leave behind.
 *
 * The point is drift. `supabase/migrations/` is the authoritative history and
 * is what builds every real database; `supabase/schema.sql` is a generated
 * snapshot, and it is the file the entitlement tests read. Nothing forced the
 * two to agree, so a migration could weaken a policy while every test that
 * reads the snapshot stayed green.
 *
 * Comparing the two texts directly does not work, because a history is not a
 * snapshot: the migrations grant `update` on family_trees and revoke it four
 * migrations later, where the snapshot simply never grants it. So both sides
 * are replayed to a final state and the states are compared instead.
 */

const ALL_TABLE_PRIVILEGES = [
  "select",
  "insert",
  "update",
  "delete",
  "truncate",
  "references",
  "trigger",
];
const ALL_FUNCTION_PRIVILEGES = ["execute"];
const ALL_SCHEMA_PRIVILEGES = ["usage", "create"];

const dollarQuoteAt = (text, index) =>
  text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0] ?? null;

/**
 * Normalises formatting whitespace without changing quoted values. Policy
 * predicates can compare against whitespace-bearing text, so applying a plain
 * `text.replace(/\s+/g, " ")` to a whole statement would make distinct
 * policies appear equal.
 */
const normaliseSqlWhitespace = (text) => {
  let normalised = "";
  let pendingSpace = false;
  let index = 0;

  const appendPendingSpace = () => {
    if (pendingSpace && normalised.length > 0) normalised += " ";
    pendingSpace = false;
  };

  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      pendingSpace = true;
      index += 1;
      continue;
    }

    const dollarTag = dollarQuoteAt(text, index);
    if (dollarTag) {
      const end = text.indexOf(dollarTag, index + dollarTag.length);
      const stop = end === -1 ? text.length : end + dollarTag.length;
      appendPendingSpace();
      normalised += text.slice(index, stop);
      index = stop;
      continue;
    }

    if (character === "'" || character === '"') {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === character && text[cursor + 1] === character) {
          cursor += 2;
          continue;
        }
        if (text[cursor] === character) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      appendPendingSpace();
      normalised += text.slice(index, cursor);
      index = cursor;
      continue;
    }

    appendPendingSpace();
    normalised += character;
    index += 1;
  }

  return normalised.trim();
};

/**
 * Splits a script into statements, skipping the semicolons that sit inside
 * comments, string literals and dollar-quoted function bodies. Every function
 * in this schema is dollar-quoted and full of semicolons, so a naive split on
 * ";" would shred them into nonsense.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end + 1;
      current += " ";
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }

    const dollarTag = dollarQuoteAt(sql, index);
    if (dollarTag) {
      const end = sql.indexOf(dollarTag, index + dollarTag.length);
      const stop = end === -1 ? sql.length : end + dollarTag.length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    const character = sql[index];
    if (character === "'" || character === '"') {
      let cursor = index + 1;
      while (cursor < sql.length) {
        // A doubled quote is an escaped quote, not the end of the literal.
        if (sql[cursor] === character && sql[cursor + 1] === character) {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === character) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      current += sql.slice(index, cursor);
      index = cursor;
      continue;
    }

    if (character === ";") {
      statements.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  statements.push(current);
  return statements.map(normaliseSqlWhitespace).filter(Boolean);
}

const parseRoles = (text) =>
  text
    .split(",")
    .map((role) =>
      role
        .trim()
        .replace(/^group\s+/i, "")
        .toLowerCase(),
    )
    .filter(Boolean);

const parsePrivileges = (text, everything) => {
  const normalised = text
    .trim()
    .toLowerCase()
    .replace(/\s+privileges$/, "");
  if (normalised === "all") return [...everything];
  return normalised
    .split(",")
    .map((privilege) => privilege.trim())
    .filter(Boolean);
};

const GRANT_OR_REVOKE = /^(grant|revoke)\s+(.+?)\s+on\s+(.+?)\s+(to|from)\s+([^\s].*)$/i;
const COLUMN_PRIVILEGE = /\b(?:all(?:\s+privileges)?|select|insert|update|references)\s*\([^)]*\)/i;

const isUnsupportedSecurityStatement = (statement) =>
  /^(?:alter\s+(?:role|user|default\s+privileges)\b)/i.test(statement) ||
  /^(?:create|drop|alter)\s+policy\b/i.test(statement) ||
  /^alter\s+table\b[\s\S]*\b(?:owner\s+to|row\s+level\s+security)\b/i.test(statement);

/**
 * Reads one statement into an event, or returns null if the statement does not
 * touch privileges. Statements that look like privilege statements but cannot
 * be understood are returned as `{ kind: "unparsed" }` rather than dropped:
 * a silently ignored grant is exactly the hole this module exists to close.
 */
export function parsePrivilegeStatement(statement) {
  const rlsMatch = statement.match(
    /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)(?:\s+\*)?\s+(enable|disable|force|no\s+force)\s+row\s+level\s+security$/i,
  );
  if (rlsMatch) {
    const action = rlsMatch[2].toLowerCase().replace(/\s+/g, " ");
    return {
      kind: "row-level-security",
      table: rlsMatch[1].toLowerCase(),
      setting: action === "enable" || action === "disable" ? "enabled" : "forced",
      value: action === "enable" || action === "force",
    };
  }

  const dropPolicy = statement.match(
    /^drop\s+policy\s+(?:if\s+exists\s+)?"?([^"\s]+(?:[^"]*[^"\s])?)"?\s+on\s+([\w."]+)$/i,
  );
  if (dropPolicy) {
    return {
      kind: "drop-policy",
      name: dropPolicy[1],
      table: dropPolicy[2].toLowerCase(),
    };
  }

  const createPolicy = statement.match(
    /^create\s+policy\s+"?([^"]+?)"?\s+on\s+([\w."]+)\s+([\s\S]*)$/i,
  );
  if (createPolicy) {
    return {
      kind: "create-policy",
      name: createPolicy[1],
      table: createPolicy[2].toLowerCase(),
      // The whole tail is kept, so a predicate weakened to `using (true)` shows
      // up as a difference rather than as an identically-named policy.
      definition: normaliseSqlWhitespace(createPolicy[3]),
    };
  }

  if (isUnsupportedSecurityStatement(statement)) return { kind: "unparsed", statement };
  if (!/^(grant|revoke)\b/i.test(statement)) return null;

  const match = statement.match(GRANT_OR_REVOKE);
  if (!match) return { kind: "unparsed", statement };

  const [, verb, privilegeText, targetText, direction, roleText] = match;
  const granting = verb.toLowerCase() === "grant";
  // `grant … to` and `revoke … from`; anything else is a misread.
  if (granting !== (direction.toLowerCase() === "to")) return { kind: "unparsed", statement };
  if (COLUMN_PRIVILEGE.test(privilegeText)) return { kind: "unparsed", statement };

  const target = targetText.trim();
  const functionTarget = target.match(/^function\s+(.+)$/i);
  const schemaTarget = target.match(/^schema\s+(.+)$/i);
  const tableTarget = target.match(/^(?:table\s+)?([\w."]+)$/i);

  if (functionTarget) {
    return {
      kind: "privilege",
      objectKind: "function",
      // Signatures are compared textually, so argument spacing is normalised.
      objects: [
        normaliseSqlWhitespace(functionTarget[1])
          .replace(/\s*,\s*/g, ", ")
          .toLowerCase(),
      ],
      privileges: parsePrivileges(privilegeText, ALL_FUNCTION_PRIVILEGES),
      roles: parseRoles(roleText),
      granting,
    };
  }

  if (schemaTarget) {
    return {
      kind: "privilege",
      objectKind: "schema",
      objects: parseRoles(schemaTarget[1]),
      privileges: parsePrivileges(privilegeText, ALL_SCHEMA_PRIVILEGES),
      roles: parseRoles(roleText),
      granting,
    };
  }

  if (tableTarget) {
    return {
      kind: "privilege",
      objectKind: "table",
      objects: [tableTarget[1].toLowerCase()],
      privileges: parsePrivileges(privilegeText, ALL_TABLE_PRIVILEGES),
      roles: parseRoles(roleText),
      granting,
    };
  }

  return { kind: "unparsed", statement };
}

/**
 * Replays a script and returns the privilege state it ends in, together with
 * any privilege statement that could not be read.
 */
export function replayPrivileges(sql) {
  const privileges = new Map();
  const policies = new Map();
  const rowLevelSecurity = new Map();
  const unparsed = [];

  for (const statement of splitStatements(sql)) {
    const event = parsePrivilegeStatement(statement);
    if (!event) continue;

    if (event.kind === "unparsed") {
      unparsed.push(event.statement);
      continue;
    }

    if (event.kind === "row-level-security") {
      const current = rowLevelSecurity.get(event.table) ?? {};
      rowLevelSecurity.set(event.table, { ...current, [event.setting]: event.value });
      continue;
    }

    if (event.kind === "drop-policy") {
      policies.delete(`${event.table}::${event.name}`);
      continue;
    }

    if (event.kind === "create-policy") {
      policies.set(`${event.table}::${event.name}`, event.definition);
      continue;
    }

    for (const object of event.objects) {
      for (const role of event.roles) {
        const key = `${event.objectKind} ${object} → ${role}`;
        // Naming a role at all is recorded, so dropping a `revoke all` from one
        // side shows up even though the effective privilege set is unchanged.
        const held = privileges.get(key) ?? new Set();
        event.privileges.forEach((privilege) =>
          event.granting ? held.add(privilege) : held.delete(privilege),
        );
        privileges.set(key, held);
      }
    }
  }

  return { privileges, policies, rowLevelSecurity, unparsed };
}

/** Renders a replayed state as sorted lines, so a diff reads as English. */
export function describePrivilegeState(state) {
  const lines = [];

  for (const [key, held] of state.privileges) {
    lines.push(`${key}: ${[...held].sort().join(", ") || "(none)"}`);
  }
  for (const [key, definition] of state.policies) {
    lines.push(`policy ${key}: ${definition}`);
  }
  for (const [table, settings] of state.rowLevelSecurity) {
    const description = [];
    if (settings.enabled !== undefined) {
      description.push(settings.enabled ? "enabled" : "DISABLED");
    }
    if (settings.forced !== undefined) {
      description.push(settings.forced ? "FORCED" : "not forced");
    }
    lines.push(`row level security ${table}: ${description.join("; ")}`);
  }

  return lines.sort();
}
