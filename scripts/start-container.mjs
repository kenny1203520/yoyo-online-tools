// Validate deployment configuration before starting the standalone server.
const input = process.env.SITE_URL;
try {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin');
  if (process.env.SITE_INDEXABLE && !['true', 'false'].includes(process.env.SITE_INDEXABLE)) throw new Error('Invalid SITE_INDEXABLE');
} catch {
  console.error('Set SITE_URL to an absolute http(s) origin without credentials, subpaths, query or fragment (e.g. https://tools.example.com). SITE_INDEXABLE must be true or false.');
  process.exit(1);
}
process.env.HOSTNAME = '0.0.0.0';
process.env.PORT ||= '3000';
// Import in the same process so SIGTERM reaches Next directly.
await import('../server.js');
