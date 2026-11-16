/**
 * Deler SQL-tekst i setninger på semikolon og fjerner kommentarer.
 * Semikolon inne i tekststrenger, anførte navn og $$-blokker deler ikke.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    const comment = /^--[^\n]*/.exec(rest) ?? /^\/\*[\s\S]*?(\*\/|$)/.exec(rest);
    if (comment) { current += ' '; i += comment[0].length; continue; }
    const quoted = /^'(?:[^']|'')*'?/.exec(rest) ?? /^"(?:[^"]|"")*"?/.exec(rest) ?? /^(\$[A-Za-z_]*\$)[\s\S]*?(\1|$)/.exec(rest);
    if (quoted) { current += quoted[0]; i += quoted[0].length; continue; }
    if (sql[i] === ';') { statements.push(current); current = ''; } else current += sql[i];
    i++;
  }
  statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}
