/** Splits a SQL file into statements, respecting dollar-quoted bodies, strings and comments. */
export function splitStatements(sql) {
  const statements = [];
  let buffer = "";
  let i = 0;
  let dollarTag = null;
  let inSingle = false;

  while (i < sql.length) {
    const char = sql[i];
    const rest = sql.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buffer += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buffer += char;
      i += 1;
      continue;
    }

    if (inSingle) {
      buffer += char;
      if (char === "'") {
        if (sql[i + 1] === "'") {
          buffer += "'";
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (char === "-" && sql[i + 1] === "-") {
      const lineEnd = sql.indexOf("\n", i);
      const stop = lineEnd === -1 ? sql.length : lineEnd;
      buffer += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      buffer += char;
      i += 1;
      continue;
    }

    if (char === "$") {
      const match = /^\$[A-Za-z_0-9]*\$/.exec(rest);
      if (match) {
        dollarTag = match[0];
        buffer += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (char === ";") {
      const trimmed = buffer.trim();
      if (trimmed) statements.push(trimmed);
      buffer = "";
      i += 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
}
