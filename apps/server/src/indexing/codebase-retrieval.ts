import PineconeHandler from "./embedding/pineconeService";
import {
  CodebaseSearchRequest,
  CodebaseSearchResponse,
} from "./codebase-types";

// Codebase retrieval for fine-grained code search
export async function retrieveCodeChunks(
  request: CodebaseSearchRequest
): Promise<CodebaseSearchResponse[]> {
  const pinecone = new PineconeHandler("shadow");

  return await pinecone.searchRecords(request);
}
