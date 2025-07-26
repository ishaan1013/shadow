/**
 * Unified SidecarClient for all HTTP communication with remote pod sidecars
 * Eliminates duplicate makeSidecarRequest implementations and provides
 * consistent error handling, retry logic, and circuit breaker patterns
 */

import config from "../../config";
import {
  SidecarResponse,
  SidecarClientConfig,
  SidecarError,
  SidecarErrorType,
  GitCloneRequest,
  GitCloneResponse,
  GitConfigRequest,
  GitConfigResponse,
  GitBranchRequest,
  GitBranchResponse,
  GitStatusResponse,
  GitDiffResponse,
  GitCommitRequest,
  GitCommitResponse,
  GitPushRequest,
  GitPushResponse,
  HealthResponse,
} from "@repo/types";

export class SidecarClient {
  private taskId: string;
  private namespace: string;
  private port: number;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;

  // Circuit breaker state
  private consecutiveFailures: number = 0;
  private lastFailureTime: number = 0;
  private circuitBreakerThreshold: number;
  private circuitBreakerTimeout: number;

  constructor(configOrTaskId: SidecarClientConfig | string) {
    if (typeof configOrTaskId === 'string') {
      // Simple taskId constructor for backward compatibility
      this.taskId = configOrTaskId;
      this.namespace = config.kubernetesNamespace || "shadow";
      this.port = config.sidecarPort || 8080;
      this.timeout = 30000; // 30 seconds
      this.maxRetries = 3;
      this.retryDelay = 1000; // 1 second base delay
      this.circuitBreakerThreshold = 5;
      this.circuitBreakerTimeout = 60000; // 1 minute
    } else {
      // Full configuration constructor
      this.taskId = configOrTaskId.taskId;
      this.namespace = configOrTaskId.namespace || config.kubernetesNamespace || "shadow";
      this.port = configOrTaskId.port || config.sidecarPort || 8080;
      this.timeout = configOrTaskId.timeout || 30000;
      this.maxRetries = configOrTaskId.maxRetries || 3;
      this.retryDelay = configOrTaskId.retryDelay || 1000;
      this.circuitBreakerThreshold = configOrTaskId.circuitBreakerThreshold || 5;
      this.circuitBreakerTimeout = configOrTaskId.circuitBreakerTimeout || 60000;
    }
  }

  /**
   * Get the sidecar service URL for this task
   */
  getSidecarUrl(): string {
    return `http://shadow-agent-${this.taskId}.${this.namespace}.svc.cluster.local:${this.port}`;
  }

  /**
   * Make authenticated HTTP request to sidecar API with resilient error handling
   * Combines the best features from both original implementations plus circuit breaker
   */
  async request<T extends SidecarResponse>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Check circuit breaker state before attempting request
    if (this.isCircuitBreakerOpen()) {
      const error = new Error(
        `Circuit breaker is open for sidecar ${this.taskId}. Too many consecutive failures (${this.consecutiveFailures}). ` +
        `Will retry after ${new Date(this.lastFailureTime + this.circuitBreakerTimeout).toLocaleTimeString()}`
      ) as SidecarError;
      error.type = SidecarErrorType.CIRCUIT_BREAKER_OPEN;
      error.retryable = false;
      throw error;
    }

    let lastError: SidecarError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.makeRequestAttempt<T>(endpoint, options);

        // Reset circuit breaker on successful request
        this.resetCircuitBreaker();

