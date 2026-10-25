// The file name a browser download gets — always with its extension, ASCII-safe.
//
// 2026-10-25 (Tasha): a Studio export landed on disk as "download", no extension. The name came
// from the response's filename* only and carried "—"; any miss fell back to an attribute some
// browsers ignore. This reads filename* then filename, falls back to the person's name, keeps
// the characters every file system and browser accepts, and always ends in ".<ext>".

/**
 * @param {string} contentDisposition the response's Content-Disposition header
 * @param {{ ext: string, fallback?: string }} opts
 * @returns {string}
 */
export function downloadName(contentDisposition, { ext, fallback = 'Resume' } = {}) {
  const cd = String(contentDisposition || '');
  let name = '';
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { name = ''; } }
  if (!name) { const plain = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i); if (plain) name = (plain[1] || plain[2] || '').trim(); }
  if (!name) name = String(fallback || 'Resume');
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  name = name.replace(/[—–]/g, '-').replace(/[^\w .,'()&+-]/g, '').replace(/\s+/g, ' ').trim() || 'Resume';
  if (e && !name.toLowerCase().endsWith(`.${e}`)) name = `${name.replace(/\.+$/, '')}.${e}`;
  return name;
}
