export const TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']);
const checks = ['distribution', 'install', 'launch', 'update', 'uninstall', 'isolation', 'recovery'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const version = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);

/** A declared-ready candidate never becomes installable without per-target evidence. */
export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.tools)) throw new Error('Invalid catalog schema');
  const ids = new Set();
  for (const tool of catalog.tools) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(tool?.id ?? '') || ids.has(tool.id)) throw new Error('Invalid or duplicate tool ID');
    ids.add(tool.id);
    if (!text(tool.name) || !text(tool.description) || !tool.targets || typeof tool.targets !== 'object' || Array.isArray(tool.targets)) throw new Error(`Invalid tool: ${tool.id}`);
    for (const [target, entry] of Object.entries(tool.targets)) {
      if (!TARGETS.includes(target) || !['pending', 'verified', 'unsupported'].includes(entry?.status)) throw new Error(`Invalid target: ${tool.id}/${target}`);
      if (!Array.isArray(entry.evidence) || !entry.evidence.every(text)) throw new Error(`Invalid evidence: ${tool.id}/${target}`);
      if (entry.version !== undefined && !version(entry.version)) throw new Error(`Invalid version: ${tool.id}/${target}`);
      if (entry.status === 'verified') {
        if (!version(entry.version) || !entry.evidence.length || !checks.every(check => entry.checks?.[check] === true)) throw new Error(`Incomplete verification: ${tool.id}/${target}`);
        let release;
        try { release = new URL(entry.releaseUrl); } catch { throw new Error('Invalid release URL'); }
        if (release.protocol !== 'https:' || release.username || release.password || release.hash || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error('Invalid release identity');
      } else if (!Array.isArray(entry.blockers) || !entry.blockers.length || !entry.blockers.every(text)) {
        throw new Error(`Missing reason: ${tool.id}/${target}`);
      }
    }
  }
  return catalog;
}

/** Pure metadata projection; does not download, launch, or inspect user installations. */
export function listAvailability(catalog, target) {
  validateCatalog(catalog);
  if (!TARGETS.includes(target)) throw new Error(`Unsupported Toolbox target: ${target}`);
  return catalog.tools.map(tool => {
    const entry = tool.targets[target];
    return {
      id: tool.id,
      name: tool.name,
      target,
      status: entry?.status ?? 'unsupported',
      installable: entry?.status === 'verified',
      version: entry?.version ?? null,
      reasons: entry?.blockers ?? (entry ? [] : ['No compatible package is documented.'])
    };
  });
}