        return result;
      } catch (error) {
        lastError = this.classifyError(error);

        console.warn(
          `[SIDECAR_CLIENT] Request attempt ${attempt}/${this.maxRetries} failed for ${this.taskId}${endpoint}:`,
          lastError.message
        );

        // Don't retry on non-retryable errors
        if (!lastError.retryable) {
          this.recordFailure();
          throw lastError;
        }

        // If this is the last attempt, record failure and throw
        if (attempt === this.maxRetries) {
          this.recordFailure();
          const finalError = new Error(
            `All ${this.maxRetries} attempts failed for ${this.taskId}${endpoint}. Last error: ${lastError.message}`
          ) as SidecarError;
          finalError.type = lastError.type;
          finalError.retryable = false;
          throw finalError;
        }

        // Wait before retry with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        console.log(`[SIDECAR_CLIENT] Retrying ${this.taskId}${endpoint} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  /**
   * Make a single HTTP request attempt
   */
  private async makeRequestAttempt<T extends SidecarResponse>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.getSidecarUrl()}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `Sidecar API error ${response.status}: ${response.statusText}. ${errorText}`
        ) as SidecarError;
        error.statusCode = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Classify errors for retry and circuit breaker logic
   */
  private classifyError(error: unknown): SidecarError {
    let sidecarError: SidecarError;

    if (error instanceof Error) {
      sidecarError = error as SidecarError;
    } else {
      sidecarError = new Error("Unknown sidecar error") as SidecarError;
    }

    // Set default type
    sidecarError.type = SidecarErrorType.UNKNOWN_ERROR;
    sidecarError.retryable = true; // Default to retryable

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (error.name === "AbortError" || message.includes("timeout")) {
        sidecarError.type = SidecarErrorType.TIMEOUT_ERROR;
        sidecarError.message = `Sidecar API request timeout after ${this.timeout}ms: ${error.message}`;
        sidecarError.retryable = true;
      } else if (message.includes("http 4")) {
        sidecarError.type = SidecarErrorType.CLIENT_ERROR;
        sidecarError.retryable = false; // Don't retry client errors
      } else if (message.includes("http 5")) {
        sidecarError.type = SidecarErrorType.SERVER_ERROR;
        sidecarError.retryable = true;
      } else if (message.includes("fetch") || message.includes("network")) {
        sidecarError.type = SidecarErrorType.NETWORK_ERROR;
        sidecarError.retryable = true;
      } else if (message.includes("unauthorized") || message.includes("forbidden")) {
        sidecarError.type = SidecarErrorType.CLIENT_ERROR;
        sidecarError.retryable = false;
      }
    }

    return sidecarError;
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitBreakerOpen(): boolean {
    if (this.consecutiveFailures < this.circuitBreakerThreshold) {
      return false;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure >= this.circuitBreakerTimeout) {
      console.log(`[SIDECAR_CLIENT] Circuit breaker timeout elapsed for ${this.taskId}, attempting to reset`);
      return false;
    }

    return true;
  }

  /**
   * Record a failure for circuit breaker tracking
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      console.warn(
        `[SIDECAR_CLIENT] Circuit breaker opened for ${this.taskId} after ${this.consecutiveFailures} consecutive failures. ` +
        `Will retry after ${this.circuitBreakerTimeout}ms`
      );
    }
  }

  /**
   * Reset circuit breaker on successful request
   */
  private resetCircuitBreaker(): void {
    if (this.consecutiveFailures > 0) {
      console.log(`[SIDECAR_CLIENT] Circuit breaker reset for ${this.taskId} after successful request`);
      this.consecutiveFailures = 0;
      this.lastFailureTime = 0;
    }
  }

  // ========== Git API Methods ==========

  async cloneRepository(repoUrl: string, branch: string, githubToken: string): Promise<GitCloneResponse> {
    return this.request<GitCloneResponse>("/api/git/clone", {
      method: "POST",
      body: JSON.stringify({ repoUrl, branch, githubToken } as GitCloneRequest),
    });
  }

  async configureGitUser(name: string, email: string): Promise<GitConfigResponse> {
    return this.request<GitConfigResponse>("/api/git/config", {
      method: "POST",
      body: JSON.stringify({ name, email } as GitConfigRequest),
    });
  }

  async createShadowBranch(baseBranch: string, shadowBranch: string): Promise<GitBranchResponse> {
    return this.request<GitBranchResponse>("/api/git/branch", {
      method: "POST",
      body: JSON.stringify({ baseBranch, shadowBranch } as GitBranchRequest),
    });
  }

  async getGitStatus(): Promise<GitStatusResponse> {
    return this.request<GitStatusResponse>("/api/git/status", {
      method: "GET",
    });
  }

  async getGitDiff(): Promise<GitDiffResponse> {
    return this.request<GitDiffResponse>("/api/git/diff", {
      method: "GET",
    });
  }

  async commitChanges(
    user: { name: string; email: string },
    coAuthor: { name: string; email: string },
    message: string
  ): Promise<GitCommitResponse> {
    return this.request<GitCommitResponse>("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({ user, coAuthor, message } as GitCommitRequest),
    });
  }

  async pushBranch(branchName: string, setUpstream: boolean = false): Promise<GitPushResponse> {
    return this.request<GitPushResponse>("/api/git/push", {
      method: "POST",
      body: JSON.stringify({ branchName, setUpstream } as GitPushRequest),
    });
  }

  // ========== Health Check ==========

  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", {
      method: "GET",
    });
  }

  // ========== Utility Methods ==========

  getTaskId(): string {
    return this.taskId;
  }

  getNamespace(): string {
    return this.namespace;
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Test connectivity to sidecar
   */
  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.healthy;
    } catch (error) {
      console.error(`[SIDECAR_CLIENT] Connection test failed for ${this.taskId}:`, error);
      return false;
    }
  }
}