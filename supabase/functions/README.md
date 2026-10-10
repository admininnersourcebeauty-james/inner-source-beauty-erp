# Supabase Edge Functions — Staff Management

Deploy from `ISB_ERP_V1_PROPER/`:

```bash
supabase login
supabase link --project-ref 9c8c4cff
supabase functions deploy admin-create-user
supabase functions deploy admin-update-user
```

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically.
Never put the service role key in the React client.

| Function | Purpose |
|----------|---------|
| `admin-create-user` | Admin-only: create auth user + profile |
| `admin-update-user` | Admin-only: update profile, optional password reset |
