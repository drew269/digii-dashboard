import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_CONFIGS = [
  { pageId: '875226682335450', token: process.env.META_PAGE_TOKEN_DIGII || '', label: 'Digii Solution' },
  { pageId: '510581748796983', token: process.env.META_PAGE_TOKEN_UNIQUE || '', label: 'The Unique' },
]

// GET — returns all page forms + their current campaign mapping from Supabase
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Get all campaigns from DB
  const { data: campaigns } = await admin
    .from('campaigns')
    .select('meta_campaign_id, campaign_name, meta_ad_account_id')

  // Get existing form mappings
  const { data: mappings } = await admin
    .from('form_campaign_mappings')
    .select('form_id, campaign_id')

  const mappingLookup: Record<string, string> = {}
  for (const m of mappings || []) {
    mappingLookup[m.form_id] = m.campaign_id
  }

  // Fetch all forms from each page
  const allForms = []
  const pageErrors: string[] = []

  for (const page of PAGE_CONFIGS) {
    if (!page.token) {
      pageErrors.push(`${page.label}: no token configured`)
      continue
    }
    let nextUrl: string | null =
      `https://graph.facebook.com/v19.0/${page.pageId}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${page.token}`

    while (nextUrl) {
      const res: Response = await fetch(nextUrl)
      const data: { data?: { id: string; name: string; leads_count?: number }[]; error?: { message: string; code?: number }; paging?: { next?: string } } = await res.json()
      if (data.error) {
        pageErrors.push(`${page.label}: ${data.error.message}`)
        break
      }
      for (const form of (data.data || [])) {
        allForms.push({
          id: form.id,
          name: form.name,
          leads_count: form.leads_count || 0,
          page_label: page.label,
          campaign_id: mappingLookup[form.id] || null,
        })
      }
      nextUrl = data.paging?.next || null
    }
  }

  return NextResponse.json({ forms: allForms, campaigns: campaigns || [], pageErrors })
}

// POST — save a form→campaign mapping
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { form_id, campaign_id } = await request.json()
  if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 })

  const admin = createAdminClient()

  if (!campaign_id) {
    // Remove mapping
    await admin.from('form_campaign_mappings').delete().eq('form_id', form_id)
  } else {
    // Upsert mapping
    const { error } = await admin
      .from('form_campaign_mappings')
      .upsert({ form_id, campaign_id }, { onConflict: 'form_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
