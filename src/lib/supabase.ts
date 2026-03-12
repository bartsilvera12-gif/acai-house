import { createBrowserClient } from "@supabase/auth-helpers-nextjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) console.error("[Supabase] NEXT_PUBLIC_SUPABASE_URL no está definida");
if (!supabaseKey) console.error("[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY no está definida");

/** Cliente Supabase que persiste la sesión en cookies (necesario para que la API lea la sesión). */
export const supabase = createBrowserClient(supabaseUrl!, supabaseKey!);
