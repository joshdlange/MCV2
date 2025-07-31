#!/usr/bin/env tsx
/**
 * Marvel Card Vault - Code Audit Tool
 * Analyzes codebase for unused files and functions
 */

import fs from 'fs';
import path from 'path';

interface AuditResults {
  unusedFiles: string[];
  redundantFunctions: string[];
  localFileWrites: string[];
  cloudinaryUsage: string[];
  importMap: Record<string, string[]>;
}

class CodeAuditor {
  private results: AuditResults = {
    unusedFiles: [],
    redundantFunctions: [],
    localFileWrites: [],
    cloudinaryUsage: [],
    importMap: {}
  };

  private rootPath: string;

  constructor(rootPath: string = '.') {
    this.rootPath = rootPath;
  }

  /**
   * Scan for files that write to local filesystem
   */
  async scanForLocalFileWrites(): Promise<void> {
    const patterns = [
      'fs.writeFileSync',
      'fs.createWriteStream',
      'fs.writeFile',
      'writeFileSync',
      'createWriteStream'
    ];

    await this.scanFiles('**/*.{ts,js}', (filePath, content) => {
      patterns.forEach(pattern => {
        if (content.includes(pattern)) {
          this.results.localFileWrites.push(`${filePath}: ${pattern}`);
        }
      });
    });
  }

  /**
   * Scan for Cloudinary usage
   */
  async scanForCloudinaryUsage(): Promise<void> {
    const patterns = [
      'cloudinary.uploader.upload',
      'cloudinary.url',
      'from "./cloudinary"',
      'import.*cloudinary'
    ];

    await this.scanFiles('**/*.{ts,js}', (filePath, content) => {
      patterns.forEach(pattern => {
        if (content.match(new RegExp(pattern, 'i'))) {
          this.results.cloudinaryUsage.push(`${filePath}: ${pattern}`);
        }
      });
    });
  }

  /**
   * Build import dependency map
   */
  async buildImportMap(): Promise<void> {
    await this.scanFiles('**/*.{ts,js}', (filePath, content) => {
      const imports = content.match(/import.*from\s+['"`]([^'"`]+)['"`]/g) || [];
      const relativePath = path.relative(this.rootPath, filePath);
      
      this.results.importMap[relativePath] = imports.map(imp => {
        const match = imp.match(/from\s+['"`]([^'"`]+)['"`]/);
        return match ? match[1] : '';
      }).filter(Boolean);
    });
  }

  /**
   * Identify unused files
   */
  identifyUnusedFiles(): void {
    const allFiles = Object.keys(this.results.importMap);
    const importedFiles = new Set<string>();

    // Collect all imported files
    Object.values(this.results.importMap).forEach(imports => {
      imports.forEach(imp => {
        if (imp.startsWith('./') || imp.startsWith('../')) {
          // Resolve relative imports
          const resolvedPath = this.resolveImport(imp);
          if (resolvedPath) {
            importedFiles.add(resolvedPath);
          }
        }
      });
    });

    // Find files that are never imported
    allFiles.forEach(file => {
      const isMainFile = file.includes('index.ts') || file.includes('main.ts') || file.includes('routes.ts');
      const isImported = importedFiles.has(file);
      const isScript = file.startsWith('scripts/');
      
      if (!isMainFile && !isImported && !isScript) {
        this.results.unusedFiles.push(file);
      }
    });
  }

  private resolveImport(importPath: string): string | null {
    // Basic resolution - could be enhanced
    const extensions = ['.ts', '.js', '/index.ts', '/index.js'];
    
    for (const ext of extensions) {
      const resolved = importPath + ext;
      if (fs.existsSync(resolved)) {
        return path.relative(this.rootPath, resolved);
      }
    }
    
    return null;
  }

  private async scanFiles(pattern: string, callback: (filePath: string, content: string) => void): Promise<void> {
    const scanDir = (dir: string): void => {
      const items = fs.readdirSync(dir);
      
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          scanDir(fullPath);
        } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.js'))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            callback(fullPath, content);
          } catch (error) {
            console.warn(`Could not read ${fullPath}:`, error);
          }
        }
      });
    };

    scanDir(this.rootPath);
  }

  /**
   * Run complete audit
   */
  async runAudit(): Promise<AuditResults> {
    console.log('🔍 Starting codebase audit...');
    
    console.log('📁 Building import map...');
    await this.buildImportMap();
    
    console.log('🔍 Scanning for local file writes...');
    await this.scanForLocalFileWrites();
    
    console.log('☁️ Scanning for Cloudinary usage...');
    await this.scanForCloudinaryUsage();
    
    console.log('🧹 Identifying unused files...');
    this.identifyUnusedFiles();
    
    return this.results;
  }

  /**
   * Generate audit report
   */
  generateReport(): string {
    const report = [
      '# Code Audit Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## 🚨 Local File Write Usage',
      this.results.localFileWrites.length > 0 
        ? this.results.localFileWrites.map(item => `- ${item}`).join('\n')
        : '✅ No local file writes found',
      '',
      '## ☁️ Cloudinary Usage',
      this.results.cloudinaryUsage.length > 0
        ? this.results.cloudinaryUsage.map(item => `- ${item}`).join('\n')
        : '❌ No Cloudinary usage found',
      '',
      '## 🗑️ Potentially Unused Files',
      this.results.unusedFiles.length > 0
        ? this.results.unusedFiles.map(item => `- ${item}`).join('\n')
        : '✅ No unused files detected',
      '',
      '## 📊 Summary',
      `- Total files scanned: ${Object.keys(this.results.importMap).length}`,
      `- Local file writes: ${this.results.localFileWrites.length}`,
      `- Cloudinary integrations: ${this.results.cloudinaryUsage.length}`,
      `- Potentially unused files: ${this.results.unusedFiles.length}`
    ].join('\n');

    return report;
  }
}

// Run audit if called directly
if (require.main === module) {
  const auditor = new CodeAuditor();
  auditor.runAudit().then(results => {
    console.log('\n📋 Audit Complete!');
    console.log(auditor.generateReport());
  }).catch(error => {
    console.error('❌ Audit failed:', error);
  });
}

export { CodeAuditor, AuditResults };