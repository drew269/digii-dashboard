import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Page token lookup by page ID
const PAGE_TOKENS: Record<string, string> = {
  '875226682335450': process.env.META_PAGE_TOKEN_DIGII || '',
  '510581748796983': process.env.META_PAGE_TOKEN_UNIQUE || '',
}

interface LeadFieldData { name: string; values: string[] }

// ─── GET — Meta webhook verification ─────────────────────────────────────────
// When you register the webhook in Meta dashboard, Meta calls this to confirm
// you own the endpoint. Respond with the challenge value to verify.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] Meta verification successful')
    return new Response(challenge, { status: 200 })
  }

  console.warn('[webhook] Meta verification failed — token mismatch')
  return new Response('Forbidden', { status: 403 })
}

// ─── POST — Receive lead events from Meta ─────────────────────────────────────
// Meta sends this every time someone submits a lead ad form on one of your pages.
// Payload structure: { entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id, form_id, page_id } }] }] }
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Verify the request is genuinely from Meta using HMAC-SHA256 signature
  const signature = request.headers.get('x-hub-signature-256') || ''
  const appSecret = process.env.META_APP_SECRET || ''

  if (!appSecret) {
    console.error('[webhook] META_APP_SECRET not set — cannot verify signature')
    return new Response('Server misconfigured', { status: 500 })
  }

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')

  if (signature !== expected) {
    console.warn('[webhook] Invalid signature — request rejected')
    return new Response('Invalid signature', { status: 401 })
  }

  let body: {
    entry?: {
      changes?: {
        field: string
        value: { leadgen_id: string; form_id: string; page_id: string }
      }[]
    }[]
  }

  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const admin = createAdminClient()

  // Load form→campaign mappings from DB
  const { data: mappingRows } = await admin
    .from('form_campaign_mappings')
    .select('form_id, campaign_id')

  const { data: campaignRows } = await admin
    .from('campaigns')
    .select('meta_campaign_id, campaign_name')

  // Build lookup: formId → { campaignId, campaignName }
  const formMap = new Map<string, { campaignId: string; campaignName: string }>()
  for (const m of mappingRows || []) {
    const campaign = campaignRows?.find(c => c.meta_campaign_id === m.campaign_id)
    if (campaign) {
      formMap.set(m.form_id, {
        campaignId: campaign.meta_campaign_id,
        campaignName: campaign.campaign_name,
      })
    }
  }

  let inserted = 0

  // Process each lead event
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue

      const { leadgen_id, form_id, page_id } = change.value

      // Get the page token for this page
      const pageToken = PAGE_TOKENS[page_id]
      if (!pageToken) {
        console.warn(`[webhook] No page token for page ${page_id} — skipping lead ${leadgen_id}`)
        continue
      }

      // Fetch full lead data from Meta
      const leadRes = await fetch(
        `https://graph.facebook.com/v19.0/${leadgen_id}?fields=id,created_time,field_data&access_token=${pageToken}`
      )
      const lead = await leadRes.json() as {
        id: string
        created_time: string
        field_data: LeadFieldData[]
        error?: { message: string }
      }

      if (lead.error) {
        console.error(`[webhook] Failed to fetch lead ${leadgen_id}:`, lead.error.message)
        continue
      }

      // Look up which campaign this form belongs to
      const assignment = formMap.get(form_id)
      if (!assignment) {
        console.warn(`[webhook] Form ${form_id} not mapped to any campaign — skipping lead ${leadgen_id}`)
        continue
      }

      // Extract contact fields
      const fields: Record<string, string> = {}
      for (const f of lead.field_data || []) fields[f.name] = f.values?.[0] || ''

      const fullName =
        fields['full_name'] || fields['name'] ||
        [fields['first_name'], fields['last_name']].filter(Boolean).join(' ') || null
      const email = fields['email'] || fields['email_address'] || null
      const phone = fields['phone_number'] || fields['phone'] || fields['mobile_number'] || null

      // Insert into Supabase — unique constraint on meta_lead_id handles duplicates
      const { error } = await admin.from('leads').insert({
        meta_lead_id: lead.id,
        campaign_id: assignment.campaignId,
        campaign_name: assignment.campaignName,
        form_id,
        full_name: fullName,
        email,
        phone,
        created_at: lead.created_time,
        synced_at: new Date().toISOString(),
        raw_data: { id: lead.id, field_data: lead.field_data },
      })

      if (error && error.code !== '23505') {
        console.error(`[webhook] Insert error for lead ${leadgen_id}:`, error.message)
      } else if (!error) {
        console.log(`[webhook] ✅ New lead: ${fullName || 'Unknown'} → campaign "${assignment.campaignName}"`)
        inserted++
      }
    }
  }

  console.log(`[webhook] Done — ${inserted} new lead(s) inserted`)

  // Always return 200 quickly — Meta will retry if we don't respond fast enough
  return new Response('OK', { status: 200 })
}
