import { app } from "../app";
import request from "supertest";
import { expect, describe, it } from "@jest/globals";

describe("Indexing API", () => {
  describe("GET /api/indexing/", () => {
    it("should return 200 and hello message", async () => {
      const response = await request(app).get("/api/indexing/").expect(200);

      expect(response.body).toEqual({ message: "Hello from indexing API!" });
    });
  });

  describe("GET /api/indexing/test", () => {
    it("should return 200 and test message", async () => {
      const response = await request(app).get("/api/indexing/test").expect(200);

      expect(response.body).toEqual({ message: "Hello from indexing API!" });
    });
  });

  describe("POST /api/indexing/tree-sitter", () => {
    it("should return 200 for JavaScript code", async () => {
      const response = await request(app)
        .post("/api/indexing/tree-sitter")
        .send({
          text: 'function hello() { console.log("world"); }',
          language: "javascript",
          filePath: "test.js",
        })
        .expect(200);

      expect(response.body).toHaveProperty("tree");
      expect(response.body.tree).toBeTruthy();
    });

    it("should return 200 for Python code", async () => {
      const response = await request(app)
        .post("/api/indexing/tree-sitter")
        .send({
          text: 'def hello():\n    print("world")',
          language: "python",
          filePath: "test.py",
        })
        .expect(200);
      expect(response.body).toHaveProperty("tree");
      expect(response.body.tree).toBeTruthy();
    });

    it("should return 400 for unsupported language", async () => {
      const response = await request(app)
        .post("/api/indexing/tree-sitter")
        .send({
          text: 'def hello():\n    print("world")',
          filePath: "test.px",
        })
        .expect(400);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Unsupported language");
    });
  });
});
