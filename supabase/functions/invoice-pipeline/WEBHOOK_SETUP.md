# Invoice Pipeline — Webhook Setup Guide

This document explains how to configure the Supabase Database Webhook that triggers
the Invoice Pipeline Edge Function automatically when a new invoice is uploaded.

## Overview

The pipeline is triggered via a **Supabase Database Webhook** on the `invoices` table.
When a new invoice is inserted with `status = 'uploaded'`, the webhook fires a POST
request to the `invoice-pipeline` Edge Function.

**Architecture:** §2.2 of `architecture-invoice-cogs.md`

---

## Prerequisites

Before configuring the webhook, ensure:

1. The Edge Function is deployed:
   ```bash
   supabase functions deploy invoice-pipeline --project-ref <your-project-ref>
   ```

2. Required environment variables are set in the Edge Function secrets
   (Supabase Dashboard → Edge Functions → invoice-pipeline → Secrets):

   | Variable | Description |
   |----------|-------------|
   | `SUPABASE_URL` | Your Supabase project URL (usually auto-injected) |
   | `SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |
   | `OPENROUTER_API_KEY` | OpenRouter API key for GPT-4o Vision calls |
   | `NEXTJS_BASE_URL` | Base URL of your Next.js/Vercel deployment (e.g. `https://app.yourdomain.com`) |
   | `PIPELINE_WEBHOOK_SECRET` | (Optional) Shared secret for webhook authentication |

---

## Step-by-Step Configuration

### 1. Open the Supabase Dashboard

Navigate to: **Supabase Dashboard** → Your Project → **Database** → **Webhooks**

### 2. Create a New Webhook

Click **"Create a new hook"** and fill in the following:

#### Basic Settings

| Field | Value |
|-------|-------|
| **Name** | `invoice-pipeline-trigger` |
| **Table** | `public.invoices` |
| **Events** | ✅ `INSERT` only (uncheck UPDATE and DELETE) |

#### HTTP Request Settings

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `https://<your-project-ref>.supabase.co/functions/v1/invoice-pipeline` |

Replace `<your-project-ref>` with your actual Supabase project reference ID
(found in Project Settings → General → Reference ID).

#### HTTP Headers

Add the following headers:

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <your-pipeline-webhook-secret>` |

> **Note:** The `Authorization` header value should match the `PIPELINE_WEBHOOK_SECRET`
> environment variable set in the Edge Function secrets. If you don't use a secret,
> Supabase will use its internal service role for Edge Function authentication.

#### Row Filter (Optional but Recommended)

If your Supabase version supports row-level webhook filters:

- **Column:** `status`
- **Operator:** `eq`
- **Value:** `uploaded`

This prevents unnecessary Edge Function invocations for invoices inserted with
other statuses. If filters are not available in your dashboard version, the Edge
Function entry point (`index.ts`) already filters by `status = 'uploaded'`.

### 3. Save the Webhook

Click **"Create webhook"** to save.

---

## Verification

### Test the Webhook

1. Upload a test invoice via the CafePulse admin UI or directly via the API:
   ```bash
   curl -X POST https://your-app.vercel.app/api/admin/invoices/upload \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <admin-token>" \
     -d '{"supplier_id": "...", "file_url": "..."}'
   ```

2. Monitor the Edge Function logs in Supabase Dashboard → Edge Functions → invoice-pipeline → Logs

3. Verify the invoice's `pipeline_stage` progresses through:
   ```
   extracting → resolving_supplier → matching_po → matching_items → confirming → completed
   ```

### Check Webhook Delivery

In Supabase Dashboard → Database → Webhooks → invoice-pipeline-trigger:
- View delivery history (success/failure status for each invocation)
- See retry attempts if the Edge Function returned a 5xx status

---

## Retry Behavior

Supabase Database Webhooks retry failed deliveries up to **3 times** with exponential backoff.
The pipeline is **idempotent** — if the webhook fires twice for the same invoice,
the second invocation will detect the invoice is already claimed (`status != 'uploaded'`)
and exit immediately without processing.

---

## Troubleshooting

### Webhook Not Firing

- Verify the webhook event is `INSERT` (not UPDATE/DELETE)
- Confirm the table is `public.invoices` (not just `invoices`)
- Check that new invoices are inserted with `status = 'uploaded'` by the upload route

### Edge Function Returns 401

- Check that the `Authorization` header value matches `PIPELINE_WEBHOOK_SECRET`
- If no secret is set, remove the `Authorization` header from the webhook config

### Edge Function Returns 500

- Check Edge Function logs for error details
- Verify `OPENROUTER_API_KEY` is set correctly
- Verify `NEXTJS_BASE_URL` points to a deployed Next.js instance
- Check that `SERVICE_ROLE_KEY` is the service role key (not anon key)

### Pipeline Stuck at Stage

- Check `invoices.pipeline_stage` and `invoices.pipeline_error` columns
- Check `invoice_exceptions` table for any exceptions created
- If `status = 'error'`, retry via: `POST /api/admin/invoices/[id]/retry-pipeline`

---

## Environment Variable Secrets (Supabase Dashboard)

To set secrets for the Edge Function:

```bash
# Using Supabase CLI:
supabase secrets set OPENROUTER_API_KEY=<your-key> --project-ref <your-project-ref>
supabase secrets set NEXTJS_BASE_URL=https://your-app.vercel.app --project-ref <your-project-ref>
supabase secrets set PIPELINE_WEBHOOK_SECRET=<random-secret> --project-ref <your-project-ref>
```

Or set them in: **Dashboard → Edge Functions → invoice-pipeline → Secrets**

---

## Production Checklist

- [ ] Edge Function deployed: `supabase functions deploy invoice-pipeline`
- [ ] `OPENROUTER_API_KEY` secret set
- [ ] `NEXTJS_BASE_URL` secret set (points to Vercel deployment)
- [ ] `PIPELINE_WEBHOOK_SECRET` set (optional but recommended)
- [ ] Database webhook created for `public.invoices` INSERT events
- [ ] Webhook URL verified with correct project reference ID
- [ ] Test invoice processed successfully end-to-end
- [ ] Edge Function logs reviewed for any errors

---

*For architecture details, see `architecture-invoice-cogs.md` §2.2*
