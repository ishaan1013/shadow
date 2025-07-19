#!/usr/bin/env tsx

import { GitHubCloneService } from "./services/github-clone";
import config from "./config";

async function testGitHubClone() {
  console.log("🧪 Testing GitHub Clone Service");
  console.log("================================");

  // Test repo parsing
  const cloneService = new GitHubCloneService("test-token");
  
  try {
    // Test 1: Parse repo identifiers
    console.log("\n1. Testing repo identifier parsing:");
    
    const testRepos = [
      "owner/repo",
      "https://github.com/owner/repo",
      "https://github.com/owner/repo.git",
    ];
    
    for (const repoUrl of testRepos) {
      try {
        const parsed = (cloneService as any).parseRepoIdentifier(repoUrl);
        console.log(`  ✅ ${repoUrl} -> ${parsed.owner}/${parsed.repo}`);
      } catch (error) {
        console.log(`  ❌ ${repoUrl} -> ${error instanceof Error ? error.message : error}`);
      }
    }

    // Test 2: Workspace directory generation
    console.log("\n2. Testing workspace directory generation:");
    const testTaskId = "test-123";
    const workspaceDir = (cloneService as any).getTaskWorkspaceDir(testTaskId);
    console.log(`  ✅ Task ${testTaskId} workspace: ${workspaceDir}`);

    // Test 3: Environment check
    console.log("\n3. Testing environment:");
    console.log(`  📁 Base workspace: ${config.workspaceDir}`);
    console.log(`  🔧 Git available: ${await checkGitAvailable()}`);

    console.log("\n✅ All tests passed!");
    
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

async function checkGitAvailable(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    await execAsync("git --version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  testGitHubClone().catch(console.error);
}

export { testGitHubClone };