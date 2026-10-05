#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const packageJsonPath = path.join(workspace, 'package.json');
const builderConfigPath = path.join(workspace, 'electron-builder.yml');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = String(pkg.version || '0.1.0');
const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(currentVersion);

if (!match) {
  throw new Error(`Invalid package version format: ${currentVersion}`);
}

const [, majorRaw, minorRaw] = match;
const major = Number(majorRaw);
const minor = Number(minorRaw) + 1;
const nextVersion = `${major}.${minor}.0`;

pkg.version = nextVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

const builderConfig = fs.readFileSync(builderConfigPath, 'utf8');
const newArtifactName = `artifactName: Smartbis-POS-\${version}-Setup.\${ext}\n`;
const updatedBuilderConfig = builderConfig.replace(
  /^artifactName:\s*.*$/m,
  newArtifactName,
);

fs.writeFileSync(builderConfigPath, updatedBuilderConfig);
console.log(`Version bumped from ${currentVersion} to ${nextVersion}. Artifact name=${newArtifactName.trim()}`);
