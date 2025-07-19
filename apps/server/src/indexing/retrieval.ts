import PineconeHandler from "@/indexing/embedding/pineconeService";

export async function retrieve(
    query: string, 
    namespace: string, 
    topK: number = 3, 
    fields: string[] = ["code", "path", "name"]
) {
    const pinecone = new PineconeHandler("shadow");
    const response = await pinecone.searchRecords(query, namespace, topK, fields);
    return response;
}