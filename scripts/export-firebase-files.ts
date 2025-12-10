
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const FIREBASE_KEYWORDS = [
  'firebase',
  'firebaseUid',
  'Firebase',
  'getAuth',
  'GoogleAuthProvider',
  'initializeApp',
  'admin.auth()',
  'VITE_FIREBASE'
];

const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'archive',
  'attached_assets',
  'uploads',
  'badge_images',
  'android/app/build',
  '.config'
];

const EXPORT_DIR = 'firebase-export';

interface FileMatch {
  path: string;
  relativePath: string;
  matches: string[];
}

function shouldExclude(path: string): boolean {
  return EXCLUDE_DIRS.some(dir => path.includes(dir));
}

function searchFileForFirebase(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const matches: string[] = [];
    
    for (const keyword of FIREBASE_KEYWORDS) {
      if (content.includes(keyword)) {
        matches.push(keyword);
      }
    }
    
    return matches;
  } catch (error) {
    return [];
  }
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = join(dirPath, file);
    
    if (shouldExclude(fullPath)) {
      return;
    }

    if (statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      // Only process text files
      const ext = file.split('.').pop()?.toLowerCase();
      if (ext && ['ts', 'tsx', 'js', 'jsx', 'json', 'env', 'md'].includes(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function exportFirebaseFiles() {
  console.log('🔍 Scanning for Firebase-related files...\n');

  // Create export directory
  if (!existsSync(EXPORT_DIR)) {
    mkdirSync(EXPORT_DIR, { recursive: true });
  }

  // Get all files
  const allFiles = getAllFiles('.');
  const firebaseFiles: FileMatch[] = [];

  // Search for Firebase references
  for (const filePath of allFiles) {
    const matches = searchFileForFirebase(filePath);
    if (matches.length > 0) {
      firebaseFiles.push({
        path: filePath,
        relativePath: relative('.', filePath),
        matches: [...new Set(matches)] // Remove duplicates
      });
    }
  }

  console.log(`✅ Found ${firebaseFiles.length} files with Firebase references\n`);

  // Create manifest
  const manifest = {
    exportDate: new Date().toISOString(),
    totalFiles: firebaseFiles.length,
    files: firebaseFiles.map(f => ({
      path: f.relativePath,
      keywords: f.matches
    }))
  };

  // Copy files to export directory
  let copiedCount = 0;
  for (const file of firebaseFiles) {
    try {
      const exportPath = join(EXPORT_DIR, file.relativePath);
      const exportDir = dirname(exportPath);
      
      // Create directory structure
      if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
      }

      // Copy file
      const content = readFileSync(file.path);
      writeFileSync(exportPath, content);
      copiedCount++;
      
      console.log(`📄 Exported: ${file.relativePath}`);
    } catch (error) {
      console.error(`❌ Failed to export ${file.relativePath}:`, error);
    }
  }

  // Write manifest
  writeFileSync(
    join(EXPORT_DIR, 'MANIFEST.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Write readable summary
  const summary = `Firebase Files Export Summary
Generated: ${new Date().toISOString()}
Total Files: ${firebaseFiles.length}

Files List:
${firebaseFiles.map((f, i) => `${i + 1}. ${f.relativePath}\n   Keywords: ${f.matches.join(', ')}`).join('\n\n')}
`;

  writeFileSync(join(EXPORT_DIR, 'SUMMARY.txt'), summary);

  console.log(`\n✅ Export complete!`);
  console.log(`📁 Location: ./${EXPORT_DIR}/`);
  console.log(`📊 Files exported: ${copiedCount}/${firebaseFiles.length}`);
  console.log(`📄 Manifest: ${EXPORT_DIR}/MANIFEST.json`);
  console.log(`📄 Summary: ${EXPORT_DIR}/SUMMARY.txt`);
}

// Run the export
exportFirebaseFiles();
