import { NextResponse } from 'next/server'

const AD_ACCOUNT_IDS = process.env.META_AD_ACCOUNT_IDS?.split(',') || []

// Each ad account is owned by a different Meta user, so each needs its own token
const TOKEN_MAP: Record<string, string> = {
  'act_1522822892393841': process.env.META_ACCESS_TOKEN || '',
  'act_1068009471269554': process.env.META_ACCESS_TOKEN_2 || '',
}

// Fetch with automatic retry on failure (network errors AND non-ok HTTP responses)
async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return res
      // Non-ok response (rate limit, server error) — retry unless last attempt
      if (i === retries - 1) return res
    } catch (err) {
      if (i === retries - 1) throw err
    }
    await new Promise(r => setTimeout(r, 500 * (i + 1))) // wait 500ms, 1s, 1.5s
  }
  throw new Error(`Failed after ${retries} retries`)
}

export async function GET() {
  try {
    // Fetch all ad accounts in parallel instead of one by one
    const results = await Promise.allSettled(
      AD_ACCOUNT_IDS.map(async (accountId) => {
        const token = TOKEN_MAP[accountId] || process.env.META_ACCESS_TOKEN || ''
        const url = `https://graph.facebook.com/v19.0/${accountId}/campaigns?fields=id,name,status,objective&limit=100&access_token=${token}`
        const res = await fetchWithRetry(url)
        const data = await res.json()

        if (data.error) {
          console.error(`Meta API error for ${accountId}:`, data.error)
          return []
        }

        return (data.data || []).map((c: object) => ({
          ...c,
          ad_account_id: accountId,
        }))
      })
    )

    // Collect all campaigns from successful requests
    const allCampaigns = results.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    )

    // Log any failures for debugging
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`Failed to fetch campaigns for account ${AD_ACCOUNT_IDS[i]}:`, result.reason)
      }
    })

    return NextResponse.json(
      { campaigns: allCampaigns, total: allCampaigns.length },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        }
      }
    )
  } catch (error) {
    console.error('Meta campaigns fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns', campaigns: [] }, { status: 500 })
  }
}
