// Asserts a built application is servable under the BFF's content security policy
// (TDD-identity-experience-001 §Security Headers): no inline script, no inline style, no event
// handler attribute, and no font or stylesheet inlined as a data: URI. Each would pass in
// development, where Vite serves the page, and be refused in production, where the BFF does.
//
// It also asserts no credential-shaped string reached the bundle: the browser application is
// built with no secret, and a secret found here would be a secret shipped to every browser.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// The application's dist directory, relative to where the check runs: each application's build
// runs it on its own output (`node ../../scripts/check-dist.mjs dist`).
const dist = path.resolve(process.argv[2] ?? 'dist');
const failures = [];

const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
for (const [pattern, reason] of [
  [/<script(?![^>]*\bsrc=)[^>]*>/i, 'an inline <script>'],
  [/<style[\s>]/i, 'an inline <style>'],
  [/\sstyle=/i, 'a style attribute'],
  [/\son[a-z]+=/i, 'an event handler attribute'],
]) {
  if (pattern.test(html)) {
    failures.push(`index.html carries ${reason}`);
  }
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

for (const file of walk(dist)) {
  if (!/\.(js|css|html)$/.test(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const name = path.relative(dist, file);
  if (file.endsWith('.css') && /url\(\s*["']?data:(?!image\/svg\+xml)/i.test(text)) {
    failures.push(`${name} inlines a data: URI the policy refuses`);
  }
  for (const [pattern, reason] of [
    [/client_secret\s*[:=]\s*["'][^"']+["']/i, 'a client secret'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, 'a JSON Web Token'],
  ]) {
    if (pattern.test(text)) {
      failures.push(`${name} contains ${reason}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`dist check failed:\n  ${failures.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`dist check passed: ${walk(dist).length} files\n`);
