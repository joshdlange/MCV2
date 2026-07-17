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
