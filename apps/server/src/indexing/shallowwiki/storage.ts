import { createHash } from "crypto";
import PineconeHandler from "../embedding/pineconeService";
import { PineconeBatchRecord } from "../types";
import { GraphNodeKind } from "../graph";
import { retrieveDeepWikiSummaries } from "./deepwiki-retrieval";
import {
  DeepWikiRecord,
  DeepWikiSearchResponse,
  TokenUsage,
} from "./deepwiki-types";

export class DeepWikiStorage {
  private pinecone: PineconeHandler;
  protected namespace: string;

  constructor(repoPath: string) {
    this.pinecone = new PineconeHandler();
    // Create namespace from repo path hash
    const repoHash = createHash("sha256")
      .update(repoPath)
      .digest("hex")
      .slice(0, 12);
    this.namespace = `deepwiki_${repoHash}`;
  }

  private generateId(type: string, path: string): string {
    return createHash("sha256")
      .update(`${type}_${path}`)
      .digest("hex")
      .slice(0, 16);
  }

  async clearRepository(): Promise<void> {
    try {
      await this.pinecone.clearNamespace(this.namespace);
      console.log(`🗑️  Cleared DeepWiki data for namespace: ${this.namespace}`);
    } catch (error) {
      console.error(`Failed to clear namespace ${this.namespace}:`, error);
    }
  }

  /**
   * Store or update file summary in Pinecone.
   * If a summary for this file already exists, it will be overwritten.
   */
  async storeFileSummary(
    repoPath: string,
    filePath: string,
    summary: string,
    symbols: string[] = [],
    dependencies: string[] = [],
    language?: string,
    complexity: number = 0,
    tokenUsage?: TokenUsage
  ): Promise<void> {
    const record: DeepWikiRecord = {
      id: this.generateId("file", filePath),
      metadata: {
        repoPath,
        filePath,
        type: "file_summary",
        language,
        symbols,
        dependencies,
        complexity,
        lastUpdated: new Date().toISOString(),
        tokenUsage,
        summary,
      },
    };

    await this.upsertRecord(record);
  }

  /**
   * Store or update directory summary in Pinecone.
   * If a summary for this directory already exists, it will be overwritten.
   */
  async storeDirectorySummary(
    repoPath: string,
    dirPath: string,
    summary: string,
    childFiles: string[] = [],
    childDirs: string[] = [],
    tokenUsage?: TokenUsage
  ): Promise<void> {
    const record: DeepWikiRecord = {
      id: this.generateId("directory", dirPath),
      metadata: {
        repoPath,
        filePath: dirPath,
        type: "directory_summary",
        symbols: childFiles,
        dependencies: childDirs,
        complexity: childFiles.length + childDirs.length,
        lastUpdated: new Date().toISOString(),
        tokenUsage,
        summary,
      },
    };

    await this.upsertRecord(record);
  }

  /**
   * Store or update root overview in Pinecone.
   * If a root overview already exists, it will be overwritten.
   */
  async storeRootOverview(
    repoPath: string,
    overview: string,
    totalFiles: number,
    totalDirs: number,
    tokenUsage?: TokenUsage
  ): Promise<void> {
    const record: DeepWikiRecord = {
      id: this.generateId("root", repoPath),
      metadata: {
        repoPath,
        type: "root_overview",
        symbols: [],
        dependencies: [],
        complexity: totalFiles + totalDirs,
        lastUpdated: new Date().toISOString(),
        tokenUsage,
        summary: overview,
      },
    };

    await this.upsertRecord(record);
  }

  private async upsertRecord(record: DeepWikiRecord): Promise<void> {
    try {
      const pineconeRecord: PineconeBatchRecord = {
        id: record.id,
        metadata: {
          code: record.metadata.summary,
          path: record.metadata.filePath || "",
          name: record.metadata.filePath || record.metadata.type || "",
          lang: record.metadata.language || "",
          line_start: 0,
          line_end: 0,
          kind: GraphNodeKind.FILE,
          symbols: JSON.stringify(record.metadata.symbols),
          dependencies: JSON.stringify(record.metadata.dependencies),
          tokenUsage: record.metadata.tokenUsage
            ? JSON.stringify(record.metadata.tokenUsage)
            : undefined,
          summaryType: record.metadata.type,
          complexity: JSON.stringify(record.metadata.complexity),
          repoPath: record.metadata.repoPath,
          lastUpdated: record.metadata.lastUpdated,
        },
      };

      await this.pinecone.upsertAutoEmbed([pineconeRecord], this.namespace);
      console.log(
        `💾 Stored ${record.metadata.type}: ${record.metadata.filePath || "root"}`
      );
    } catch (error) {
      console.error(`Failed to store record ${record.id}:`, error);
      throw error;
    }
  }

  async searchSummaries(
    query: string,
    topK: number = 10
  ): Promise<DeepWikiSearchResponse[]> {
    try {
      const results = await retrieveDeepWikiSummaries({
        query,
        namespace: this.namespace,
        topK,
      });
      return results;
    } catch (error) {
      console.error(`Failed to search summaries:`, error);
      return [];
    }
  }

  async getFileSummary(filePath: string): Promise<DeepWikiRecord | null> {
    try {
      const id = this.generateId("file", filePath);
      const results = await this.searchSummaries(`id:${id}`, 1);
      return results.length > 0 && results[0]
        ? this.parseRecord(results[0])
        : null;
    } catch (error) {
      console.error(`Failed to get file summary for ${filePath}:`, error);
      return null;
    }
  }

  async getDirectorySummary(dirPath: string): Promise<DeepWikiRecord | null> {
    try {
      const id = this.generateId("directory", dirPath);
      const results = await this.searchSummaries(`id:${id}`, 1);
      return results.length > 0 && results[0]
        ? this.parseRecord(results[0])
        : null;
    } catch (error) {
      console.error(`Failed to get directory summary for ${dirPath}:`, error);
      return null;
    }
  }

  async getRootOverview(): Promise<DeepWikiRecord | null> {
    try {
      const results = await this.searchSummaries("type:root_overview", 1);
      return results.length > 0 && results[0]
        ? this.parseRecord(results[0])
        : null;
    } catch (error) {
      console.error(`Failed to get root overview:`, error);
      return null;
    }
  }

  private parseRecord(pineconeResult: DeepWikiSearchResponse): DeepWikiRecord {
    const fields = pineconeResult.fields || {};
    return {
      id: pineconeResult._id,
      metadata: {
        repoPath: fields.repoPath || fields.path || "",
        filePath: fields.path || "",
        type: (fields.summaryType as any) || "file_summary",
        language: fields.lang || "",
        symbols: fields.symbols ? JSON.parse(fields.symbols) : [],
        dependencies: fields.dependencies
          ? JSON.parse(fields.dependencies)
          : [],
        complexity: fields.complexity ? JSON.parse(fields.complexity) : 0,
        lastUpdated: fields.lastUpdated || new Date().toISOString(),
        tokenUsage: fields.tokenUsage
          ? JSON.parse(fields.tokenUsage)
          : undefined,
        summary: fields.code || "",
      },
    };
  }

  getNamespace(): string {
    return this.namespace;
  }
}

export default DeepWikiStorage;
