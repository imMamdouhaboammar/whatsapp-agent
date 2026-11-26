import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspaceCleanResult {
  success: boolean;
  freedBytes: number;
  cleanedItems: string[];
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function calculateDirSize(dirPath: string, depth = 0): number {
  if (depth > 5) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += calculateDirSize(fullPath, depth + 1);
        } else if (entry.isFile()) {
          total += statSync(fullPath).size;
        }
      } catch (err: unknown) {
        if (!isMissingFile(err)) {
          console.warn(`[WorkspaceCleaner] Error inspecting ${fullPath}:`, err);
        }
      }
    }
  } catch (err: unknown) {
    if (!isMissingFile(err)) {
      console.warn(`[WorkspaceCleaner] Error reading dir ${dirPath}:`, err);
    }
  }
  return total;
}

/**
 * Cleans temporary, cached, and orphaned developer/test artifacts from the workspace data directory.
 * Preserves active operational databases and WhatsApp sessions.
 */
export function cleanWorkspaceData(dataDir = './data'): WorkspaceCleanResult {
  const cleanedItems: string[] = [];
  let freedBytes = 0;

  try {
    const entries = readdirSync(dataDir, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = join(dataDir, name);

      // Match test directories, scratch directories, or temp caches
      const isTestDir = entry.isDirectory() && (name.startsWith('test-') || name === '.temp' || name === 'temp' || name === 'cache');
      const isStrayArtifact = entry.isFile() && (name === '.DS_Store' || name.endsWith('.tmp'));

      if (isTestDir || isStrayArtifact) {
        const itemSize = entry.isDirectory() ? calculateDirSize(fullPath) : statSync(fullPath).size;
        try {
          rmSync(fullPath, { recursive: true, force: true });
          cleanedItems.push(name);
          freedBytes += itemSize;
        } catch (err: unknown) {
          if (!isMissingFile(err)) {
            console.warn(`[WorkspaceCleaner] Failed to remove ${fullPath}:`, err);
          }
        }
      }
    }
  } catch (err: unknown) {
    if (!isMissingFile(err)) {
      console.warn(`[WorkspaceCleaner] Failed to clean workspace data in ${dataDir}:`, err);
    }
    return { success: false, freedBytes, cleanedItems };
  }

  return { success: true, freedBytes, cleanedItems };
}
