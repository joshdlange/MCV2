import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isUnsafePublicHttpAddress } from './publicHttp';

export function isCatalogReferenceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && (!url.port || ['80', '443'].includes(url.port))
      && !/(^|\.)(drive\.google\.com|docs\.google\.com|googleusercontent\.com)$/.test(host)
      && !host.endsWith('.local') && !host.endsWith('.internal') && host !== 'localhost';
  } catch { return false; }
}

// Reuses the existing public-address policy, pins DNS, validates every redirect,
// and adds a TOTAL deadline (including DNS), not only an idle-socket timeout.
export async function downloadCatalogReference(raw: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('Catalog image download deadline exceeded')), { once: true });
  });
  async function visit(urlString: string, remaining: number): Promise<Buffer> {
    if (!isCatalogReferenceUrl(urlString)) throw new Error('Unsupported catalog reference URL');
    const url = new URL(urlString);
    const records = await dns.lookup(url.hostname, { all: true });
    const ipv4 = records.filter(record => record.family === 4);
    if (!ipv4.length || ipv4.some(record => isUnsafePublicHttpAddress(record.address))) {
      throw new Error('Catalog reference resolves to a private/reserved address');
    }
    if (controller.signal.aborted) throw new Error('Catalog download cancelled');
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, {
        signal: controller.signal, family: 4,
        headers: { Accept: 'image/*', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [{ address: ipv4[0].address, family: 4 }]);
          else callback(null, ipv4[0].address, 4);
        },
      }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy();
          if (!remaining) return reject(new Error('Too many catalog image redirects'));
          visit(new URL(response.headers.location, url).href, remaining - 1).then(resolve, reject);
          return;
        }
        if (status !== 200 || !/^image\/(jpeg|png|webp|gif|avif)(;|$)/i.test(String(response.headers['content-type']))) {
          response.destroy(); reject(new Error(`Catalog image rejected (HTTP ${status} or unsupported raster type)`)); return;
        }
        const maxBytes = 12 * 1024 * 1024;
        if (Number(response.headers['content-length']) > maxBytes) {
          response.destroy(); reject(new Error('Catalog reference exceeds 12 MB')); return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) response.destroy(new Error('Catalog reference exceeds 12 MB'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks)));
      });
      request.on('error', reject);
    });
  }
  try { return await Promise.race([visit(raw, 3), aborted]); } finally { clearTimeout(timer); }
}