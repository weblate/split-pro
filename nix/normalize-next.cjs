/*
 * Removes the random values that `next build` embeds in its output, so that the package is
 * reproducible and contains no secrets shared by every installation.
 * Run at build time: node normalize-next.cjs <dist-dir>
 *
 * For preview mode and on-demand revalidation, Next.js compares the `__prerender_bypass` cookie
 * or the `x-prerender-revalidate` header with `previewModeId` using plain `===` (see Next.js
 * api-utils). A blank id would therefore match an empty header. Node exposes header values as
 * latin1 strings, so they never contain characters above U+00FF. Next.js decodes cookie values
 * with decodeURIComponent, which can produce any character except a lone UTF-16 surrogate: it
 * throws on an encoded surrogate half, and the cookie is then ignored. An id that contains a lone
 * surrogate therefore can't be matched by any request, and both features become unreachable.
 * SplitPro uses neither of them.
 *
 * Server Actions encrypt their bound arguments with `encryptionKey`. SplitPro has no Server
 * Actions, and the build fails if any appear. They would need a key generated for each
 * installation and passed in at runtime (NEXT_SERVER_ACTIONS_ENCRYPTION_KEY).
 */
const fs = require('fs');
const path = require('path');

const distDir = process.argv[2];
const UNMATCHABLE_PREVIEW_ID = 'disabled\uD800';

const edit = (relative, change) => {
  const file = path.join(distDir, relative);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
};

const disablePreview = (props) => {
  props.previewModeId = UNMATCHABLE_PREVIEW_ID;
  props.previewModeSigningKey = '';
  props.previewModeEncryptionKey = '';
};
edit('prerender-manifest.json', (manifest) => disablePreview(manifest.preview));
edit('server/preview-props.json', disablePreview);

const actions = edit('server/server-reference-manifest.json', (manifest) => {
  const used = [...Object.keys(manifest.node ?? {}), ...Object.keys(manifest.edge ?? {})];
  if (used.length) {
    console.error(
      `normalize-next: found ${used.length} Server Action(s). They need a per-installation ` +
        'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY at runtime; extend nix/ before packaging them.',
    );
    process.exit(1);
  }
  manifest.encryptionKey = '';
});
/*
 * Next.js records the build machine's CPU count (minus one) as `experimental.cpus` in the config
 * that it embeds in the output. The build uses it for parallelism, but the server does not, so
 * pin it to keep builds on different machines identical.
 */
edit('required-server-files.json', (files) => {
  files.config.experimental.cpus = 1;
});
const serverJs = path.join(distDir, '..', 'server.js');
const server = fs.readFileSync(serverJs, 'utf8');
const pinned = server.replace(/"cpus":\d+/g, '"cpus":1');
if (pinned === server && !server.includes('"cpus":1')) {
  console.error(
    'normalize-next: no "cpus" entry in server.js; check how Next.js embeds its config.',
  );
  process.exit(1);
}
fs.writeFileSync(serverJs, pinned);

// The .js version of the manifest holds the same JSON as a string literal.
fs.writeFileSync(
  path.join(distDir, 'server/server-reference-manifest.js'),
  `self.__RSC_SERVER_MANIFEST=${JSON.stringify(JSON.stringify(actions, null, 2))}`,
);
