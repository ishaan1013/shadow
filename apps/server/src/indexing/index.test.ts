import { app } from "../app";
import request from "supertest";
import { expect, describe, it, beforeEach, afterEach } from "@jest/globals";
import PineconeHandler from "./embedding/pineconeService";


describe("Indexing and Embedding API", () => {
  const testNamespace = "test-rajansagarwal-arceus";
  let pinecone: PineconeHandler;

  beforeEach(() => {
    pinecone = new PineconeHandler();
  });

  afterEach(async () => {
    // Clean up: clear the test namespace after each test
    try {
      await pinecone.clearNamespace(testNamespace);
    } catch (error) {
      console.warn("Failed to clear namespace:", error);
    }
  });

  describe("POST /api/indexing/index", () => {
    it("should index a GitHub repo without embedding", async () => {
      const response = await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "rajansagarwal/arceus",
          options: {
            maxLines: 200,
            embed: false,
            paths: null
          }
        })
        .expect(200);

      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("Indexing complete");
      expect(response.body).toHaveProperty("graph");
      expect(response.body).toHaveProperty("invertedIndex");
    });

    it("should index a GitHub repo with embedding and upload to Pinecone", async () => {
      const response = await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "rajansagarwal/arceus",
          options: {
            maxLines: 200,
            embed: true,
            paths: null
          }
        })
        .expect(200);

      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("Indexing complete");
      expect(response.body).toHaveProperty("graph");
      expect(response.body).toHaveProperty("embeddings");
    }, 60000); // Increase timeout for embedding

    it("should handle invalid repo format", async () => {
      const response = await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "invalid-repo-format",
          options: {
            maxLines: 200,
            embed: false,
            paths: null
          }
        })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

  });

  describe("POST /api/indexing/search", () => {
    beforeEach(async () => {
      // Index a repo with embeddings first
      await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "rajansagarwal/arceus",
          options: {
            maxLines: 200,
            embed: true,
            paths: null
          }
        });
    }, 60000);

    it("should search for code with basic query", async () => {
      const response = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "function authentication",
          namespace: testNamespace
        })
        .expect(200);

      expect(response.body).toHaveProperty("matches");
      expect(Array.isArray(response.body.matches)).toBe(true);
    });

    it("should search with custom topK parameter", async () => {
      const response = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "function authentication",
          namespace: testNamespace,
          topK: 5
        })
        .expect(200);

      expect(response.body).toHaveProperty("matches");
      expect(response.body.matches.length).toBeLessThanOrEqual(5);
    });

    it("should search with specific fields", async () => {
      const response = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "function authentication",
          namespace: testNamespace,
          topK: 3,
          fields: ["code", "path", "name"]
        })
        .expect(200);

      expect(response.body).toHaveProperty("matches");
      // Check that returned matches have the requested fields
      if (response.body.matches.length > 0) {
        const firstMatch = response.body.matches[0];
        expect(firstMatch).toHaveProperty("metadata");
      }
    });

    it("should handle empty search query", async () => {
      const response = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "",
          namespace: testNamespace
        })
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should handle non-existent namespace", async () => {
      const response = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "function authentication",
          namespace: "non-existent-namespace"
        })
        .expect(200);

      // Should return empty results, not error
      expect(response.body).toHaveProperty("matches");
      expect(response.body.matches).toEqual([]);
    });
  });

  describe("DELETE /api/indexing/clear-namespace", () => {
    beforeEach(async () => {
      // Index a repo to have something to clear
      await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "rajansagarwal/arceus",
          options: {
            maxLines: 200,
            embed: true,
            paths: null
          }
        });
    }, 60000);

    it("should clear a namespace successfully", async () => {
      const response = await request(app)
        .delete("/api/indexing/clear-namespace")
        .send({
          namespace: testNamespace
        })
        .expect(200);

      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Namespace cleared");

      // Verify namespace is empty by searching
      const searchResponse = await request(app)
        .post("/api/indexing/search")
        .send({
          query: "function authentication",
          namespace: testNamespace
        });

      expect(searchResponse.body.matches).toEqual([]);
    });

    it("should handle clearing non-existent namespace", async () => {
      const response = await request(app)
        .delete("/api/indexing/clear-namespace")
        .send({
          namespace: "non-existent-namespace"
        })
        .expect(200);

      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toBe("Namespace cleared");
    });

    it("should require namespace parameter", async () => {
      const response = await request(app)
        .delete("/api/indexing/clear-namespace")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("Embedding Integration Tests", () => {
    it("should embed different types of code chunks", async () => {
      const response = await request(app)
        .post("/api/indexing/index")
        .send({
          repo: "rajansagarwal/arceus",
          options: {
            maxLines: 50, // Smaller chunks for testing
            embed: true,
            paths: null
          }
        })
        .expect(200);

      expect(response.body).toHaveProperty("embeddings");
      expect(response.body.embeddings).toHaveProperty("index");
      expect(response.body.embeddings).toHaveProperty("binary");

      // Test that we can search different types of code
      const searchTests = [
        "function",
        "class",
        "import",
        "export",
        "variable"
      ];

      for (const query of searchTests) {
        const searchResponse = await request(app)
          .post("/api/indexing/search")
          .send({
            query,
            namespace: testNamespace,
            topK: 2
          });

        expect(searchResponse.status).toBe(200);
        expect(searchResponse.body).toHaveProperty("matches");
      }
    }, 90000); // Longer timeout for multiple searches
  });
});
