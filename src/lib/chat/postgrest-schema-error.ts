/** Errores típicos cuando PostgREST no tiene el schema en la lista permitida (Supabase API → Exposed schemas). */
export function isInvalidPostgrestSchemaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("invalid schema") ||
    m.includes("pgrst106") ||
    m.includes("schema must be one of") ||
    m.includes("schema debe ser uno de") ||
    m.includes("the schema must be one of")
  );
}
