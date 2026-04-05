declare module "fastify" {
  interface FastifyInstance {
    authenticate: any;
  }

  interface FastifyRequest {
    user?: { userId: string };
    apiKeyId?: string;
    apiKeyRole?: "owner" | "editor" | "viewer";
    apiKeyProjectId?: string | null;
  }
}
