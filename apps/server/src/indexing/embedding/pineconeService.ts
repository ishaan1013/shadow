import { Pinecone, Index } from '@pinecone-database/pinecone'

interface CodeBlockRecord {
    id: string;
    line_start: number;
    line_end: number;
    text: string;
}
class PineconeHandler {
    private pc: Pinecone;
    private client: Index;
    private embeddingModel: string;
    private indexName: string;
    private namespace: string;

    constructor(indexName: string, namespace: string) {
        this.pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
        this.indexName = indexName;
        this.namespace = namespace;
        this.client = this.pc.Index(this.indexName).namespace(this.namespace);
        this.embeddingModel = process.env.EMBEDDING_MODEL || 'llama-text-embed-v2'; // Default to llama-text-embed-v2
    }

    async createIndexForModel() {
        await this.pc.createIndexForModel({
            name: this.indexName,
            cloud: 'aws',
            region: 'us-east-1',    
            embed: {
                model: this.embeddingModel,
                fieldMap: { text: 'chunk_text' },
            },
            waitUntilReady: true,
        });
    }

    async upsertRecords(records: any[]): Promise<number> {
        await this.client.upsert(records);
        return records.length;
    }

    async chunkRecords(records: CodeBlockRecord[], chunkSize: number): Promise<CodeBlockRecord[][]> {
        const chunks: CodeBlockRecord[][] = [];
        for (let i = 0; i < records.length; i += chunkSize) {
            chunks.push(records.slice(i, i + chunkSize));
        }
        return chunks;
    }

    async searchRecords(query: string, topK: number = 3, fields: string[]) {
        const response = await this.client.searchRecords({
            query: {
            topK: 3,
            inputs: { text: query },
            },
            fields: fields
        });
        return response;
    }

}

export default PineconeHandler;