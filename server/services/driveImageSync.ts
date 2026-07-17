/**
 * Drive Image Sync v1 — DRY-RUN ONLY.
 *
 * Scans the Google Drive folder hierarchy (read-only scope), maps folders to
 * existing MCV card records, and produces a detailed report. It never uploads
 * to Cloudinary, never modifies card records, and never downloads image bytes.
 *
 * Expected hierarchy:
 *   Root → Main Set Folder → Subset Folder → Card Number Folder → image files
 */
import crypto from 'crypto';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { inArray } from 'drizzle-orm';

// ---------- Google Drive auth (service account, read-only) ----------

interface ServiceAccount { client_email: string; private_key: string; }

function loadServiceAccount(): ServiceAccount {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
  }
  if (!raw) throw new Error('Google service account JSON is not configured (GOOGLE_SERVICE_ACCOUNT_JSON)');
  let sa: any;
  try { sa = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON is missing client_email/private_key');
  return sa;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`Google OAuth token request failed (${res.status}): ${body.error_description || body.error || 'unknown'}`);
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

// ---------- Drive listing ----------

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function driveFetch(url: string): Promise<any> {
  const token = await getAccessToken();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const body: any = await res.json();
    if (!res.ok) throw new Error(`Drive API error ${res.status}: ${body.error?.message || 'unknown'}`);
    return body;
  }
  throw new Error('Drive API error: rate limited / server errors after 3 attempts');
}

