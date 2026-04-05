-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ephemeral', 'vector', 'persistent')),
  content TEXT NOT NULL,
  embedding vector(1536),
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_records_kind_idx ON memory_records(kind);
CREATE INDEX IF NOT EXISTS memory_records_tags_gin ON memory_records USING GIN(tags);
CREATE INDEX IF NOT EXISTS memory_records_embedding_idx ON memory_records USING ivfflat (embedding vector_cosine_ops);
