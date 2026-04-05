import { JSONCodec, connect } from "nats";
import { Pool } from "pg";

const chunkText = (text: string, size = 800): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
};

const toVectorLiteral = (vector: number[]): string => `[${vector.map((v) => v.toString()).join(",")}]`;

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
  (async () => {
    for await (const msg of sub) {
      const payload = codec.decode(msg.data) as { projectId: string; content: string; filename: string };
      await pool.query(
        "INSERT INTO repo_files (project_id, filename, content) VALUES ($1, $2, $3)",
        [payload.projectId, payload.filename, payload.content]
      );
      const chunks = chunkText(payload.content, 800);
      const vectors = await embed(chunks);
      for (let i = 0; i < chunks.length; i += 1) {
        await pool.query(
          "INSERT INTO embeddings (project_id, content, embedding) VALUES ($1, $2, $3::vector)",
          [payload.projectId, chunks[i], toVectorLiteral(vectors[i])]
        );
      }
    }
  })();
};
