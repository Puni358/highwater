import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Banned List & Cartographic Compliance Pass', () => {
  const srcDir = path.resolve(__dirname, '..');
  const indexHtmlPath = path.resolve(srcDir, '../index.html');

  // Collect all src code files
  const getCodeFiles = (dir) => {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
          results = results.concat(getCodeFiles(fullPath));
        }
      } else if (
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.jsx') ||
        entry.name.endsWith('.css') ||
        entry.name.endsWith('.html')
      ) {
        results.push(fullPath);
      }
    }
    return results;
  };

  const files = getCodeFiles(srcDir);
  if (fs.existsSync(indexHtmlPath)) {
    files.push(indexHtmlPath);
  }

  it('contains zero banned fonts (Inter, Roboto, Arial, Plus Jakarta Sans, etc.)', () => {
    const bannedFonts = [
      'Plus Jakarta Sans',
      'Roboto',
      'Helvetica',
      'Open Sans',
      'Lato',
      'Poppins',
      'Montserrat',
      'Space Grotesk',
      'DM Sans',
      'Outfit',
      'Sora',
      'Manrope',
      'JetBrains Mono',
      'Fira Code',
    ];

    for (const filePath of files) {
      // Skip the banned list test itself
      if (filePath.includes('BannedListCompliance.test.jsx')) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      for (const font of bannedFonts) {
        const regex = new RegExp(`['"]${font}['"]`, 'i');
        expect(
          regex.test(content),
          `Found banned font "${font}" in ${path.relative(srcDir, filePath)}`
        ).toBe(false);
      }
    }
  });

  it('contains zero marketing buzzwords and banned promotional copy', () => {
    const bannedWords = [
      'AI-powered',
      'Intelligent',
      'Next-gen',
      'Seamless',
      'Leverage',
      'Empower',
      'Unlock',
      'Cutting-edge',
      'Revolutionary',
      'Mission control',
      'Command center',
    ];

    for (const filePath of files) {
      if (filePath.includes('BannedListCompliance.test.jsx')) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      for (const word of bannedWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        expect(
          regex.test(content),
          `Found banned word "${word}" in ${path.relative(srcDir, filePath)}`
        ).toBe(false);
      }
    }
  });

  it('contains zero glassmorphism (backdrop-blur) or neon glow effects', () => {
    for (const filePath of files) {
      if (filePath.includes('BannedListCompliance.test.jsx')) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      expect(
        content.includes('backdrop-blur'),
        `Found banned backdrop-blur in ${path.relative(srcDir, filePath)}`
      ).toBe(false);

      expect(
        content.includes('shadow-glow') || content.includes('drop-shadow-glow'),
        `Found banned glow shadow in ${path.relative(srcDir, filePath)}`
      ).toBe(false);
    }
  });

  it('verifies npm package licenses for newly installed typography and 3D dependencies', () => {
    const rootDir = path.resolve(srcDir, '..');
    const packagesToCheck = [
      { name: '@fontsource/source-serif-4', allowed: ['OFL-1.1'] },
      { name: '@fontsource/public-sans', allowed: ['OFL-1.1'] },
      { name: 'three', allowed: ['MIT'] },
    ];

    for (const pkg of packagesToCheck) {
      const pkgJsonPath = path.resolve(rootDir, 'node_modules', pkg.name, 'package.json');
      expect(fs.existsSync(pkgJsonPath), `Package ${pkg.name} not found in node_modules`).toBe(true);

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const license = pkgJson.license || (pkgJson.licenses && pkgJson.licenses[0]?.type);
      expect(
        pkg.allowed.includes(license),
        `Package ${pkg.name} has license ${license}, expected one of ${pkg.allowed.join(', ')}`
      ).toBe(true);
    }
  });

  it('verifies 3D ReliefView is lazy-loaded via dynamic import in FloodMap', () => {
    const floodMapPath = path.resolve(srcDir, 'components/FloodMap.jsx');
    const content = fs.readFileSync(floodMapPath, 'utf8');

    expect(content).toMatch(/lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]\.\/ReliefView\.jsx['"]\s*\)\s*\)/);
  });
});
