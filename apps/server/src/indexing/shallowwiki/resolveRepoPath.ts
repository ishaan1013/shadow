import fs from "fs";
import path from "path";
import os from "os";
import fetch from "node-fetch";
import { isValidRepo, getOwnerRepo } from "../utils/repository";
import logger from "../logger";

/**
 * Resolve a repo identifier ("owner/repo" or absolute path) into a local directory path.
 * - If the input already exists on disk, it is returned unchanged.
 * - Otherwise we assume a GitHub repo and download all files via the GitHub REST API
 *   into a cache directory under the user's OS temp folder.
 * 
 * @param repoOrPath - The repository identifier ("owner/repo") or local path
 * @param forceRefresh - If true, bypass cache and redownload repository files
 * @returns The absolute checkout/cache path containing the repository files.
 */
export async function resolveRepoPath(repoOrPath: string, forceRefresh: boolean = false): Promise<string> {
  // Direct path on disk
  if (fs.existsSync(repoOrPath)) {
    return path.resolve(repoOrPath);
  }

  // Must be GitHub repo identifier
  if (!isValidRepo(repoOrPath)) {
    throw new Error(`Invalid repo or path: ${repoOrPath}`);
  }

  const { owner, repo } = getOwnerRepo(repoOrPath);
  const cacheDir = path.join(os.tmpdir(), "shallowwiki-repos", `${owner}-${repo}`);
  const marker = path.join(cacheDir, ".complete");

  // If we've already cached it, either return immediately or clear the cache
  if (fs.existsSync(marker)) {
    if (!forceRefresh) {
      return cacheDir;
    } else {
      // Force refresh requested - delete the cached repo
      console.log(`Force refresh requested for ${owner}/${repo}, clearing cache...`);
      try {
        // Recursive deletion of the directory
        fs.rmSync(cacheDir, { recursive: true, force: true });
        // Recreate empty directory
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch (error) {
        console.error(`Error clearing cache for ${owner}/${repo}:`, error);
        // Continue with fresh download
      }
    }
  }

  // Ensure directory exists
  fs.mkdirSync(cacheDir, { recursive: true });

  // Recursively fetch repo tree via GitHub API (all files)
  await downloadRepositoryFiles(owner, repo, "", cacheDir);

  // Touch marker file
  fs.writeFileSync(marker, "done");

  return cacheDir;
}

/**
 * Download all repository files from a GitHub repository into a local directory recursively.
 * Uses the public GitHub REST API (requires GITHUB_TOKEN env var for private repos / higher rate limits).
 */
async function downloadRepositoryFiles(
  owner: string,
  repo: string,
  dirPath: string,
  destDir: string
) {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents${dirPath ? `/${dirPath}` : ""}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "shallowwiki-repo-fetcher",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(baseUrl, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();

  // Skip binary files and very large files
  const skipExtensions = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".ttf", ".woff", ".mp3", ".mp4", ".zip", ".gz", ".tar"];
  
  if (Array.isArray(data)) {
    // Directory listing
    for (const item of data) {
      if (item.type === "dir") {
        // Skip common directories we don't need to analyze
        if (["node_modules", ".git", "dist", "build"].includes(item.name)) {
          continue;
        }
        await downloadRepositoryFiles(owner, repo, item.path, destDir);
      } else if (item.type === "file") {
        // Skip binary files
        const ext = path.extname(item.name).toLowerCase();
        if (skipExtensions.includes(ext) || item.size > 1000000) { // Skip files > 1MB
          continue;
        }
        // Create parent directories if they don't exist
        const targetPath = path.join(destDir, item.path);
        const targetDir = path.dirname(targetPath);
        fs.mkdirSync(targetDir, { recursive: true });
        
        await downloadFile(item.download_url, targetPath);
        console.log(`Downloaded: ${item.path}`);
      }
    }
  } else if (data.type === "file") {
    // Skip binary files
    const ext = path.extname(data.name).toLowerCase();
    if (!skipExtensions.includes(ext) && data.size <= 1000000) { 
      const targetPath = path.join(destDir, data.path);
      const targetDir = path.dirname(targetPath);
      fs.mkdirSync(targetDir, { recursive: true });
      
      await downloadFile(data.download_url, targetPath);
      console.log(`Downloaded: ${data.path}`);
    }
  }
}

async function downloadFile(url: string, destPath: string) {
  const headers: Record<string, string> = {
    "User-Agent": "shallowwiki-markdown-fetcher",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    logger.error(`Failed to download ${url}: ${res.status}`);
    return;
  }
  const content = await res.text();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content, "utf8");
}
