'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface CampaignMetric {
  campaign_id: string
  campaign_name: string
  spend: number
  leads: number
  cost_per_lead: number
  impressions: number
  reach: number
  clicks: number
  ctr: number
}

interface Totals {
  total_spend: number
  total_leads: number
  total_cost_per_lead: number
  total_impressions: number
  total_reach: number
  total_clicks: number
}

interface Profile {
  full_name: string
  email: string
}

interface Lead {
  id: string
  campaign_id: string
  campaign_name: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
}

const REFRESH_INTERVAL = 15 * 1000 // 15 seconds

export default function ClientDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignMetric[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('last_30d')
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000)
  const [activeTab, setActiveTab] = useState<'metrics' | 'leads'>('metrics')
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const router = useRouter()
  const supabase = createClient()

  const fetchMetrics = useCallback(async (ids: string[], range: string) => {
    if (ids.length === 0) return
    const res = await fetch(`/api/meta/metrics?campaign_ids=${ids.join(',')}&date_range=${range}`)
    const data = await res.json()
    if (!data.error) {
      setCampaigns(data.campaigns)
      setTotals(data.totals)
      setLastUpdated(data.last_updated)
      setCountdown(REFRESH_INTERVAL / 1000)
    }
  }, [])

  const fetchLeads = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setLeads([]); return }
    setLeadsLoading(true)
    try {
      const res = await fetch(`/api/meta/leads?campaign_ids=${ids.join(',')}`)
      const data = await res.json()
      if (!data.error) setLeads(data.leads || [])
    } catch (e) {
      console.error('Leads fetch error:', e)
    }
    setLeadsLoading(false)
  }, [])

  useEffect(() => {
    const loadDashboard = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Get profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .single()
      setProfile(profileData)

      // Get assigned campaigns
      const { data: assignments } = await supabase
        .from('client_campaigns')
        .select('campaigns(meta_campaign_id, campaign_name)')
        .eq('client_id', user.id)

      const ids = (assignments as unknown as { campaigns: { meta_campaign_id: string } | null }[])
        ?.map(a => a.campaigns?.meta_campaign_id)
        .filter(Boolean) as string[]

      setCampaignIds(ids || [])

      if (ids && ids.length > 0) {
        await fetchMetrics(ids, dateRange)
      }

      setLoading(false)
    }

    loadDashboard()
  }, [dateRange, fetchMetrics, router, supabase])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: assignments } = await supabase
        .from('client_campaigns')
        .select('campaigns(meta_campaign_id)')
        .eq('client_id', user.id)
      const ids = (assignments as unknown as { campaigns: { meta_campaign_id: string } | null }[])
        ?.map(a => a.campaigns?.meta_campaign_id)
        .filter(Boolean) as string[]
      if (ids?.length > 0) {
        await fetchMetrics(ids, dateRange)
      }
    }, REFRESH_INTERVAL)

    return () => clearInterval(interval)
  }, [dateRange, fetchMetrics, supabase])

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL / 1000 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-blue-300">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-lg">D</div>
            <div>
              <h1 className="font-bold text-white">Digii Solution</h1>
              <p className="text-xs text-gray-400">Client Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              Welcome, <span className="text-white font-medium">{profile?.full_name || profile?.email}</span>
            </span>
            <button
              onClick={handleSignOut}
              className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Campaign Performance</h2>
            <p className="text-gray-400 text-sm mt-1">
              {lastUpdated
                ? `Last updated: ${new Date(lastUpdated).toLocaleTimeString()}`
                : 'Fetching data...'}
              {' · '}
              <span className="text-blue-400">Refreshes in {formatCountdown(countdown)}</span>
            </p>
          </div>

          {/* Date Range Selector — only show on metrics tab */}
          {activeTab === 'metrics' && (
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="last_7d">Last 7 Days</option>
              <option value="last_30d">Last 30 Days</option>
              <option value="last_90d">Last 90 Days</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
            </select>
          )}
        </div>

        {campaigns.length === 0 && activeTab === 'metrics' ? (
          <div className="text-center py-24 bg-gray-900 rounded-2xl border border-gray-800">
            <div className="text-5xl mb-4">📊</div>
            <h3 className="text-xl font-semibold mb-2">No campaigns assigned yet</h3>
            <p className="text-gray-400">Your Digii Solution team will assign your campaigns shortly.</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setActiveTab('metrics')}
                className={`px-5 py-2 rounded-xl text-sm font-medium transition ${activeTab === 'metrics' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
              >
                📈 Metrics
              </button>
              <button
                onClick={() => {
                  setActiveTab('leads')
                  if (leads.length === 0 && !leadsLoading && campaignIds.length > 0) {
                    fetchLeads(campaignIds)
                  }
                }}
                className={`px-5 py-2 rounded-xl text-sm font-medium transition ${activeTab === 'leads' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
              >
                👤 My Leads {leads.length > 0 && <span className="ml-1 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{leads.length}</span>}
              </button>
            </div>

            {activeTab === 'metrics' ? (
              <>
                {/* Summary Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
                  <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-6 shadow-lg">
                    <p className="text-blue-200 text-sm font-medium uppercase tracking-wide">Total Leads</p>
                    <p className="text-4xl font-bold mt-2">{totals?.total_leads.toLocaleString() || '0'}</p>
                    <p className="text-blue-200 text-xs mt-2">Across all campaigns</p>
                  </div>

                  <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-2xl p-6 shadow-lg">
                    <p className="text-purple-200 text-sm font-medium uppercase tracking-wide">Total Ad Spend</p>
                    <p className="text-4xl font-bold mt-2">{formatCurrency(totals?.total_spend || 0)}</p>
                    <p className="text-purple-200 text-xs mt-2">Across all campaigns</p>
                  </div>

                  <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-2xl p-6 shadow-lg">
                    <p className="text-emerald-200 text-sm font-medium uppercase tracking-wide">Cost Per Lead</p>
                    <p className="text-4xl font-bold mt-2">{formatCurrency(totals?.total_cost_per_lead || 0)}</p>
                    <p className="text-emerald-200 text-xs mt-2">Average across campaigns</p>
                  </div>

                  <div className="bg-gradient-to-br from-orange-500 to-orange-700 rounded-2xl p-6 shadow-lg">
                    <p className="text-orange-200 text-sm font-medium uppercase tracking-wide">Impressions</p>
                    <p className="text-4xl font-bold mt-2">{totals?.total_impressions.toLocaleString() || '0'}</p>
                    <p className="text-orange-200 text-xs mt-2">Total ad views</p>
                  </div>

                  <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-2xl p-6 shadow-lg">
                    <p className="text-sky-200 text-sm font-medium uppercase tracking-wide">Reach</p>
                    <p className="text-4xl font-bold mt-2">{totals?.total_reach.toLocaleString() || '0'}</p>
                    <p className="text-sky-200 text-xs mt-2">Unique people reached</p>
                  </div>

                  <div className="bg-gradient-to-br from-amber-500 to-amber-700 rounded-2xl p-6 shadow-lg">
                    <p className="text-amber-200 text-sm font-medium uppercase tracking-wide">Clicks</p>
                    <p className="text-4xl font-bold mt-2">{totals?.total_clicks.toLocaleString() || '0'}</p>
                    <p className="text-amber-200 text-xs mt-2">Total link clicks</p>
                  </div>
                </div>

                {/* Campaign Breakdown Table */}
                <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-800">
                    <h3 className="font-semibold text-lg">Campaign Breakdown</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-800">
                          <th className="px-6 py-3">Campaign</th>
                          <th className="px-6 py-3 text-right">Leads</th>
                          <th className="px-6 py-3 text-right">Ad Spend</th>
                          <th className="px-6 py-3 text-right">Cost Per Lead</th>
                          <th className="px-6 py-3 text-right">Impressions</th>
                          <th className="px-6 py-3 text-right">Reach</th>
                          <th className="px-6 py-3 text-right">Clicks (CTR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((c, i) => (
                          <tr key={c.campaign_id} className={`border-b border-gray-800 hover:bg-gray-800/50 transition ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                            <td className="px-6 py-4">
                              <p className="font-medium text-white">{c.campaign_name}</p>
                              <p className="text-xs text-gray-500 mt-0.5">ID: {c.campaign_id}</p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-blue-400 font-semibold">{c.leads.toLocaleString()}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-purple-400 font-semibold">{formatCurrency(c.spend)}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-emerald-400 font-semibold">{formatCurrency(c.cost_per_lead)}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-orange-400 font-semibold">{c.impressions.toLocaleString()}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-sky-400 font-semibold">{c.reach.toLocaleString()}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="text-amber-400 font-semibold">{c.clicks.toLocaleString()}</span>
                              <span className="text-gray-500 text-xs ml-1">({c.ctr}%)</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              /* ── Leads Tab ── */
              <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">My Leads</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Contact info submitted through your ad campaigns</p>
                  </div>
                  {leads.length > 0 && (
                    <span className="text-sm text-gray-400">{leads.length} total lead{leads.length !== 1 ? 's' : ''}</span>
                  )}
                </div>

                {leadsLoading ? (
                  <div className="py-16 text-center">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-blue-300 text-sm">Loading your leads...</p>
                  </div>
                ) : leads.length === 0 ? (
                  <div className="py-20 text-center">
                    <p className="text-4xl mb-4">👤</p>
                    <p className="text-lg font-semibold text-white mb-1">No leads yet</p>
                    <p className="text-gray-400 text-sm">Leads from your Meta ad forms will appear here once synced by your account manager.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-800 bg-gray-800/40">
                          <th className="px-6 py-3">Name</th>
                          <th className="px-6 py-3">Email</th>
                          <th className="px-6 py-3">Phone</th>
                          <th className="px-6 py-3">Campaign</th>
                          <th className="px-6 py-3">Submitted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((lead, i) => (
                          <tr key={lead.id} className={`border-b border-gray-800 hover:bg-gray-800/40 transition ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                            <td className="px-6 py-4">
                              <span className="font-medium text-white">{lead.full_name || <span className="text-gray-500 italic">—</span>}</span>
                            </td>
                            <td className="px-6 py-4">
                              {lead.email
                                ? <a href={`mailto:${lead.email}`} className="text-blue-400 hover:text-blue-300 transition">{lead.email}</a>
                                : <span className="text-gray-500 italic">—</span>}
                            </td>
                            <td className="px-6 py-4">
                              {lead.phone
                                ? <a href={`tel:${lead.phone}`} className="text-emerald-400 hover:text-emerald-300 transition">{lead.phone}</a>
                                : <span className="text-gray-500 italic">—</span>}
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm text-gray-400 max-w-[180px] truncate block">{lead.campaign_name || lead.campaign_id}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm text-gray-400">
                                {lead.created_at
                                  ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                  : '—'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
