import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Page tokens — used to list ALL lead gen forms and fetch leads
const PAGE_CONFIGS = [
  { pageId: '875226682335450', token: process.env.META_PAGE_TOKEN_DIGII || '', label: 'Digii Solution' },
  { pageId: '510581748796983', token: process.env.META_PAGE_TOKEN_UNIQUE || '', label: 'The Unique' },
]

interface LeadFieldData { name: string; values: string[] }
interface MetaLead { id: string; created_time: string; field_data: LeadFieldData[] }

// ─── Pull and store all leads from a single form ──────────────────────────────
async function syncFormLeads(
  admin: ReturnType<typeof createAdminClient>,
  formId: string,
  campaignId: string,
  campaignName: string,
  pageToken: string
): Promise<{ synced: number; skipped: number; error?: string }> {
  let synced = 0, skipped = 0

  let url: string | null =
    `https://graph.facebook.com/v19.0/${formId}/leads?fields=id,created_time,field_data&limit=100&access_token=${pageToken}`

  while (url) {
    const res = await fetch(url)
    const data = await res.json() as {
      data?: MetaLead[]
      paging?: { next?: string }
      error?: { message: string }
    }

    if (data.error) {
      return { synced, skipped, error: data.error.message }
    }

    for (const lead of data.data || []) {
      const fields: Record<string, string> = {}
      for (const f of lead.field_data || []) fields[f.name] = f.values?.[0] || ''

      const fullName =
        fields['full_name'] || fields['name'] ||
        [fields['first_name'], fields['last_name']].filter(Boolean).join(' ') || null
      const email = fields['email'] || fields['email_address'] || null
      const phone = fields['phone_number'] || fields['phone'] || fields['mobile_number'] || null

      const { error } = await admin.from('leads').insert({
        meta_lead_id: lead.id,
        campaign_id: campaignId,
        campaign_name: campaignName,
        form_id: formId,
        full_name: fullName,
        email,
        phone,
        created_at: lead.created_time,
        synced_at: new Date().toISOString(),
        raw_data: { id: lead.id, field_data: lead.field_data },
      })

      if (error?.code === '23505') skipped++      // already exists — fine
      else if (error) skipped++
      else synced++
    }

    url = data.paging?.next || null
  }

  return { synced, skipped }
}

// ─── POST /api/meta/leads — Sync leads ───────────────────────────────────────
// How it works:
//   1. List ALL lead gen forms on every page using page tokens
//   2. Look up each form's campaign in form_campaign_mappings table
//   3. Fetch and store all leads, tagged to the correct campaign
//
// This is reliable because it covers every form ever created on the page,
// not just ones attached to currently active ads.
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || ''
  const isCron = cronSecret && request.headers.get('x-cron-secret') === cronSecret

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Load form→campaign mappings from DB
  const { data: mappingRows } = await admin
    .from('form_campaign_mappings')
    .select('form_id, campaign_id')

  const { data: campaignRows } = await admin
    .from('campaigns')
    .select('meta_campaign_id, campaign_name')

  // Build a fast lookup: formId → { campaignId, campaignName }
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

  let totalSynced = 0
  let totalSkipped = 0
  let formsSynced = 0
  let formsSkipped = 0
  const errors: string[] = []

  // Step through every page and every form on it
  for (const page of PAGE_CONFIGS) {
    if (!page.token) {
      errors.push(`No token for page: ${page.label}`)
      continue
    }

    // List all forms on this page
    let formsUrl: string | null =
      `https://graph.facebook.com/v19.0/${page.pageId}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${page.token}`

    while (formsUrl) {
      const res = await fetch(formsUrl)
      const data = await res.json() as {
        data?: { id: string; name: string; leads_count?: number }[]
        paging?: { next?: string }
        error?: { message: string }
      }

      if (data.error) {
        errors.push(`${page.label} forms: ${data.error.message}`)
        break
      }

      for (const form of data.data || []) {
        if (!form.leads_count || form.leads_count === 0) continue  // skip empty forms

        const assignment = formMap.get(form.id)
        if (!assignment) {
          // Not mapped yet — skip but log it
          console.log(`[sync] Form "${form.name}" (${form.id}) not mapped — skipping`)
          formsSkipped++
          continue
        }

        console.log(`[sync] Form "${form.name}" → campaign "${assignment.campaignName}"`)
        const result = await syncFormLeads(admin, form.id, assignment.campaignId, assignment.campaignName, page.token)

        if (result.error) {
          errors.push(`Form "${form.name}": ${result.error}`)
        }

        totalSynced += result.synced
        totalSkipped += result.skipped
        formsSynced++
      }

      formsUrl = data.paging?.next || null
    }
  }

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    skipped: totalSkipped,
    forms_synced: formsSynced,
    forms_not_mapped: formsSkipped,
    errors: errors.length > 0 ? errors : undefined,
  })
}

// ─── GET /api/meta/leads?campaign_ids=123,456 ────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  const { searchParams } = new URL(request.url)
  const campaignIds = searchParams.get('campaign_ids')
  if (!campaignIds) return NextResponse.json({ error: 'campaign_ids required' }, { status: 400 })

  const requestedIds = campaignIds.split(',').filter(Boolean)
  const admin = createAdminClient()
  let allowedIds = requestedIds

  if (profile?.role !== 'admin') {
    const { data: assignments } = await admin
      .from('client_campaigns')
      .select('campaigns(meta_campaign_id)')
      .eq('client_id', user.id)

    const assignedIds = (assignments as unknown as { campaigns: { meta_campaign_id: string } | null }[])
      ?.map(a => a.campaigns?.meta_campaign_id)
      .filter(Boolean) as string[]

    allowedIds = requestedIds.filter(id => assignedIds.includes(id))
  }

  if (allowedIds.length === 0) return NextResponse.json({ leads: [] })

  const { data: leads, error } = await admin
    .from('leads')
    .select('id, campaign_id, campaign_name, full_name, email, phone, created_at, synced_at, pipeline_stage')
    .in('campaign_id', allowedIds)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })

  return NextResponse.json({ leads: leads || [] })
}
