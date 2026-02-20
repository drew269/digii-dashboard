import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Each ad account is owned by a different Meta user — use the right token per account
const TOKEN_MAP: Record<string, string> = {
  'act_1522822892393841': process.env.META_ACCESS_TOKEN || '',
  'act_1068009471269554': process.env.META_ACCESS_TOKEN_2 || '',
}
const DEFAULT_TOKEN = process.env.META_ACCESS_TOKEN || ''

export async function GET(request: NextRequest) {
  // Auth check — only authenticated users can fetch metrics
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const campaignIds = searchParams.get('campaign_ids')
  const dateRange = searchParams.get('date_range') || 'last_30d'

  if (!campaignIds) {
    return NextResponse.json({ error: 'campaign_ids required' }, { status: 400 })
  }

  try {
    const ids = campaignIds.split(',')
    const allInsights = []

    // Look up which ad account each campaign belongs to so we can use the right token
    const { data: campaignRows } = await supabase
      .from('campaigns')
      .select('meta_campaign_id, meta_ad_account_id')
      .in('meta_campaign_id', ids)

    const accountMap: Record<string, string> = {}
    for (const row of campaignRows || []) {
      accountMap[row.meta_campaign_id] = row.meta_ad_account_id
    }

    for (const campaignId of ids) {
      const adAccountId = accountMap[campaignId] || ''
      const token = TOKEN_MAP[adAccountId] || DEFAULT_TOKEN
      const url = `https://graph.facebook.com/v19.0/${campaignId}/insights?fields=campaign_name,spend,impressions,reach,clicks,actions,cost_per_action_type&date_preset=${dateRange}&access_token=${token}`
      const res = await fetch(url)
      const data = await res.json()

      if (data.error) {
        console.error(`Meta insights error for campaign ${campaignId}:`, data.error)
        continue
      }

      if (data.data && data.data.length > 0) {
        const insight = data.data[0]

        // Extract leads from actions
        const leadAction = insight.actions?.find(
          (a: { action_type: string }) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
        )
        const leads = leadAction ? parseInt(leadAction.value) : 0

        // Extract cost per lead
        const cplAction = insight.cost_per_action_type?.find(
          (a: { action_type: string }) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
        )
        const costPerLead = cplAction ? parseFloat(cplAction.value) : 0

        const impressions = parseInt(insight.impressions || '0')
        const clicks = parseInt(insight.clicks || '0')
        allInsights.push({
          campaign_id: campaignId,
          campaign_name: insight.campaign_name,
          spend: parseFloat(insight.spend || '0'),
          leads,
          cost_per_lead: costPerLead,
          impressions,
          reach: parseInt(insight.reach || '0'),
          clicks,
          ctr: impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0,
        })
      } else {
        // No data yet - return zeros
        allInsights.push({
          campaign_id: campaignId,
          campaign_name: `Campaign ${campaignId}`,
          spend: 0,
          leads: 0,
          cost_per_lead: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          ctr: 0,
        })
      }
    }

    // Aggregate totals
    const totals = allInsights.reduce(
      (acc, curr) => ({
        total_spend: acc.total_spend + curr.spend,
        total_leads: acc.total_leads + curr.leads,
        total_cost_per_lead: 0, // calculated below
        total_impressions: acc.total_impressions + curr.impressions,
        total_reach: acc.total_reach + curr.reach,
        total_clicks: acc.total_clicks + curr.clicks,
      }),
      { total_spend: 0, total_leads: 0, total_cost_per_lead: 0, total_impressions: 0, total_reach: 0, total_clicks: 0 }
    )

    totals.total_cost_per_lead =
      totals.total_leads > 0
        ? parseFloat((totals.total_spend / totals.total_leads).toFixed(2))
        : 0

    return NextResponse.json({
      campaigns: allInsights,
      totals,
      last_updated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Meta metrics fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }
}
