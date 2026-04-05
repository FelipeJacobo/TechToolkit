export default async (input: unknown): Promise<{ ok: boolean; echo: unknown }> => {
  return { ok: true, echo: input };
};
