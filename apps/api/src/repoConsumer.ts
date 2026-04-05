import { JSONCodec, connect } from "nats";
import { Pool } from "pg";

const chunkText = (text: string, size = 800): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
};

// Safe: JSON string → $N::text::vector (fully parameterized, no string interpolation)
const toVectorText = (vector: number[]): string => JSON.stringify(vector);

const embed = async (texts: string[]): Promise<number[][]> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input: texts })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`embeddings_failed ${response.status} ${errText}`);
  }
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((item) => item.embedding);
};

export const startRepoConsumer = async () => {
  const nats = await connect({ servers: process.env.NATS_SERVERS ?? "nats://localhost:4222" });
  const codec = JSONCodec<Record<string, unknown>>();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const sub = nats.subscribe("tenant.*.repo.ingest");
  console.log("[repo-consumer] Listening on tenant.*.repo.ingest");

  (async () => {
    for await (const msg of sub) {
      try {
        const payload = codec.decode(msg.data) as { projectId: string; content: string; filename: string };

        // 1. Store repo file
        await pool.query(
          "INSERT INTO repo_files (project_id, filename, content) VALUES ($1, $2, $3)",
          [payload.projectId, payload.filename, payload.content]
        );

        // 2. Chunk & embed
        const chunks = chunkText(payload.content, 800);
        const vectors = await embed(chunks);

        // 3. Batch insert embeddings — single query, parameterized
        const rows: Array<[string, string, string]> = chunks.map((c, i) => [
          payload.projectId,
          c,
          toVectorText(vectors[i]),
        ]);

        for (let i = 0; i < rows.length; i++) {
          const [projectId, content, vectorText] = rows[i];
          await pool.query(
            "INSERT INTO embeddings (project_id, content, embedding) VALUES ($1, $2, $3::text::vector)",
            [projectId, content, vectorText]
          );
        }

        console.log(`[repo-consumer] Ingested ${payload.filename}: ${chunks.length} chunks for project ${payload.projectId}`);
      } catch (err) {
        // Log error but keep the consumer alive
        console.error("[repo-consumer] Error processing message:", err);
      }
    }
  })();
};
