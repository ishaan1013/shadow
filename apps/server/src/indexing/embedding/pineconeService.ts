import { Pinecone, Index } from '@pinecone-database/pinecone'
import { GraphNode } from '../graph';
import logger from '../logger';

interface CodeBlockRecord {
    id: string;
    line_start: number;
    line_end: number;
    text: string;
}
class PineconeHandler {
    public pc: Pinecone;
    private client: Index;
    private embeddingModel: string;
    private indexName: string;
    // Hardcoded to shadow index for now
    constructor(indexName: string = "shadow") {
        this.pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
        this.indexName = indexName;
        this.client = this.pc.Index(this.indexName);
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

    async clearNamespace(namespace: string): Promise<number> {
        try {
            await this.client.namespace(namespace).deleteAll();
            logger.info(`Namespace "${namespace}" cleared`);
            return 1;
        } catch (err) {
            logger.warn(`Failed to clear namespace "${namespace}": ${err}`);
            return 0;
        }
    }

    async upsertAutoEmbed(records: any[], namespace: string): Promise<number> {
        try {            
            // Convert to upsertRecords format and filter out empty text
            const autoEmbedRecords = records
                .filter(record => {
                    const text = record.metadata.code || record.metadata.text || "";
                    if (!text.trim()) {
                        console.log(`Skipping record ${record.id} - no text to embed`);
                        return false;
                    }
                    return true;
                })
                .map(record => ({
                    _id: record.id,
                    text: record.metadata.code || record.metadata.text || "",
                    ...record.metadata
                }));

            if (autoEmbedRecords.length === 0) {
                logger.info("No records with text to upsert, skipping batch");
                return 0;
            }

            logger.info(`Upserting ${autoEmbedRecords.length} records with text (filtered from ${records.length})`);
            
            // Use upsertRecords for auto-embedding
            await this.client.namespace(namespace).upsertRecords(autoEmbedRecords);
            return autoEmbedRecords.length;
        } catch (error) {
            logger.error(`Error upserting records: ${error}`);
            throw error;    
        }
    }

    async chunkRecords(records: GraphNode[], maxLinesPerChunk = 50, maxRecordsPerBatch = 100): Promise<GraphNode[][]> {
        const chunks: GraphNode[][] = [];
        let currentChunk: GraphNode[] = [];
        let currentLineSpan = 0;
        
        for (const record of records) {
            const lineSpan = (record.loc?.endLine || 0) - (record.loc?.startLine || 0) + 1;
            
            const pathChanged = currentChunk.length > 0 && 
                currentChunk[0]?.path !== record.path;
            
            if (currentChunk.length >= maxRecordsPerBatch || 
                currentLineSpan + lineSpan > maxLinesPerChunk ||
                pathChanged) {
                if (currentChunk.length > 0) {
                    chunks.push([...currentChunk]);
                    currentChunk = [];
                    currentLineSpan = 0;
                }
            }
            
            currentChunk.push(record);
            currentLineSpan += lineSpan;
        }
        
        // Add final chunk
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    async searchRecords(query: string, namespace: string, topK: number = 3, fields: string[]) {
        const response = await this.client.namespace(namespace).searchRecords({
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