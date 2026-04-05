/**
 * 002_embeddings.sql — pgvector migration
 *
 * Create code_embeddings table with vector index for semantic search.
 * Requires: CREATE EXTENSION vector; (in extension step)
 */

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Code embeddings table
CREATE TABLE IF NOT EXISTS code_embeddings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id      text NOT NULL,
    file_id       text NOT NULL,
    project_id    uuid NOT NULL,
    file_path     text NOT NULL,
    content       text NOT NULL,
    language      text NOT NULL,
    start_line    integer NOT NULL,
    end_line      integer NOT NULL,
    embedding     vector(1536) NOT NULL,
    embedding_dim integer NOT NULL,
    model         text NOT NULL DEFAULT 'text-embedding-3-small',
    tokens        integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),

    -- Foreign keys
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX idx_embeddings_project ON code_embeddings(project_id);
CREATE INDEX idx_embeddings_file ON code_embeddings(file_id);

-- HNSW index for fast semantic search (cosine distance)
-- Requires pgvector 0.5.0+
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
    ON code_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Fallback FTS index
CREATE INDEX IF NOT EXISTS idx_embeddings_fts
    ON code_embeddings
    USING gin (to_tsvector('english', content));