async function listChildren(folderId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const body = await driveFetch(url);
    items.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function getFolderMeta(folderId: string): Promise<DriveItem> {
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType&supportsAllDrives=true`;
  return driveFetch(url);
}

// ---------- Matching helpers ----------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function normalizeCardNumber(s: string): string {
  // "Card 53", "#53", "053" style folder names → strict-comparable form
  const cleaned = s.trim().replace(/^card\s+/i, '').replace(/^#/, '').trim();
  const noLeadingZeros = cleaned.replace(/^0+(?=\d)/, '');
  return noLeadingZeros.toLowerCase();
}

type ImageSide = 'front' | 'back' | 'ambiguous';

function inferSide(fileName: string): ImageSide {
  const base = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  if (/\b(front|obverse)\b|front/i.test(base)) return 'front';
  if (/\b(back|reverse)\b|back/i.test(base)) return 'back';
  // trailing 1/2 (e.g. "IMG_1", "53-1", "53 (2)")
  const m = base.match(/(?:^|[^0-9])([12])(?:\)|\s*)$/);
  if (m) return m[1] === '1' ? 'front' : 'back';
  return 'ambiguous';
}

// ---------- Report types ----------

interface ImageFileReport {
  driveFileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime?: string;
  parentPath: string;
  inferredMainSet: string;
  inferredSubset: string;
  inferredCardNumber: string;
  inferredSide: ImageSide;
}

interface CardFolderReport {
  path: string;
  driveFolderId: string;
  mainSet: string;
  subset: string;
  cardNumber: string;
  imageCount: number;
  nonImageCount: number;
  hasNestedFolders: boolean;
  frontBackStatus: 'ok' | 'ambiguous' | 'missing_one' | 'none' | 'too_many';
  match: {
    status: 'matched' | 'unmatched_main_set' | 'unmatched_subset' | 'unmatched_card_number' | 'duplicate_card_match';
    cardId?: number;
    cardName?: string;
    setId?: number;
    setName?: string;
    candidateCardIds?: number[];
    cardAlreadyHasFrontImage?: boolean;
    cardAlreadyHasBackImage?: boolean;
  };
}

interface UnexpectedStructure { path: string; driveFolderId: string; reason: string; children?: string[]; }

export interface DriveDryRunReport {
  ranAt: string;
  durationMs: number;
  rootFolder: { id: string; name: string };
  truncated: boolean;
  summary: {
    totalFirstLevelFolders: number;
    totalFoldersScanned: number;
    totalCardFoldersFound: number;
    totalImageFilesFound: number;
    matchedCardFolders: number;
    unmatchedCardFolders: number;
    ambiguousImagePairs: number;
    foldersWithUnexpectedStructure: number;
    cardFoldersNotExactlyTwoImages: number;
    duplicateDriveFileIds: number;
    duplicateCardMatches: number;
  };
  firstLevelFolders: { name: string; id: string; classification: 'main_set' | 'container_or_unknown' }[];
  matchedSamples: CardFolderReport[];
  unmatchedSamples: CardFolderReport[];
  ambiguousFolders: CardFolderReport[];
  unexpectedStructures: UnexpectedStructure[];
  containerReports: { name: string; id: string; childFolders: string[]; childFiles: number }[];
  duplicateDriveFileIdList: { driveFileId: string; paths: string[] }[];
  duplicateCardMatchList: { cardId: number; cardName: string; paths: string[] }[];
  allCardFolders: CardFolderReport[];
  allImageFiles: ImageFileReport[];
}

// Safety cap on Drive folder listings per run so a runaway hierarchy can't hang the server.
const MAX_FOLDER_LISTINGS = 6000;

let lastReport: DriveDryRunReport | null = null;
let running = false;

export function getLastDriveDryRunReport(): DriveDryRunReport | null {
  return lastReport;
}

export function isDriveDryRunRunning(): boolean {
  return running;
}

// ---------- Main dry-run ----------

export async function runDriveImageSyncDryRun(): Promise<DriveDryRunReport> {
  if (running) throw new Error('A Drive dry-run is already in progress');
  running = true;
  const startedAt = Date.now();
  console.log('[DriveSync] Dry-run started (read-only; no DB writes, no Cloudinary)');
  try {
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!rootId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');

    // DB reference data (read-only)
    const allMainSets = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
    const allCardSets = await db.select({ id: cardSets.id, name: cardSets.name, mainSetId: cardSets.mainSetId }).from(cardSets);
    const mainSetByName = new Map<string, { id: number; name: string }>();
    for (const ms of allMainSets) mainSetByName.set(normalize(ms.name), ms);
    const cardSetsByMainSet = new Map<number, { id: number; name: string }[]>();
    for (const cs of allCardSets) {
      if (cs.mainSetId == null) continue;
      const arr = cardSetsByMainSet.get(cs.mainSetId) || [];
      arr.push({ id: cs.id, name: cs.name });
      cardSetsByMainSet.set(cs.mainSetId, arr);
    }

    let folderListings = 0;
    let truncated = false;
    const listCounted = async (id: string) => {
      if (folderListings >= MAX_FOLDER_LISTINGS) { truncated = true; return [] as DriveItem[]; }
      folderListings++;
      if (folderListings % 100 === 0) {
        console.log(`[DriveSync] Progress: ${folderListings} folder listings so far...`);
      }
      return listChildren(id);
    };

    const rootMeta = await getFolderMeta(rootId);
    const firstLevel = (await listCounted(rootId)).filter(i => i.mimeType === FOLDER_MIME);

    const report: DriveDryRunReport = {
      ranAt: new Date().toISOString(),
      durationMs: 0,
      rootFolder: { id: rootMeta.id, name: rootMeta.name.trim() },
      truncated: false,
      summary: {
        totalFirstLevelFolders: firstLevel.length,
        totalFoldersScanned: 0,
        totalCardFoldersFound: 0,
        totalImageFilesFound: 0,
        matchedCardFolders: 0,
        unmatchedCardFolders: 0,
        ambiguousImagePairs: 0,
        foldersWithUnexpectedStructure: 0,
        cardFoldersNotExactlyTwoImages: 0,
        duplicateDriveFileIds: 0,
        duplicateCardMatches: 0,
      },
      firstLevelFolders: [],
      matchedSamples: [],
      unmatchedSamples: [],
      ambiguousFolders: [],
      unexpectedStructures: [],
      containerReports: [],
      duplicateDriveFileIdList: [],
      duplicateCardMatchList: [],
      allCardFolders: [],
      allImageFiles: [],
    };

    const fileIdPaths = new Map<string, string[]>();
    interface PendingCardFolder {
      folder: DriveItem;
      path: string;
      mainSetName: string;
      subsetName: string;
      mainSetId: number | null;
      cardSetId: number | null;
      cardSetName: string | null;
      children: DriveItem[];
    }
    const pendingCardFolders: PendingCardFolder[] = [];

    for (const top of firstLevel) {
      const topName = top.name.trim();
      const matchedMainSet = mainSetByName.get(normalize(topName)) || null;
      const topChildren = await listCounted(top.id);
      report.summary.totalFoldersScanned++;
      const topChildFolders = topChildren.filter(c => c.mimeType === FOLDER_MIME);
      const topChildFiles = topChildren.filter(c => c.mimeType !== FOLDER_MIME);

      // Heuristic: a main-set folder should contain subset folders whose children are card-number folders.
      // If the folder doesn't match a known main set AND its structure doesn't look like the expected
      // hierarchy, classify as container/unknown and report one level of its children without deep-scanning.
      let looksLikeHierarchy = false;
      if (topChildFolders.length > 0) {
        const probe = await listCounted(topChildFolders[0].id);
        report.summary.totalFoldersScanned++;
        const probeFolders = probe.filter(c => c.mimeType === FOLDER_MIME);
        looksLikeHierarchy = probeFolders.length > 0;
      }

      // Wrapper/container detection: a first-level folder that doesn't match a
      // main set but whose CHILD folders look like set names (match main sets or
      // resemble the top-level set folders) is a container, even if it has depth.
      const childrenLookLikeSets = topChildFolders.some(f => mainSetByName.has(normalize(f.name.trim())));

      if (!matchedMainSet && (childrenLookLikeSets || !looksLikeHierarchy)) {
        report.firstLevelFolders.push({ name: topName, id: top.id, classification: 'container_or_unknown' });
        report.containerReports.push({
          name: topName,
          id: top.id,
          childFolders: topChildFolders.map(f => f.name),
          childFiles: topChildFiles.length,
        });
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path: topName,
          driveFolderId: top.id,
          reason: matchedMainSet
            ? 'Matches a main set but contains no subset folders'
            : 'Does not match any main set and does not follow the Main Set → Subset → Card structure',
          children: topChildFolders.map(f => f.name).slice(0, 50),
        });
        continue;
      }

      report.firstLevelFolders.push({ name: topName, id: top.id, classification: 'main_set' });
      if (topChildFiles.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path: topName,
          driveFolderId: top.id,
          reason: `Main set folder contains ${topChildFiles.length} loose file(s) at subset level`,
        });
      }

      for (const subsetFolder of topChildFolders) {
        const subsetName = subsetFolder.name.trim();
        const path = `${topName} / ${subsetName}`;
        const subsetChildren = await listCounted(subsetFolder.id);
        report.summary.totalFoldersScanned++;
        const cardFolders = subsetChildren.filter(c => c.mimeType === FOLDER_MIME);
        const looseFiles = subsetChildren.filter(c => c.mimeType !== FOLDER_MIME);
        if (looseFiles.length > 0) {
          report.summary.foldersWithUnexpectedStructure++;
          report.unexpectedStructures.push({
            path,
            driveFolderId: subsetFolder.id,
            reason: `Subset folder contains ${looseFiles.length} loose file(s) at card-number level`,
          });
        }

        // Strict subset match (only within the matched main set)
        let cardSetMatch: { id: number; name: string } | null = null;
        if (matchedMainSet) {
          const candidates = cardSetsByMainSet.get(matchedMainSet.id) || [];
          const normSubset = normalize(subsetName);
          cardSetMatch = candidates.find(c => normalize(c.name) === normSubset)
            || candidates.find(c => normalize(c.name) === normalize(`${topName} ${subsetName}`))
            || null;
        }

        // List card folders with limited concurrency (Drive quota is generous;
        // sequential listing of thousands of folders would take an hour).
        const CONCURRENCY = 8;
        for (let i = 0; i < cardFolders.length; i += CONCURRENCY) {
          const batch = cardFolders.slice(i, i + CONCURRENCY);
          const results = await Promise.all(batch.map(async (cardFolder) => ({
            cardFolder,
            children: await listCounted(cardFolder.id),
          })));
          for (const { cardFolder, children } of results) {
            report.summary.totalFoldersScanned++;
            pendingCardFolders.push({
              folder: cardFolder,
              path: `${path} / ${cardFolder.name.trim()}`,
              mainSetName: topName,
              subsetName,
              mainSetId: matchedMainSet?.id ?? null,
              cardSetId: cardSetMatch?.id ?? null,
              cardSetName: cardSetMatch?.name ?? null,
              children,
            });
          }
        }
      }
    }

    // Load card rows for all matched sets in one query (read-only)
    const matchedSetIds = Array.from(new Set(pendingCardFolders.map(p => p.cardSetId).filter((x): x is number => x != null)));
    const cardRows = matchedSetIds.length
      ? await db.select({
          id: cards.id, setId: cards.setId, cardNumber: cards.cardNumber, name: cards.name,
          frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl,
        }).from(cards).where(inArray(cards.setId, matchedSetIds))
      : [];
    const cardsBySetAndNumber = new Map<string, typeof cardRows>();
    for (const c of cardRows) {
      const key = `${c.setId}|${normalizeCardNumber(c.cardNumber)}`;
      const arr = cardsBySetAndNumber.get(key) || [];
      arr.push(c);
      cardsBySetAndNumber.set(key, arr);
    }

    const cardMatchPaths = new Map<number, { name: string; paths: string[] }>();

    for (const pending of pendingCardFolders) {
      const { folder, path, children } = pending;
      const cardNumberRaw = folder.name.trim();
      const nestedFolders = children.filter(c => c.mimeType === FOLDER_MIME);
      const files = children.filter(c => c.mimeType !== FOLDER_MIME);
      const imageFiles = files.filter(f => f.mimeType.startsWith('image/'));
      const nonImageFiles = files.filter(f => !f.mimeType.startsWith('image/'));

      report.summary.totalCardFoldersFound++;
      report.summary.totalImageFilesFound += imageFiles.length;

      if (nestedFolders.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path, driveFolderId: folder.id,
          reason: `Card folder contains ${nestedFolders.length} nested folder(s) (unexpected depth)`,
          children: nestedFolders.map(f => f.name).slice(0, 20),
        });
      }
      if (nonImageFiles.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path, driveFolderId: folder.id,
          reason: `Card folder contains ${nonImageFiles.length} non-image file(s): ${nonImageFiles.map(f => f.name).slice(0, 5).join(', ')}`,
        });
      }

      // Front/back inference
      const sides = imageFiles.map(f => inferSide(f.name));
      let frontBackStatus: CardFolderReport['frontBackStatus'];
      if (imageFiles.length === 0) frontBackStatus = 'none';
      else if (imageFiles.length === 1) frontBackStatus = 'missing_one';
      else if (imageFiles.length > 2) frontBackStatus = 'too_many';
      else {
        const hasFront = sides.includes('front');
        const hasBack = sides.includes('back');
        frontBackStatus = hasFront && hasBack ? 'ok' : 'ambiguous';
      }
      if (frontBackStatus === 'ambiguous') report.summary.ambiguousImagePairs++;
      if (imageFiles.length !== 2) report.summary.cardFoldersNotExactlyTwoImages++;

      // Strict card match
      let match: CardFolderReport['match'];
      if (pending.mainSetId == null) {
        match = { status: 'unmatched_main_set' };
      } else if (pending.cardSetId == null) {
        match = { status: 'unmatched_subset' };
      } else {
        const key = `${pending.cardSetId}|${normalizeCardNumber(cardNumberRaw)}`;
        const found = cardsBySetAndNumber.get(key) || [];
        if (found.length === 0) {
          match = { status: 'unmatched_card_number', setId: pending.cardSetId, setName: pending.cardSetName! };
        } else if (found.length > 1) {
          match = {
            status: 'duplicate_card_match',
            setId: pending.cardSetId, setName: pending.cardSetName!,
            candidateCardIds: found.map(c => c.id),
          };
          report.summary.duplicateCardMatches++;
        } else {
          const c = found[0];
          match = {
            status: 'matched',
            cardId: c.id, cardName: c.name, setId: pending.cardSetId, setName: pending.cardSetName!,
            cardAlreadyHasFrontImage: !!c.frontImageUrl, cardAlreadyHasBackImage: !!c.backImageUrl,
          };
          const entry = cardMatchPaths.get(c.id) || { name: c.name, paths: [] };
          entry.paths.push(path);
          cardMatchPaths.set(c.id, entry);
        }
      }

      const folderReport: CardFolderReport = {
        path, driveFolderId: folder.id,
        mainSet: pending.mainSetName, subset: pending.subsetName, cardNumber: cardNumberRaw,
        imageCount: imageFiles.length, nonImageCount: nonImageFiles.length,
        hasNestedFolders: nestedFolders.length > 0,
        frontBackStatus, match,
      };
      report.allCardFolders.push(folderReport);
      if (match.status === 'matched') report.summary.matchedCardFolders++;
      else report.summary.unmatchedCardFolders++;

      for (const f of imageFiles) {
        report.allImageFiles.push({
          driveFileId: f.id, fileName: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
          parentPath: path,
          inferredMainSet: pending.mainSetName, inferredSubset: pending.subsetName,
          inferredCardNumber: cardNumberRaw, inferredSide: inferSide(f.name),
        });
        const paths = fileIdPaths.get(f.id) || [];
        paths.push(`${path} / ${f.name}`);
        fileIdPaths.set(f.id, paths);
      }
    }

    // Duplicates
    for (const [fileId, paths] of Array.from(fileIdPaths.entries())) {
      if (paths.length > 1) {
        report.summary.duplicateDriveFileIds++;
        report.duplicateDriveFileIdList.push({ driveFileId: fileId, paths });
      }
    }
    for (const [cardId, entry] of Array.from(cardMatchPaths.entries())) {
      if (entry.paths.length > 1) {
        report.summary.duplicateCardMatches++;
        report.duplicateCardMatchList.push({ cardId, cardName: entry.name, paths: entry.paths });
      }
    }

    // Samples
    report.matchedSamples = report.allCardFolders.filter(f => f.match.status === 'matched').slice(0, 10);
    report.unmatchedSamples = report.allCardFolders.filter(f => f.match.status !== 'matched').slice(0, 10);
    report.ambiguousFolders = report.allCardFolders.filter(f => f.frontBackStatus === 'ambiguous').slice(0, 25);

    report.truncated = truncated;
    report.durationMs = Date.now() - startedAt;
    lastReport = report;
    console.log(`[DriveSync] Dry-run complete in ${report.durationMs}ms: ${report.summary.totalCardFoldersFound} card folders, ${report.summary.matchedCardFolders} matched, ${report.summary.unmatchedCardFolders} unmatched, ${report.summary.totalImageFilesFound} images (no data was modified)`);
    return report;
  } finally {
    running = false;
  }
}

// ---------- Cleanup report (derived from a completed dry-run; read-only) ----------
// Builds admin-facing cleanup tables so folder/database mismatches can be fixed
// BEFORE any real import. Never modifies Drive, DB, or Cloudinary.

interface CleanupCandidate { name: string; score: number; }

export interface DriveCleanupReport {
  generatedAt: string;
  sourceRanAt: string;
  unmatched: Array<{
    mainSetFolder: string; subsetFolder: string; cardNumberFolder: string;
    imageCount: number; reason: string; candidates: string[];
  }>;
  ambiguousFrontBack: Array<{
    folderPath: string; image1: string; image2: string;
    sortOrder: string; proposedFront: string; proposedBack: string; proposalBasis: string;
  }>;
  wrongImageCount: Array<{
    folderPath: string; imageCount: number; nonImageCount: number; matchStatus: string;
  }>;
  structureOddities: Array<{ path: string; reason: string; children?: string[] }>;
  counts: { unmatched: number; ambiguousFrontBack: number; wrongImageCount: number; structureOddities: number };
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(t => t.length > 1));
}

function similarity(a: string, b: string): number {
  const ta = tokenSet(a); const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

function topCandidates(target: string, pool: string[], max = 3, minScore = 0.5): string[] {
  const scored: CleanupCandidate[] = pool
    .map(name => ({ name, score: similarity(target, name) }))
    .filter(c => c.score >= minScore)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, max).map(c => `${c.name} (${Math.round(c.score * 100)}% similar)`);
}

const REASON_LABELS: Record<string, string> = {
  unmatched_main_set: 'Main set folder does not match any main set in the database',
  unmatched_subset: 'Main set matched, but subset folder name does not match any of its sets',
  unmatched_card_number: 'Set matched, but card number not found in that set (check O vs 0 typos)',
};

export async function buildDriveCleanupReport(): Promise<DriveCleanupReport> {
  let source = lastReport;
  if (!source) {
    const fs = await import('fs');
    if (fs.existsSync('/tmp/drive_dryrun_report.json')) {
      source = JSON.parse(fs.readFileSync('/tmp/drive_dryrun_report.json', 'utf8'));
    }
  }
  if (!source) throw new Error('No dry-run report available. Run the dry-run first.');

  // Read-only reference data for candidate suggestions (suggestions only — never auto-mapped)
  const allMainSets = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
  const allCardSets = await db.select({ id: cardSets.id, name: cardSets.name, mainSetId: cardSets.mainSetId }).from(cardSets);
  const mainSetNameById = new Map(allMainSets.map(m => [m.id, m.name]));
  const mainSetIdByNorm = new Map(allMainSets.map(m => [normalize(m.name), m.id]));

  const report: DriveCleanupReport = {
    generatedAt: new Date().toISOString(),
    sourceRanAt: source.ranAt,
    unmatched: [], ambiguousFrontBack: [], wrongImageCount: [],
    structureOddities: source.unexpectedStructures.map(u => ({ path: u.path, reason: u.reason, children: u.children })),
    counts: { unmatched: 0, ambiguousFrontBack: 0, wrongImageCount: 0, structureOddities: source.unexpectedStructures.length },
  };

  // Group image files by folder for the ambiguous table
  const filesByFolder = new Map<string, Array<{ fileName: string }>>();
  for (const f of source.allImageFiles) {
    const arr = filesByFolder.get(f.parentPath) || [];
    arr.push({ fileName: f.fileName });
    filesByFolder.set(f.parentPath, arr);
  }

  for (const folder of source.allCardFolders) {
    const status = folder.match.status;
    if (status !== 'matched') {
      let candidates: string[] = [];
      if (status === 'unmatched_main_set') {
        // Main set folder didn't match: suggest similar MAIN SET names, plus any
        // card sets anywhere in the DB whose name matches the subset folder.
        const mainCands = topCandidates(folder.mainSet, allMainSets.map(m => m.name))
          .map(c => `main set: ${c}`);
        const subsetCands = topCandidates(folder.subset, allCardSets.map(s => s.name))
          .map(c => `set (any main set): ${c}`);
        candidates = [...mainCands, ...subsetCands];
      } else if (status === 'unmatched_subset') {
        const mainId = mainSetIdByNorm.get(normalize(folder.mainSet));
        const pool = allCardSets.filter(s => s.mainSetId === mainId).map(s => s.name);
        candidates = topCandidates(folder.subset, pool);
        if (candidates.length === 0) candidates = topCandidates(folder.subset, allCardSets.map(s => s.name));
      }
      report.unmatched.push({
        mainSetFolder: folder.mainSet,
        subsetFolder: folder.subset,
        cardNumberFolder: folder.cardNumber,
        imageCount: folder.imageCount,
        reason: REASON_LABELS[status] || status,
        candidates,
      });
    }
    if (folder.frontBackStatus === 'ambiguous') {
      const files = (filesByFolder.get(folder.path) || []).map(f => f.fileName).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      // Prefer explicit filename markers: if exactly one file says front (or back),
      // propose based on that; only fall back to sort order when neither helps.
      let proposedFront = files[0] || '';
      let proposedBack = files[1] || '';
      let proposalBasis = 'sort order (no filename markers)';
      if (files.length === 2) {
        const sides = files.map(f => inferSide(f));
        if (sides[0] === 'front' && sides[1] !== 'front') {
          proposedFront = files[0]; proposedBack = files[1]; proposalBasis = `"${files[0]}" is marked front`;
        } else if (sides[1] === 'front' && sides[0] !== 'front') {
          proposedFront = files[1]; proposedBack = files[0]; proposalBasis = `"${files[1]}" is marked front`;
        } else if (sides[0] === 'back' && sides[1] !== 'back') {
          proposedBack = files[0]; proposedFront = files[1]; proposalBasis = `"${files[0]}" is marked back`;
        } else if (sides[1] === 'back' && sides[0] !== 'back') {
          proposedBack = files[1]; proposedFront = files[0]; proposalBasis = `"${files[1]}" is marked back`;
        }
      }
      report.ambiguousFrontBack.push({
        folderPath: folder.path,
        image1: files[0] || '',
        image2: files[1] || '',
        sortOrder: 'alphabetical (numeric-aware)',
        proposedFront,
        proposedBack,
        proposalBasis,
      });
    }
    if (folder.imageCount !== 2) {
      report.wrongImageCount.push({
        folderPath: folder.path,
        imageCount: folder.imageCount,
        nonImageCount: folder.nonImageCount,
        matchStatus: status === 'matched' ? 'matched' : 'unmatched',
      });
    }
  }

  report.counts.unmatched = report.unmatched.length;
  report.counts.ambiguousFrontBack = report.ambiguousFrontBack.length;
  report.counts.wrongImageCount = report.wrongImageCount.length;
  return report;
}

// ---------- Drive Image Sync v2 — REAL IMPORT (admin-only, explicit confirmation) ----------
// Uploads ONLY clean, high-confidence matched images to Cloudinary and updates
// the matched card records. Everything uncertain is skipped and reported.
// Never modifies Drive, never creates cards, never touches user collections.

import { driveImageImports } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { cloudinary } from '../cloudinary';

const IMPORT_FOLDER = 'marvel-cards/drive-sync';
const IMPORT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMPORT_DOWNLOAD_TIMEOUT_MS = 30_000;
const IMPORT_UPLOAD_TIMEOUT_MS = 60_000;
const IMPORT_DELAY_MS = 400; // pause between folders so the server stays responsive
const IMPORT_LOCK_KEY = 'drive-image-import';

export interface DriveImportReport {
  batchId: string;
  ranAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
  options: { maxFolders: number | null; overwrite: boolean };
  fatalError?: string;
  summary: {
    eligibleFolders: number;
    uploadedImages: number;
    updatedCardRecords: number;
    skippedExistingImages: number;
    skippedAlreadyImported: number;
    skippedUnmatchedFolders: number;
    skippedWrongImageCount: number;
    skippedStructureOddities: number;
    skippedUnresolvedFrontBack: number;
    skippedDuplicateDriveFileIds: number;
    skippedDuplicateCardTargets: number;
    failedCloudinaryUploads: number;
    failedDatabaseUpdates: number;
    foldersProcessed: number;
    foldersRemainingEligible: number;
  };
  uploaded: Array<{ folderPath: string; cardId: number; cardName: string; side: string; fileName: string; cloudinaryUrl: string }>;
  skippedExisting: Array<{ folderPath: string; cardId: number; side: string }>;
  failures: Array<{ folderPath: string; cardId: number | null; side: string | null; fileName: string; stage: 'cloudinary_upload' | 'db_update' | 'download'; error: string }>;
}

let importRunning = false;
let lastImportReport: DriveImportReport | null = null;

export function getLastDriveImportReport(): DriveImportReport | null {
  return lastImportReport;
}

export function isDriveImportRunning(): boolean {
  return importRunning;
}

async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal as any },
    );
    if (!res.ok) throw new Error(`Drive download failed: HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error('Empty file');
    if (buffer.length > IMPORT_MAX_IMAGE_BYTES) throw new Error(`Image too large: ${buffer.length} bytes`);
    return { buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Approved front/back rule: with exactly two images, a file clearly marked
 * FRONT (or BACK) wins its side, and the unmarked paired file is the opposite
 * side. Sort order alone is NOT used.
 */
function resolveFrontBack(files: DriveItem[]): { front: DriveItem; back: DriveItem } | null {
  if (files.length !== 2) return null;
  const [a, b] = files;
  const sa = inferSide(a.name);
  const sb = inferSide(b.name);
  if (sa === 'front' && sb === 'back') return { front: a, back: b };
  if (sa === 'back' && sb === 'front') return { front: b, back: a };
  if (sa === 'front' && sb === 'ambiguous') return { front: a, back: b };
  if (sb === 'front' && sa === 'ambiguous') return { front: b, back: a };
  if (sa === 'back' && sb === 'ambiguous') return { front: b, back: a };
  if (sb === 'back' && sa === 'ambiguous') return { front: a, back: b };
  return null; // both ambiguous or both claim the same side → skip
}

export async function runDriveImageImport(options: {
  maxFolders?: number | null;
  overwrite?: boolean;
} = {}): Promise<DriveImportReport> {
  if (importRunning) throw new Error('A Drive image import is already in progress');
  if (running) throw new Error('A Drive dry-run is in progress — wait for it to finish');
  importRunning = true;
  const maxFolders = options.maxFolders ?? null;
  const overwrite = options.overwrite === true; // disabled by default
  const batchId = crypto.randomUUID();
  const startedAt = Date.now();

  const report: DriveImportReport = {
    batchId,
    ranAt: new Date().toISOString(),
    status: 'running',
    options: { maxFolders, overwrite },
    summary: {
      eligibleFolders: 0, uploadedImages: 0, updatedCardRecords: 0,
      skippedExistingImages: 0, skippedAlreadyImported: 0,
      skippedUnmatchedFolders: 0, skippedWrongImageCount: 0,
      skippedStructureOddities: 0, skippedUnresolvedFrontBack: 0,
      skippedDuplicateDriveFileIds: 0, skippedDuplicateCardTargets: 0,
      failedCloudinaryUploads: 0, failedDatabaseUpdates: 0,
      foldersProcessed: 0, foldersRemainingEligible: 0,
    },
    uploaded: [], skippedExisting: [], failures: [],
  };
  lastImportReport = report;

  const { sql } = await import('drizzle-orm');
  let lockAcquired = false;
  try {
    const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(hashtext(${IMPORT_LOCK_KEY})) AS locked`);
    lockAcquired = Boolean((lockResult.rows[0] as any)?.locked);
    if (!lockAcquired) throw new Error('Another instance is running the Drive import');

    console.log(`[DriveImport] Batch ${batchId} started (maxFolders=${maxFolders ?? 'all'}, overwrite=${overwrite})`);

    // Always run a FRESH read-only scan so eligibility reflects the current
    // Drive structure and current card data — never a stale report.
    const scan = await runDriveImageSyncDryRun();

    // Sets of paths/ids that must never import
    const duplicateFileIds = new Set(scan.duplicateDriveFileIdList.map(d => d.driveFileId));
    const duplicateCardIds = new Set(scan.duplicateCardMatchList.map(d => d.cardId));
    const oddityPaths = new Set(scan.unexpectedStructures.map(u => u.path));

    // Prior successful imports (idempotency ledger): fileId → modifiedTime
    const priorRows = await db
      .select({
        driveFileId: driveImageImports.driveFileId,
        driveModifiedTime: driveImageImports.driveModifiedTime,
      })
      .from(driveImageImports)
      .where(eq(driveImageImports.status, 'uploaded'));
    const priorByFileId = new Map(priorRows.map(r => [r.driveFileId, r.driveModifiedTime]));

    // Image file details per folder (need Drive file ids + modifiedTime)
    const filesByFolder = new Map<string, ImageFileReport[]>();
    for (const f of scan.allImageFiles) {
      const arr = filesByFolder.get(f.parentPath) || [];
      arr.push(f);
      filesByFolder.set(f.parentPath, arr);
    }

    // Current card image state for matched cards
    const matchedCardIds = Array.from(new Set(
      scan.allCardFolders.filter(f => f.match.status === 'matched' && f.match.cardId != null).map(f => f.match.cardId!)
    ));
    const cardRows = matchedCardIds.length
      ? await db.select({ id: cards.id, name: cards.name, frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl })
          .from(cards).where(inArray(cards.id, matchedCardIds))
      : [];
    const cardById = new Map(cardRows.map(c => [c.id, c]));

    // Build the eligible list with every exclusion counted
    interface EligibleFolder { folder: CardFolderReport; front: ImageFileReport; back: ImageFileReport; }
    const eligible: EligibleFolder[] = [];

    for (const folder of scan.allCardFolders) {
      if (folder.match.status !== 'matched' || folder.match.cardId == null) {
        report.summary.skippedUnmatchedFolders++;
        continue;
      }
      if (folder.imageCount !== 2) {
        report.summary.skippedWrongImageCount++;
        continue;
      }
      if (folder.hasNestedFolders || folder.nonImageCount > 0 || oddityPaths.has(folder.path)) {
        report.summary.skippedStructureOddities++;
        continue;
      }
      const files = filesByFolder.get(folder.path) || [];
      if (files.some(f => duplicateFileIds.has(f.driveFileId))) {
        report.summary.skippedDuplicateDriveFileIds++;
        continue;
      }
      if (duplicateCardIds.has(folder.match.cardId)) {
        report.summary.skippedDuplicateCardTargets++;
        continue;
      }
      const items: DriveItem[] = files.map(f => ({ id: f.driveFileId, name: f.fileName, mimeType: f.mimeType, modifiedTime: f.modifiedTime }));
      const resolved = resolveFrontBack(items);
      if (!resolved) {
        report.summary.skippedUnresolvedFrontBack++;
        continue;
      }
      const frontFile = files.find(f => f.driveFileId === resolved.front.id)!;
      const backFile = files.find(f => f.driveFileId === resolved.back.id)!;
      eligible.push({ folder, front: frontFile, back: backFile });
    }

    report.summary.eligibleFolders = eligible.length;
    console.log(`[DriveImport] ${eligible.length} eligible folders out of ${scan.allCardFolders.length} scanned`);

    const toProcess = maxFolders != null ? eligible.slice(0, maxFolders) : eligible;
    report.summary.foldersRemainingEligible = eligible.length - toProcess.length;

    for (const { folder, front, back } of toProcess) {
      const cardId = folder.match.cardId!;
      const card = cardById.get(cardId);
      if (!card) { report.summary.skippedUnmatchedFolders++; continue; }
      report.summary.foldersProcessed++;

      const sides: Array<{ side: 'front' | 'back'; file: ImageFileReport; existingUrl: string | null }> = [
        { side: 'front', file: front, existingUrl: card.frontImageUrl },
        { side: 'back', file: back, existingUrl: card.backImageUrl },
      ];

      for (const { side, file, existingUrl } of sides) {
        // Idempotency: already imported and unchanged → skip
        if (priorByFileId.has(file.driveFileId) && priorByFileId.get(file.driveFileId) === (file.modifiedTime ?? null)) {
          report.summary.skippedAlreadyImported++;
          continue;
        }
        // Never overwrite existing card images by default
        if (existingUrl && !overwrite) {
          report.summary.skippedExistingImages++;
          report.skippedExisting.push({ folderPath: folder.path, cardId, side });
          continue;
        }

        let cloudinaryUrl = '';
        let publicId = `card_${cardId}_${side}`;
        try {
          const { buffer, contentType } = await downloadDriveFile(file.driveFileId);
          const result = await cloudinary.uploader.upload(
            `data:${contentType};base64,${buffer.toString('base64')}`,
            {
              folder: IMPORT_FOLDER,
              public_id: publicId,
              overwrite: true, // idempotent re-upload to OUR new folder; card URL guarded above
              resource_type: 'image',
              timeout: IMPORT_UPLOAD_TIMEOUT_MS,
              transformation: [
                { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
                { format: 'auto' },
              ],
            },
          );
          if (!result?.secure_url) throw new Error('Cloudinary returned no URL');
          cloudinaryUrl = result.secure_url;
        } catch (err: any) {
          const stage = String(err?.message || '').startsWith('Drive download') || String(err?.message || '').includes('Not an image') ? 'download' : 'cloudinary_upload';
          report.summary.failedCloudinaryUploads++;
          report.failures.push({ folderPath: folder.path, cardId, side, fileName: file.fileName, stage, error: String(err?.message || err).slice(0, 300) });
          await db.insert(driveImageImports).values({
            driveFileId: file.driveFileId, driveFileName: file.fileName,
            driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
            cardId, imageType: side, importBatchId: batchId,
            status: 'failed_upload', error: String(err?.message || err).slice(0, 500),
          }).catch(() => {});
          continue;
        }

        // Update the card record (only after a confirmed upload). The card URL
        // swap and the ledger row commit together so resumability stays accurate.
        try {
          await db.transaction(async (tx) => {
            await tx.update(cards)
              .set(side === 'front' ? { frontImageUrl: cloudinaryUrl } : { backImageUrl: cloudinaryUrl })
              .where(eq(cards.id, cardId));
            await tx.insert(driveImageImports).values({
              driveFileId: file.driveFileId, driveFileName: file.fileName,
              driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
              cardId, imageType: side, cloudinaryPublicId: `${IMPORT_FOLDER}/${publicId}`,
              cloudinaryUrl, importBatchId: batchId, status: 'uploaded',
            });
          });
          report.summary.uploadedImages++;
          report.uploaded.push({ folderPath: folder.path, cardId, cardName: card.name, side, fileName: file.fileName, cloudinaryUrl });
          // keep in-memory ledger current so a same-run duplicate can't double-import
          priorByFileId.set(file.driveFileId, file.modifiedTime ?? null);
          if (side === 'front') card.frontImageUrl = cloudinaryUrl; else card.backImageUrl = cloudinaryUrl;
        } catch (err: any) {
          report.summary.failedDatabaseUpdates++;
          report.failures.push({ folderPath: folder.path, cardId, side, fileName: file.fileName, stage: 'db_update', error: String(err?.message || err).slice(0, 300) });
          await db.insert(driveImageImports).values({
            driveFileId: file.driveFileId, driveFileName: file.fileName,
            driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
            cardId, imageType: side, cloudinaryPublicId: `${IMPORT_FOLDER}/${publicId}`,
            cloudinaryUrl, importBatchId: batchId,
            status: 'failed_db_update', error: String(err?.message || err).slice(0, 500),
          }).catch(() => {});
        }
      }

      const updatedThisFolder = report.uploaded.filter(u => u.cardId === cardId).length > 0;
      if (updatedThisFolder) report.summary.updatedCardRecords++;

      await new Promise(r => setTimeout(r, IMPORT_DELAY_MS));
    }

    report.status = 'completed';
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    console.log(`[DriveImport] Batch ${batchId} completed in ${report.durationMs}ms: ${report.summary.uploadedImages} images uploaded, ${report.summary.updatedCardRecords} cards updated, ${report.summary.skippedExistingImages} existing skipped, ${report.summary.skippedAlreadyImported} already-imported skipped, ${report.summary.failedCloudinaryUploads + report.summary.failedDatabaseUpdates} failures`);
    return report;
  } catch (err: any) {
    report.status = 'failed';
    report.fatalError = String(err?.message || err);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    console.error(`[DriveImport] Batch ${batchId} failed:`, err?.message || err);
    throw err;
  } finally {
    if (lockAcquired) {
      await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${IMPORT_LOCK_KEY}))`).catch(() => {});
    }
    importRunning = false;
  }
}
