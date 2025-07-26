#!/usr/bin/env node

import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import config from "./config";

const execAsync = promisify(exec);

interface ValidationResult {
  name: string;
  status: "pass" | "fail" | "warning";
  message: string;
}

class SetupValidator {
  private results: ValidationResult[] = [];

  private addResult(
    name: string,
    status: "pass" | "fail" | "warning",
    message: string
  ) {
    this.results.push({ name, status, message });
  }

  async validateAll(): Promise<boolean> {
    console.log("🔍 Validating Shadow Coding Agent Setup");
    console.log("======================================\n");

    await this.checkNodeVersion();
    await this.checkAPIKeys();
    await this.checkDatabase();
    await this.checkRipgrep();
    await this.checkWorkspaceDirectory();
    await this.checkDependencies();

    this.printResults();

    const failures = this.results.filter((r) => r.status === "fail").length;
    const warnings = this.results.filter((r) => r.status === "warning").length;

    console.log(
      `\n📊 Summary: ${this.results.length - failures - warnings} passed, ${warnings} warnings, ${failures} failed`
    );

    if (failures > 0) {
      console.log(
        "\n❌ Setup validation failed. Please fix the issues above before running the agent."
      );
      return false;
    } else if (warnings > 0) {
      console.log(
        "\n⚠️  Setup validation passed with warnings. The agent should work but some features may be limited."
      );
      return true;
    } else {
      console.log(
        "\n✅ Setup validation passed! Your coding agent is ready to use."
      );
      console.log("\n🚀 To start the agent, run: npm run agent");
      return true;
    }
  }

  private async checkNodeVersion() {
    try {
      const { stdout } = await execAsync("node --version");
      const version = stdout.trim();
      const versionParts = version.slice(1).split(".");
      const majorVersionStr = versionParts[0];

      if (!majorVersionStr) {
        throw new Error("Invalid version format");
      }

      const majorVersion = parseInt(majorVersionStr, 10);

      if (majorVersion >= 18) {
        this.addResult("Node.js Version", "pass", `${version} (✓ >= 18)`);
      } else {
        this.addResult(
          "Node.js Version",
          "fail",
          `${version} (requires >= 18.0.0)`
        );
      }
    } catch (_error) {
      this.addResult("Node.js Version", "fail", "Node.js not found");
    }
  }

  private async checkAPIKeys() {
    const hasAnthropic = !!config.anthropicApiKey;
    const hasOpenAI = !!config.openaiApiKey;

    if (hasAnthropic && hasOpenAI) {
      this.addResult(
        "API Keys",
        "pass",
        "Both Anthropic and OpenAI keys configured"
      );
    } else if (hasAnthropic) {
      this.addResult("API Keys", "pass", "Anthropic API key configured");
    } else if (hasOpenAI) {
      this.addResult("API Keys", "pass", "OpenAI API key configured");
    } else {
      this.addResult(
        "API Keys",
        "fail",
        "No API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env"
      );
    }
  }

  private async checkDatabase() {
    try {
      const { prisma } = await import("@repo/db");
      await prisma.$connect();
      this.addResult("Database", "pass", "Connected successfully");
      await prisma.$disconnect();
    } catch (error) {
      this.addResult(
        "Database",
        "fail",
        `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async checkRipgrep() {
    try {
      const { stdout } = await execAsync("rg --version");
      const version = stdout.trim().split("\n")[0];
      this.addResult("ripgrep", "pass", `${version} installed`);
    } catch (_error) {
      this.addResult(
        "ripgrep",
        "fail",
        "ripgrep not found. Install with: brew install ripgrep (macOS) or apt install ripgrep (Ubuntu)"
      );
    }
  }

  private async checkWorkspaceDirectory() {
    try {
      const workspaceDir = config.workspaceDir;
      const stats = await fs.stat(workspaceDir);

      if (stats.isDirectory()) {
        // Check if directory is writable
        const testFile = path.join(workspaceDir, ".test-write-permission");
        try {
          await fs.writeFile(testFile, "test");
          await fs.unlink(testFile);
          this.addResult(
            "Workspace Directory",
            "pass",
            `${workspaceDir} exists and is writable`
          );
        } catch (_writeError) {
          this.addResult(
            "Workspace Directory",
            "warning",
            `${workspaceDir} exists but may not be writable`
          );
        }
      } else {
        this.addResult(
          "Workspace Directory",
          "fail",
          `${workspaceDir} exists but is not a directory`
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.addResult(
          "Workspace Directory",
          "warning",
          `${config.workspaceDir} does not exist. Run: mkdir -p ${config.workspaceDir}`
        );
      } else {
        this.addResult(
          "Workspace Directory",
          "fail",
          `Error accessing ${config.workspaceDir}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  }

  private async checkDependencies() {
    try {
      // Check if package.json exists and required dependencies are installed
      const packagePath = path.join(__dirname, "../package.json");
      const packageContent = await fs.readFile(packagePath, "utf-8");
      const packageData = JSON.parse(packageContent);

      const requiredDeps = ["ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "zod"];
      const missingDeps = requiredDeps.filter(
        (dep) =>
          !packageData.dependencies?.[dep] &&
          !packageData.devDependencies?.[dep]
      );

      if (missingDeps.length === 0) {
        this.addResult(
          "Dependencies",
          "pass",
          "All required packages installed"
        );
      } else {
        this.addResult(
          "Dependencies",
          "fail",
          `Missing dependencies: ${missingDeps.join(", ")}`
        );
      }
    } catch (_error) {
      this.addResult(
        "Dependencies",
        "warning",
        "Could not verify dependencies"
      );
    }
  }

  private printResults() {
    console.log("Results:");
    console.log("--------");

    this.results.forEach((result) => {
      const icon =
        result.status === "pass"
          ? "✅"
          : result.status === "warning"
            ? "⚠️ "
            : "❌";
      console.log(`${icon} ${result.name}: ${result.message}`);
    });
  }
}

// Run validation
async function main() {
  const validator = new SetupValidator();
  const success = await validator.validateAll();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

export { SetupValidator };
