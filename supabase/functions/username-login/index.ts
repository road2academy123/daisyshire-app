import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  try {
    const { username, password } = await req.json();

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.length < 3 ||
      username.length > 20 ||
      password.length < 1 ||
      password.length > 128 ||
      !/^[a-zA-Z0-9_]+$/.test(username)
    ) {
      return respond({ error: "Invalid username or password." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!url || !anonKey || !serviceKey) {
      console.error("Required server configuration is missing.");
      return respond({ error: "Login service is unavailable." }, 500);
    }

    const admin = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const auth = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username.toLowerCase())
      .maybeSingle();

    if (profileError || !profile) {
      return respond({ error: "Invalid username or password." }, 401);
    }

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(profile.id);

    const email = userData?.user?.email;

    if (userError || !email) {
      return respond({ error: "Invalid username or password." }, 401);
    }

    const { data, error } = await auth.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return respond({ error: "Invalid username or password." }, 401);
    }

    return respond({
      session: data.session,
      user: data.user,
    });
  } catch (error) {
    console.error("Username login request failed:", error);
    return respond({ error: "Unable to complete login." }, 500);
  }
});
