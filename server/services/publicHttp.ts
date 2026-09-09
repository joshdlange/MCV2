import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isUnsafePublicHttpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  // This service intentionally does not support IPv6 so mapped, local,
  // documentation, and future reserved ranges cannot bypass the IPv4 checks.
  return family !== 4;
}

function parsePublicHttpUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Only credential-free HTTP(S) URLs are allowed');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Local network destinations are not allowed');
  }
  if (net.isIP(hostname) && isUnsafePublicHttpAddress(hostname)) {
    throw new Error('Private or reserved destinations are not allowed');
  }
  return parsed;
}

async function resolvePublicTarget(rawUrl: string): Promise<{ url: URL; address: string }> {
  const url = parsePublicHttpUrl(rawUrl);
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  const ipv4Records = records.filter((record) => record.family === 4);
  if (
    !ipv4Records.length ||
    ipv4Records.some((record) => isUnsafePublicHttpAddress(record.address))
  ) {
    throw new Error('Destination did not resolve to an allowed public IPv4 address');
  }
  return { url, address: ipv4Records[0].address };
}

export async function downloadPublicText(
  rawUrl: string,
  redirectsRemaining: number = MAX_REDIRECTS,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string> {
  const target = await resolvePublicTarget(rawUrl);
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<string>((resolve, reject) => {
    const request = transport.request(target.url, {
      method: 'GET',
      autoSelectFamily: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarvelCardVault/1.0; +https://marvelcardvault.com)',
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'identity',
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, target.address, 4);
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const nextUrl = new URL(response.headers.location, target.url).toString();
        downloadPublicText(nextUrl, redirectsRemaining - 1, maxBytes).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }

      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType && !['text/html', 'application/xhtml+xml'].includes(contentType)) {
        response.resume();
        reject(new Error('URL did not return HTML'));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maxBytes) {
        response.resume();
        reject(new Error('HTML response is too large'));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new Error('HTML response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}