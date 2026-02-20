'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  full_name: string
  email: string
  role: string
}

interface MetaCampaign {
  id: string
  name: string
  status: string
  ad_account_id: string
}

interface Assignment {
  campaign_id: string
  campaigns: {
    meta_campaign_id: string
    campaign_name: string
  } | null
}

interface ClientWithCampaigns extends Client {
  assignedCampaigns: string[]
}

type PipelineStage = 'new_lead' | 'no_answer' | 'booked_job' | 'completed' | 'lead_lost' | 'lead_cancelled'

interface Lead {
  id: string
  campaign_id: string
  campaign_name: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
  synced_at: string
  pipeline_stage: PipelineStage | null
}

const PIPELINE_STAGES: { key: PipelineStage; label: string; color: string; bg: string; border: string; dot: string }[] = [
  { key: 'new_lead',        label: 'New Lead',        color: 'text-blue-300',   bg: 'bg-blue-950/40',    border: 'border-blue-800/60',   dot: 'bg-blue-400' },
  { key: 'no_answer',       label: 'No Answer',       color: 'text-yellow-300', bg: 'bg-yellow-950/40',  border: 'border-yellow-800/60', dot: 'bg-yellow-400' },
  { key: 'booked_job',      label: 'Booked Job',      color: 'text-purple-300', bg: 'bg-purple-950/40',  border: 'border-purple-800/60', dot: 'bg-purple-400' },
  { key: 'completed',       label: 'Completed',       color: 'text-green-300',  bg: 'bg-green-950/40',   border: 'border-green-800/60',  dot: 'bg-green-400' },
  { key: 'lead_lost',       label: 'Lead Lost',       color: 'text-red-300',    bg: 'bg-red-950/40',     border: 'border-red-800/60',    dot: 'bg-red-400' },
  { key: 'lead_cancelled',  label: 'Lead Cancelled',  color: 'text-gray-400',   bg: 'bg-gray-800/40',    border: 'border-gray-700/60',   dot: 'bg-gray-500' },
]

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

type ActiveTab = 'clients' | 'campaigns' | 'form_mapping'
type ModalMode = 'add' | 'edit' | null

interface FormMapping {
  id: string
  name: string
  leads_count: number
  page_label: string
  campaign_id: string | null
}

export default function AdminDashboard() {
  const [clients, setClients] = useState<ClientWithCampaigns[]>([])
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('clients')

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingClient, setEditingClient] = useState<ClientWithCampaigns | null>(null)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formCampaigns, setFormCampaigns] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Analytics panel state
  const [analyticsClient, setAnalyticsClient] = useState<ClientWithCampaigns | null>(null)
  const [analyticsData, setAnalyticsData] = useState<CampaignMetric[]>([])
  const [analyticsTotals, setAnalyticsTotals] = useState<Totals | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsDateRange, setAnalyticsDateRange] = useState('last_30d')
  const [analyticsLastUpdated, setAnalyticsLastUpdated] = useState<string | null>(null)
  const [analyticsTab, setAnalyticsTab] = useState<'metrics' | 'leads'>('metrics')

  // Leads state
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadsSyncing, setLeadsSyncing] = useState(false)
  const [leadsSyncResult, setLeadsSyncResult] = useState<string | null>(null)
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null)
  const [expandedLead, setExpandedLead] = useState<string | null>(null)

  // Campaign overview state
  const [overviewCampaigns, setOverviewCampaigns] = useState<{ meta_campaign_id: string; campaign_name: string; meta_ad_account_id: string }[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [overviewLeads, setOverviewLeads] = useState<Lead[]>([])
  const [overviewLeadsLoading, setOverviewLeadsLoading] = useState(false)
  const [overviewSyncing, setOverviewSyncing] = useState(false)
  const [overviewSyncResult, setOverviewSyncResult] = useState<string | null>(null)
  const [overviewUpdatingLeadId, setOverviewUpdatingLeadId] = useState<string | null>(null)

  // Form mapping state
  const [formMappings, setFormMappings] = useState<FormMapping[]>([])
  const [formMappingCampaigns, setFormMappingCampaigns] = useState<{ meta_campaign_id: string; campaign_name: string }[]>([])
  const [formMappingsLoading, setFormMappingsLoading] = useState(false)
  const [formMappingsError, setFormMappingsError] = useState<string | null>(null)
  const [savingFormId, setSavingFormId] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  const loadMetaCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    setCampaignsError(null)
    try {
      const res = await fetch('/api/meta/campaigns')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const campaigns = data.campaigns || []
      setMetaCampaigns(campaigns)
      return campaigns
    } catch (e) {
      console.error('Failed to load Meta campaigns:', e)
      setCampaignsError('Could not load campaigns from Meta. Will retry automatically.')
      return []
    } finally {
      setCampaignsLoading(false)
    }
  }, [])

  const loadClientsWithCampaigns = useCallback(async () => {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'client')
      .order('full_name')

    if (!profilesData) return []

    const clientsWithCampaigns = await Promise.all(
      profilesData.map(async (client) => {
        const { data: assignments } = await supabase
          .from('client_campaigns')
          .select('campaign_id, campaigns(meta_campaign_id, campaign_name)')
          .eq('client_id', client.id)

        const assignedCampaignIds = ((assignments as unknown as Assignment[]) || [])
          .map(a => a.campaigns?.meta_campaign_id)
          .filter(Boolean) as string[]

        return { ...client, assignedCampaigns: assignedCampaignIds }
      })
    )

    return clientsWithCampaigns
  }, [supabase])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') { router.push('/dashboard'); return }

      const [, clientsData] = await Promise.all([
        loadMetaCampaigns(),
        loadClientsWithCampaigns(),
      ])

      setClients(clientsData)

      // Load campaigns from DB for overview
      const { data: dbCampaigns } = await supabase
        .from('campaigns')
        .select('meta_campaign_id, campaign_name, meta_ad_account_id')
        .order('campaign_name')
      setOverviewCampaigns(dbCampaigns || [])

      setLoading(false)
    }
    init()
  }, [loadMetaCampaigns, loadClientsWithCampaigns, router, supabase])

  // Auto-refresh campaigns every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadMetaCampaigns()
    }, 15000)
    return () => clearInterval(interval)
  }, [loadMetaCampaigns])

  const refreshClients = async () => {
    const clientsData = await loadClientsWithCampaigns()
    setClients(clientsData)
  }

  // ── Analytics ──
  const fetchAnalytics = useCallback(async (client: ClientWithCampaigns, dateRange: string) => {
    if (client.assignedCampaigns.length === 0) {
      setAnalyticsData([])
      setAnalyticsTotals(null)
      setAnalyticsLoading(false)
      return
    }
    setAnalyticsLoading(true)
    try {
      const res = await fetch(`/api/meta/metrics?campaign_ids=${client.assignedCampaigns.join(',')}&date_range=${dateRange}`)
      const data = await res.json()
      if (!data.error) {
        setAnalyticsData(data.campaigns || [])
        setAnalyticsTotals(data.totals)
        setAnalyticsLastUpdated(data.last_updated)
      }
    } catch (e) {
      console.error('Analytics fetch error:', e)
    }
    setAnalyticsLoading(false)
  }, [])

  const fetchLeads = useCallback(async (client: ClientWithCampaigns) => {
    if (client.assignedCampaigns.length === 0) {
      setLeads([])
      return
    }
    setLeadsLoading(true)
    try {
      const res = await fetch(`/api/meta/leads?campaign_ids=${client.assignedCampaigns.join(',')}`)
      const data = await res.json()
      if (!data.error) setLeads(data.leads || [])
      else console.error('fetchLeads error:', data.error)
    } catch (e) {
      console.error('Leads fetch error:', e)
    }
    setLeadsLoading(false)
  }, [])

  const syncLeads = async (client: ClientWithCampaigns) => {
    setLeadsSyncing(true)
    setLeadsSyncResult(null)
    try {
      // sync_all: true — syncs every campaign so all leads are stored
      // priority_campaign_ids — the client's campaigns get priority for unmatched forms
      const res = await fetch('/api/meta/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_all: true,
          priority_campaign_ids: client.assignedCampaigns,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setLeadsSyncResult(`Error: ${data.error}`)
      } else {
        setLeadsSyncResult(`✅ Synced ${data.synced} new lead${data.synced !== 1 ? 's' : ''}${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`)
        await fetchLeads(client)
      }
    } catch {
      setLeadsSyncResult('Error: Could not sync leads')
    }
    setLeadsSyncing(false)
  }

  const updateLeadStage = async (leadId: string, stage: PipelineStage) => {
    setUpdatingLeadId(leadId)
    try {
      const res = await fetch(`/api/meta/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: stage }),
      })
      const data = await res.json()
      if (!data.error) {
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_stage: stage } : l))
      }
    } catch (e) {
      console.error('Failed to update lead stage:', e)
    }
    setUpdatingLeadId(null)
  }

  // ── Campaign Overview functions ──────────────────────────────────────────
  const selectOverviewCampaign = async (campaignId: string) => {
    if (selectedCampaignId === campaignId) {
      setSelectedCampaignId(null)
      setOverviewLeads([])
      setOverviewSyncResult(null)
      return
    }
    setSelectedCampaignId(campaignId)
    setOverviewSyncResult(null)
    setOverviewLeadsLoading(true)
    try {
      const res = await fetch(`/api/meta/leads?campaign_ids=${campaignId}`)
      const data = await res.json()
      setOverviewLeads(data.leads || [])
    } catch { setOverviewLeads([]) }
    setOverviewLeadsLoading(false)
  }

  const syncOverviewCampaign = async (campaignId: string) => {
    setOverviewSyncing(true)
    setOverviewSyncResult(null)
    try {
      const res = await fetch('/api/meta/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_ids: [campaignId] }),
      })
      const data = await res.json()
      if (data.error) {
        setOverviewSyncResult(`Error: ${data.error}`)
      } else {
        setOverviewSyncResult(`✅ Synced ${data.synced} new lead${data.synced !== 1 ? 's' : ''}${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`)
        // Reload leads
        const res2 = await fetch(`/api/meta/leads?campaign_ids=${campaignId}`)
        const data2 = await res2.json()
        setOverviewLeads(data2.leads || [])
      }
    } catch { setOverviewSyncResult('Error: sync failed') }
    setOverviewSyncing(false)
  }

  const updateOverviewLeadStage = async (leadId: string, stage: PipelineStage) => {
    setOverviewUpdatingLeadId(leadId)
    try {
      const res = await fetch(`/api/meta/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: stage }),
      })
      const data = await res.json()
      if (!data.error) {
        setOverviewLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_stage: stage } : l))
      }
    } catch { /* silent */ }
    setOverviewUpdatingLeadId(null)
  }

  const loadFormMappings = async () => {
    setFormMappingsLoading(true)
    setFormMappingsError(null)
    try {
      const res = await fetch('/api/admin/form-mappings')
      const data = await res.json()
      if (data.error) {
        setFormMappingsError(data.error)
      } else {
        setFormMappings(data.forms || [])
        setFormMappingCampaigns(data.campaigns || [])
        if (data.pageErrors?.length > 0) {
          setFormMappingsError('Token error: ' + data.pageErrors.join(' | '))
        }
      }
    } catch (e) {
      setFormMappingsError('Network error loading forms')
      console.error('Failed to load form mappings:', e)
    }
    setFormMappingsLoading(false)
  }

  const saveFormMapping = async (formId: string, campaignId: string) => {
    setSavingFormId(formId)
    try {
      await fetch('/api/admin/form-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: formId, campaign_id: campaignId || null }),
      })
      setFormMappings(prev => prev.map(f => f.id === formId ? { ...f, campaign_id: campaignId || null } : f))
    } catch (e) {
      console.error('Failed to save form mapping:', e)
    }
    setSavingFormId(null)
  }

  const openAnalytics = async (client: ClientWithCampaigns) => {
    setAnalyticsClient(client)
    setAnalyticsData([])
    setAnalyticsTotals(null)
    setLeads([])
    setLeadsSyncResult(null)
    setAnalyticsTab('metrics')
    await fetchAnalytics(client, analyticsDateRange)
  }

  const closeAnalytics = () => {
    setAnalyticsClient(null)
    setAnalyticsData([])
    setAnalyticsTotals(null)
    setLeads([])
    setLeadsSyncResult(null)
  }

  const handleAnalyticsDateChange = async (newRange: string) => {
    setAnalyticsDateRange(newRange)
    if (analyticsClient) {
      await fetchAnalytics(analyticsClient, newRange)
    }
  }

  // ── Modal ──
  const openAddModal = () => {
    setModalMode('add')
    setFormName('')
    setFormEmail('')
    setFormPassword('')
    setFormCampaigns([])
    setFormError('')
    setFormSuccess('')
  }

  const openEditModal = (client: ClientWithCampaigns) => {
    setModalMode('edit')
    setEditingClient(client)
    setFormName(client.full_name)
    setFormEmail(client.email)
    setFormPassword('')
    setFormCampaigns([...client.assignedCampaigns])
    setFormError('')
    setFormSuccess('')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditingClient(null)
    setFormError('')
    setFormSuccess('')
  }

  const toggleFormCampaign = (metaCampaignId: string) => {
    setFormCampaigns(prev =>
      prev.includes(metaCampaignId)
        ? prev.filter(id => id !== metaCampaignId)
        : [...prev, metaCampaignId]
    )
  }

  const handleSaveCampaigns = async (clientId: string, campaignIds: string[]) => {
    // Build the campaign objects with full details needed by the server route
    const campaigns = campaignIds.map(id => {
      const c = metaCampaigns.find(m => m.id === id)
      return { id, name: c?.name || '', ad_account_id: c?.ad_account_id || '' }
    })

    // Use server-side admin route to bypass RLS — browser client can't write to these tables
    const res = await fetch('/api/admin/assign-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, campaigns }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to save campaigns')
    }
  }

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const selectedCampaignObjects = formCampaigns.map(id => {
        const c = metaCampaigns.find(m => m.id === id)
        return { id, name: c?.name || '', ad_account_id: c?.ad_account_id || '' }
      })
      const res = await fetch('/api/admin/create-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formEmail, password: formPassword, full_name: formName, campaign_ids: selectedCampaignObjects }),
      })
      const data = await res.json()
      if (data.error) { setFormError(data.error); setSaving(false); return }
      setFormSuccess(`✅ "${formName}" created! They can now log in.`)
      await refreshClients()
      setTimeout(() => closeModal(), 2000)
    } catch {
      setFormError('Something went wrong. Please try again.')
    }
    setSaving(false)
  }

  const handleEditClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingClient) return
    setSaving(true)
    setFormError('')
    try {
      await supabase.from('profiles').update({ full_name: formName }).eq('id', editingClient.id)
      await handleSaveCampaigns(editingClient.id, formCampaigns)
      setFormSuccess('✅ Client updated successfully!')
      await refreshClients()
      // If analytics panel is open for this client, refresh it with new campaigns
      if (analyticsClient?.id === editingClient.id) {
        const updatedClient = { ...editingClient, full_name: formName, assignedCampaigns: formCampaigns }
        setAnalyticsClient(updatedClient)
        await fetchAnalytics(updatedClient, analyticsDateRange)
      }
      setTimeout(() => closeModal(), 1500)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
    setSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const getCampaignName = (metaCampaignId: string) => {
    return metaCampaigns.find(c => c.id === metaCampaignId)?.name || metaCampaignId
  }

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-blue-300">Loading admin panel...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Add/Edit Modal ── */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {modalMode === 'add' ? 'Add New Client' : `Edit — ${editingClient?.full_name}`}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {modalMode === 'add' ? 'Create login credentials and assign campaigns' : 'Update client details and campaign access'}
                </p>
              </div>
              <button onClick={closeModal} className="text-gray-500 hover:text-white transition text-xl">✕</button>
            </div>

            <form onSubmit={modalMode === 'add' ? handleAddClient : handleEditClient} className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} required placeholder="e.g. John Smith"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required disabled={modalMode === 'edit'} placeholder="client@company.com"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed" />
                {modalMode === 'edit' && <p className="text-xs text-gray-500 mt-1">Email cannot be changed after creation</p>}
              </div>

              {modalMode === 'add' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                  <input type="text" value={formPassword} onChange={e => setFormPassword(e.target.value)} required placeholder="Create a password for them"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" />
                  <p className="text-xs text-gray-500 mt-1">Share this with your client so they can log in</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Assign Campaigns <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-xl max-h-52 overflow-y-auto">
                  {campaignsLoading && metaCampaigns.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
                      <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                      Loading campaigns from Meta...
                    </div>
                  ) : metaCampaigns.length === 0 ? (
                    <p className="px-4 py-3 text-gray-500 text-sm">
                      {campaignsError ? '⚠️ Failed to load campaigns. Please try again.' : 'No campaigns found from Meta'}
                    </p>
                  ) : (
                    metaCampaigns.map(campaign => (
                      <label key={campaign.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/50 cursor-pointer transition border-b border-gray-700/50 last:border-0">
                        <input type="checkbox" checked={formCampaigns.includes(campaign.id)} onChange={() => toggleFormCampaign(campaign.id)} className="w-4 h-4 accent-blue-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate">{campaign.name}</p>
                          <p className="text-xs mt-0.5">
                            {campaign.status === 'ACTIVE' ? <span className="text-green-400">● Active</span> : <span className="text-gray-400">● {campaign.status}</span>}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
                {formCampaigns.length > 0 && <p className="text-xs text-blue-400 mt-1">{formCampaigns.length} campaign{formCampaigns.length > 1 ? 's' : ''} selected</p>}
              </div>

              {formError && <div className="bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-3"><p className="text-red-300 text-sm">{formError}</p></div>}
              {formSuccess && <div className="bg-green-500/20 border border-green-500/40 rounded-xl px-4 py-3"><p className="text-green-300 text-sm">{formSuccess}</p></div>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition font-medium">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition">
                  {saving ? (modalMode === 'add' ? 'Creating...' : 'Saving...') : (modalMode === 'add' ? 'Create Client' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-lg">D</div>
            <div>
              <h1 className="font-bold text-white">Digii Solution</h1>
              <p className="text-xs text-red-400 font-medium">Admin Panel</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition">Sign Out</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── Campaign Overview ── */}
        {overviewCampaigns.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-white">Campaign Overview</h2>
                <p className="text-xs text-gray-400 mt-0.5">Select a campaign to view and manage its leads</p>
              </div>
            </div>

            {/* Campaign Cards */}
            <div className="flex flex-wrap gap-3 mb-4">
              {overviewCampaigns.map(c => {
                const isSelected = selectedCampaignId === c.meta_campaign_id
                return (
                  <button
                    key={c.meta_campaign_id}
                    onClick={() => selectOverviewCampaign(c.meta_campaign_id)}
                    className={`px-4 py-3 rounded-xl border text-left transition ${
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                        : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-semibold leading-tight">{c.campaign_name}</p>
                    <p className="text-xs mt-0.5 opacity-60">{c.meta_campaign_id}</p>
                  </button>
                )
              })}
            </div>

            {/* Expanded Campaign Panel */}
            {selectedCampaignId && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Panel Header */}
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-semibold text-white">
                      {overviewCampaigns.find(c => c.meta_campaign_id === selectedCampaignId)?.campaign_name}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {overviewLeads.length} lead{overviewLeads.length !== 1 ? 's' : ''} stored
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {overviewSyncResult && (
                      <span className={`text-xs px-3 py-1.5 rounded-lg border ${overviewSyncResult.startsWith('Error') ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-green-500/10 border-green-500/30 text-green-300'}`}>
                        {overviewSyncResult}
                      </span>
                    )}
                    <button
                      onClick={() => syncOverviewCampaign(selectedCampaignId)}
                      disabled={overviewSyncing}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition"
                    >
                      {overviewSyncing ? (
                        <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Syncing...</>
                      ) : (
                        <><span>↻</span> Sync Leads</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Kanban */}
                {overviewLeadsLoading ? (
                  <div className="flex items-center justify-center py-16 gap-3">
                    <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-gray-400 text-sm">Loading leads...</span>
                  </div>
                ) : overviewLeads.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-3xl mb-3">📭</p>
                    <p className="text-gray-400 font-medium">No leads synced yet</p>
                    <p className="text-gray-500 text-sm mt-1">Click &quot;Sync Leads&quot; to pull from Meta</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto p-4">
                    <div className="flex gap-3 min-w-max">
                      {PIPELINE_STAGES.map(stage => {
                        const stageLeads = overviewLeads.filter(l => (l.pipeline_stage || 'new_lead') === stage.key)
                        return (
                          <div key={stage.key} className={`flex flex-col rounded-xl border ${stage.border} ${stage.bg} w-60 shrink-0`}>
                            <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                                <span className={`text-xs font-semibold uppercase tracking-wide ${stage.color}`}>{stage.label}</span>
                              </div>
                              <span className="text-xs text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded-full">{stageLeads.length}</span>
                            </div>
                            <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[480px]">
                              {stageLeads.length === 0 ? (
                                <p className="text-center text-gray-600 text-xs py-4">No leads</p>
                              ) : stageLeads.map(lead => (
                                <div key={lead.id} className="bg-gray-900/80 border border-gray-700/60 rounded-lg p-3 hover:border-gray-600 transition">
                                  <div className="flex items-start justify-between gap-1 mb-2">
                                    <p className="text-white text-sm font-semibold leading-tight">
                                      {lead.full_name || <span className="text-gray-500 italic font-normal">Unknown</span>}
                                    </p>
                                    <span className="text-gray-600 text-xs shrink-0">
                                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                    </span>
                                  </div>
                                  <div className="space-y-1 mb-3">
                                    {lead.phone
                                      ? <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-xs transition"><span>📞</span><span>{lead.phone}</span></a>
                                      : <p className="text-xs text-gray-600 italic">No phone</p>}
                                    {lead.email
                                      ? <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs transition truncate"><span>✉️</span><span className="truncate">{lead.email}</span></a>
                                      : <p className="text-xs text-gray-600 italic">No email</p>}
                                  </div>
                                  <select
                                    value={lead.pipeline_stage || 'new_lead'}
                                    disabled={overviewUpdatingLeadId === lead.id}
                                    onChange={e => updateOverviewLeadStage(lead.id, e.target.value as PipelineStage)}
                                    className="w-full text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                                  >
                                    {PIPELINE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                  </select>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Title + Add */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Admin Dashboard</h2>
            <p className="text-gray-400 text-sm mt-1">Manage clients and assign campaigns</p>
          </div>
          <button onClick={openAddModal} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition shadow-lg">
            <span className="text-lg leading-none">+</span> Add Client
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveTab('clients')} className={`px-5 py-2 rounded-xl text-sm font-medium transition ${activeTab === 'clients' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            Clients ({clients.length})
          </button>
          <button onClick={() => setActiveTab('campaigns')} className={`px-5 py-2 rounded-xl text-sm font-medium transition ${activeTab === 'campaigns' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            Meta Campaigns ({metaCampaigns.length})
          </button>
          <button onClick={() => { setActiveTab('form_mapping'); if (formMappings.length === 0) loadFormMappings() }} className={`px-5 py-2 rounded-xl text-sm font-medium transition ${activeTab === 'form_mapping' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            🗂 Form → Campaign Mapping
          </button>
        </div>

        {/* ── Clients Tab ── */}
        {activeTab === 'clients' && (
          <div className="space-y-4">
            {clients.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 px-6 py-16 text-center">
                <p className="text-4xl mb-4">👤</p>
                <p className="text-lg font-semibold text-white mb-1">No clients yet</p>
                <p className="text-gray-400 text-sm mb-6">Add your first client to get started</p>
                <button onClick={openAddModal} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition">+ Add First Client</button>
              </div>
            ) : (
              <>
                {/* Client Table */}
                <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <div className="grid grid-cols-12 px-6 py-3 border-b border-gray-800 text-xs text-gray-400 uppercase tracking-wide font-medium">
                    <div className="col-span-3">Client</div>
                    <div className="col-span-5">Assigned Campaigns</div>
                    <div className="col-span-4 text-right">Actions</div>
                  </div>

                  <div className="divide-y divide-gray-800">
                    {clients.map(client => (
                      <div key={client.id} className={`grid grid-cols-12 px-6 py-4 items-center transition ${analyticsClient?.id === client.id ? 'bg-blue-950/30 border-l-2 border-blue-500' : 'hover:bg-gray-800/40'}`}>
                        {/* Client Info */}
                        <div className="col-span-3 flex items-center gap-3">
                          <div className="w-9 h-9 bg-blue-900/50 border border-blue-700/50 rounded-full flex items-center justify-center text-sm font-bold text-blue-300 shrink-0">
                            {(client.full_name || client.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white text-sm truncate">{client.full_name || 'Unnamed'}</p>
                            <p className="text-xs text-gray-400 truncate">{client.email}</p>
                          </div>
                        </div>

                        {/* Campaign Badges */}
                        <div className="col-span-5 flex flex-wrap gap-1.5 pr-2">
                          {client.assignedCampaigns.length === 0 ? (
                            <span className="text-xs text-gray-500 italic">No campaigns assigned</span>
                          ) : (
                            client.assignedCampaigns.map(campaignId => {
                              const campaign = metaCampaigns.find(c => c.id === campaignId)
                              return (
                                <span key={campaignId} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${campaign?.status === 'ACTIVE' ? 'bg-green-900/30 text-green-400 border border-green-800/50' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0"></span>
                                  <span className="truncate max-w-[140px]">{getCampaignName(campaignId)}</span>
                                </span>
                              )
                            })
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="col-span-4 flex items-center justify-end gap-2">
                          <button
                            onClick={() => analyticsClient?.id === client.id ? closeAnalytics() : openAnalytics(client)}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition font-medium border ${
                              analyticsClient?.id === client.id
                                ? 'bg-blue-600 text-white border-blue-500'
                                : 'bg-gray-800 hover:bg-blue-600 text-gray-300 hover:text-white border-gray-700 hover:border-blue-500'
                            }`}
                          >
                            📊 {analyticsClient?.id === client.id ? 'Hide' : 'Analytics'}
                          </button>
                          <button
                            onClick={() => openEditModal(client)}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 rounded-lg transition font-medium"
                          >
                            ✏️ Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Analytics Panel ── */}
                {analyticsClient && (
                  <div className="bg-gray-900 rounded-2xl border border-blue-800/50 overflow-hidden shadow-xl">
                    {/* Panel Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-blue-950/20">
                      <div>
                        <h3 className="font-bold text-white text-lg">
                          📊 {analyticsClient.full_name || analyticsClient.email}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {analyticsLastUpdated
                            ? `Last updated: ${new Date(analyticsLastUpdated).toLocaleTimeString()}`
                            : 'Loading data...'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {analyticsTab === 'metrics' && (
                          <select
                            value={analyticsDateRange}
                            onChange={e => handleAnalyticsDateChange(e.target.value)}
                            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="last_7d">Last 7 Days</option>
                            <option value="last_30d">Last 30 Days</option>
                            <option value="last_90d">Last 90 Days</option>
                            <option value="this_month">This Month</option>
                            <option value="last_month">Last Month</option>
                          </select>
                        )}
                        <button onClick={closeAnalytics} className="text-gray-500 hover:text-white transition text-xl leading-none">✕</button>
                      </div>
                    </div>

                    {/* Sub-tabs: Metrics / Leads */}
                    <div className="flex gap-1 px-6 pt-4 border-b border-gray-800">
                      <button
                        onClick={() => setAnalyticsTab('metrics')}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${analyticsTab === 'metrics' ? 'bg-gray-800 text-white border border-b-0 border-gray-700' : 'text-gray-400 hover:text-white'}`}
                      >
                        📈 Metrics
                      </button>
                      <button
                        onClick={() => {
                          setAnalyticsTab('leads')
                          if (leads.length === 0 && !leadsLoading) fetchLeads(analyticsClient)
                        }}
                        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${analyticsTab === 'leads' ? 'bg-gray-800 text-white border border-b-0 border-gray-700' : 'text-gray-400 hover:text-white'}`}
                      >
                        👤 Leads {leads.length > 0 && <span className="ml-1 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{leads.length}</span>}
                      </button>
                    </div>

                    {/* No campaigns */}
                    {analyticsClient.assignedCampaigns.length === 0 ? (
                      <div className="px-6 py-12 text-center">
                        <p className="text-3xl mb-3">📭</p>
                        <p className="text-gray-400 font-medium">No campaigns assigned to this client yet</p>
                        <p className="text-gray-500 text-sm mt-1">Click ✏️ Edit to assign campaigns, then view analytics here</p>
                      </div>

                    ) : analyticsTab === 'metrics' ? (
                      /* ── Metrics Tab ── */
                      analyticsLoading ? (
                        <div className="px-6 py-12 text-center">
                          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                          <p className="text-blue-300 text-sm">Fetching live data from Meta...</p>
                        </div>
                      ) : (
                        <div className="p-6 space-y-5">
                          {/* Metric Cards */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-5 shadow-lg">
                              <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Total Leads</p>
                              <p className="text-4xl font-bold mt-1">{analyticsTotals?.total_leads.toLocaleString() || '0'}</p>
                              <p className="text-blue-200 text-xs mt-2">Across all campaigns</p>
                            </div>
                            <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl p-5 shadow-lg">
                              <p className="text-purple-200 text-xs font-medium uppercase tracking-wide">Total Ad Spend</p>
                              <p className="text-4xl font-bold mt-1">{formatCurrency(analyticsTotals?.total_spend || 0)}</p>
                              <p className="text-purple-200 text-xs mt-2">Across all campaigns</p>
                            </div>
                            <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-xl p-5 shadow-lg">
                              <p className="text-emerald-200 text-xs font-medium uppercase tracking-wide">Cost Per Lead</p>
                              <p className="text-4xl font-bold mt-1">{formatCurrency(analyticsTotals?.total_cost_per_lead || 0)}</p>
                              <p className="text-emerald-200 text-xs mt-2">Average across campaigns</p>
                            </div>
                            <div className="bg-gradient-to-br from-orange-500 to-orange-700 rounded-xl p-5 shadow-lg">
                              <p className="text-orange-200 text-xs font-medium uppercase tracking-wide">Impressions</p>
                              <p className="text-4xl font-bold mt-1">{analyticsTotals?.total_impressions.toLocaleString() || '0'}</p>
                              <p className="text-orange-200 text-xs mt-2">Total ad views</p>
                            </div>
                            <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-xl p-5 shadow-lg">
                              <p className="text-sky-200 text-xs font-medium uppercase tracking-wide">Reach</p>
                              <p className="text-4xl font-bold mt-1">{analyticsTotals?.total_reach.toLocaleString() || '0'}</p>
                              <p className="text-sky-200 text-xs mt-2">Unique people reached</p>
                            </div>
                            <div className="bg-gradient-to-br from-amber-500 to-amber-700 rounded-xl p-5 shadow-lg">
                              <p className="text-amber-200 text-xs font-medium uppercase tracking-wide">Clicks</p>
                              <p className="text-4xl font-bold mt-1">{analyticsTotals?.total_clicks.toLocaleString() || '0'}</p>
                              <p className="text-amber-200 text-xs mt-2">Total link clicks</p>
                            </div>
                          </div>

                          {/* Campaign Breakdown Table */}
                          <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700">
                            <div className="px-5 py-3 border-b border-gray-700">
                              <h4 className="font-semibold text-sm text-white">Campaign Breakdown</h4>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-700">
                                    <th className="px-5 py-3">Campaign</th>
                                    <th className="px-5 py-3 text-right">Leads</th>
                                    <th className="px-5 py-3 text-right">Ad Spend</th>
                                    <th className="px-5 py-3 text-right">Cost Per Lead</th>
                                    <th className="px-5 py-3 text-right">Impressions</th>
                                    <th className="px-5 py-3 text-right">Reach</th>
                                    <th className="px-5 py-3 text-right">Clicks (CTR)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {analyticsData.map((c, i) => (
                                    <tr key={c.campaign_id} className={`border-b border-gray-700/50 ${i % 2 === 0 ? '' : 'bg-gray-800/30'}`}>
                                      <td className="px-5 py-3">
                                        <p className="font-medium text-white text-sm">{c.campaign_name}</p>
                                        <p className="text-xs text-gray-500 mt-0.5 font-mono">{c.campaign_id}</p>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-blue-400 font-semibold">{c.leads.toLocaleString()}</span>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-purple-400 font-semibold">{formatCurrency(c.spend)}</span>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-emerald-400 font-semibold">{formatCurrency(c.cost_per_lead)}</span>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-orange-400 font-semibold">{c.impressions.toLocaleString()}</span>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-sky-400 font-semibold">{c.reach.toLocaleString()}</span>
                                      </td>
                                      <td className="px-5 py-3 text-right">
                                        <span className="text-amber-400 font-semibold">{c.clicks.toLocaleString()}</span>
                                        <span className="text-gray-500 text-xs ml-1">({c.ctr}%)</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )

                    ) : (
                      /* ── Leads Tab ── */
                      <div className="p-6 space-y-4">
                        {/* Leads toolbar */}
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-white font-semibold">
                              Lead Contact Data
                              {leads.length > 0 && <span className="ml-2 text-sm text-gray-400 font-normal">({leads.length} total)</span>}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">Individual leads synced from Meta Lead Ads forms</p>
                          </div>
                          <button
                            onClick={() => syncLeads(analyticsClient)}
                            disabled={leadsSyncing}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition"
                          >
                            {leadsSyncing ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Syncing...
                              </>
                            ) : (
                              <>↻ Sync Leads from Meta</>
                            )}
                          </button>
                        </div>

                        {/* Sync result message */}
                        {leadsSyncResult && (
                          <div className={`px-4 py-3 rounded-xl text-sm border ${leadsSyncResult.startsWith('Error') ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-green-500/10 border-green-500/30 text-green-300'}`}>
                            {leadsSyncResult}
                          </div>
                        )}

                        {/* Pipeline Kanban */}
                        {leadsLoading ? (
                          <div className="py-10 text-center">
                            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                            <p className="text-blue-300 text-sm">Loading leads...</p>
                          </div>
                        ) : leads.length === 0 ? (
                          <div className="py-12 text-center bg-gray-800/40 rounded-xl border border-gray-700">
                            <p className="text-3xl mb-3">👤</p>
                            <p className="text-gray-400 font-medium">No leads synced yet</p>
                            <p className="text-gray-500 text-sm mt-1">Click &quot;Sync Leads from Meta&quot; to pull contact data from your lead forms</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto pb-2">
                            <div className="flex gap-3 min-w-max">
                              {PIPELINE_STAGES.map(stage => {
                                const stageLeads = leads.filter(l => (l.pipeline_stage || 'new_lead') === stage.key)
                                return (
                                  <div key={stage.key} className={`flex flex-col rounded-xl border ${stage.border} ${stage.bg} w-64 shrink-0`}>
                                    {/* Column Header */}
                                    <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${stage.dot}`}></span>
                                        <span className={`text-xs font-semibold uppercase tracking-wide ${stage.color}`}>{stage.label}</span>
                                      </div>
                                      <span className="text-xs text-gray-500 font-medium bg-gray-800/60 px-1.5 py-0.5 rounded-full">{stageLeads.length}</span>
                                    </div>

                                    {/* Lead Cards */}
                                    <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[520px]">
                                      {stageLeads.length === 0 ? (
                                        <p className="text-center text-gray-600 text-xs py-4">No leads</p>
                                      ) : (
                                        stageLeads.map(lead => (
                                          <div key={lead.id} className="bg-gray-900/80 border border-gray-700/60 rounded-lg p-3 hover:border-gray-600 transition">
                                            {/* Name + date */}
                                            <div className="flex items-start justify-between gap-1 mb-2">
                                              <p className="text-white text-sm font-semibold leading-tight">
                                                {lead.full_name || <span className="text-gray-500 italic font-normal">Unknown</span>}
                                              </p>
                                              <span className="text-gray-600 text-xs shrink-0">
                                                {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                              </span>
                                            </div>

                                            {/* Contact info */}
                                            <div className="space-y-1 mb-3">
                                              {lead.phone ? (
                                                <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-xs transition">
                                                  <span>📞</span><span>{lead.phone}</span>
                                                </a>
                                              ) : (
                                                <p className="text-xs text-gray-600 italic">No phone</p>
                                              )}
                                              {lead.email ? (
                                                <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs transition truncate">
                                                  <span>✉️</span><span className="truncate">{lead.email}</span>
                                                </a>
                                              ) : (
                                                <p className="text-xs text-gray-600 italic">No email</p>
                                              )}
                                            </div>

                                            {/* Stage selector */}
                                            <select
                                              value={lead.pipeline_stage || 'new_lead'}
                                              disabled={updatingLeadId === lead.id}
                                              onChange={e => updateLeadStage(lead.id, e.target.value as PipelineStage)}
                                              className="w-full text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                                            >
                                              {PIPELINE_STAGES.map(s => (
                                                <option key={s.key} value={s.key}>{s.label}</option>
                                              ))}
                                            </select>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Meta Campaigns Tab ── */}
        {activeTab === 'campaigns' && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">All Meta Campaigns</h3>
                <p className="text-xs text-gray-400 mt-1">Pulled live from your Meta ad accounts · auto-refreshes every 15s</p>
              </div>
              <div className="flex items-center gap-2">
                {campaignsLoading && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-400">
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    Syncing...
                  </div>
                )}
                <button
                  onClick={() => loadMetaCampaigns()}
                  className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 hover:text-white transition"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
            {campaignsError && (
              <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2">
                <span className="text-red-400 text-sm">⚠️ {campaignsError}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-800">
                    <th className="px-6 py-3">Campaign Name</th>
                    <th className="px-6 py-3">Campaign ID</th>
                    <th className="px-6 py-3">Ad Account</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Assigned To</th>
                  </tr>
                </thead>
                <tbody>
                  {metaCampaigns.map((c, i) => {
                    const assignedClients = clients.filter(cl => cl.assignedCampaigns.includes(c.id))
                    return (
                      <tr key={c.id} className={`border-b border-gray-800 hover:bg-gray-800/40 transition ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                        <td className="px-6 py-4 font-medium text-white">{c.name}</td>
                        <td className="px-6 py-4 text-gray-400 text-xs font-mono">{c.id}</td>
                        <td className="px-6 py-4 text-gray-400 text-sm">{c.ad_account_id}</td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.status === 'ACTIVE' ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{c.status}</span>
                        </td>
                        <td className="px-6 py-4">
                          {assignedClients.length === 0 ? (
                            <span className="text-xs text-gray-500 italic">Unassigned</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {assignedClients.map(cl => (
                                <span key={cl.id} className="text-xs px-2 py-0.5 bg-blue-900/30 text-blue-400 border border-blue-800/50 rounded-full">
                                  {cl.full_name || cl.email}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Form → Campaign Mapping Tab ── */}
        {activeTab === 'form_mapping' && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">🗂 Form → Campaign Mapping</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Assign each lead gen form to the correct campaign. Only mapped forms will sync leads.
                </p>
              </div>
              <button
                onClick={loadFormMappings}
                disabled={formMappingsLoading}
                className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 hover:text-white transition disabled:opacity-50"
              >
                {formMappingsLoading ? '⏳ Loading...' : '↻ Refresh'}
              </button>
            </div>

            {formMappingsError && (
              <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                <p className="text-red-400 text-sm font-medium mb-1">⚠️ Could not load forms from Meta</p>
                <p className="text-red-300/70 text-xs font-mono">{formMappingsError}</p>
                <p className="text-gray-400 text-xs mt-2">Your page tokens are likely expired. Generate new ones at <span className="text-blue-400">developers.facebook.com/tools/explorer</span> and update META_PAGE_TOKEN_DIGII and META_PAGE_TOKEN_UNIQUE in .env.local, then restart the server.</p>
              </div>
            )}

            {formMappingsLoading && formMappings.length === 0 ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-400 text-sm">Loading forms from Meta...</span>
              </div>
            ) : formMappings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <span className="text-4xl">📋</span>
                <p className="text-gray-400 text-sm">No forms found. Click Refresh to load forms from Meta.</p>
                <p className="text-gray-500 text-xs">If tokens are expired, refresh them at developers.facebook.com → Graph API Explorer</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-800">
                      <th className="px-6 py-3">Form Name</th>
                      <th className="px-6 py-3">Page</th>
                      <th className="px-6 py-3 text-right">Leads</th>
                      <th className="px-6 py-3">Form ID</th>
                      <th className="px-6 py-3">Assigned Campaign</th>
                      <th className="px-6 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formMappings.map((form, i) => {
                      const isSaving = savingFormId === form.id
                      const isMapped = !!form.campaign_id
                      return (
                        <tr
                          key={form.id}
                          className={`border-b border-gray-800 hover:bg-gray-800/40 transition ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}
                        >
                          {/* Form name */}
                          <td className="px-6 py-4 font-medium text-white text-sm max-w-[260px]">
                            <span className="line-clamp-2">{form.name}</span>
                          </td>

                          {/* Page label */}
                          <td className="px-6 py-4">
                            <span className="text-xs px-2 py-1 rounded-full bg-purple-900/30 text-purple-300 border border-purple-700/40 whitespace-nowrap">
                              {form.page_label}
                            </span>
                          </td>

                          {/* Leads count */}
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-semibold text-white">{form.leads_count.toLocaleString()}</span>
                          </td>

                          {/* Form ID */}
                          <td className="px-6 py-4 text-gray-500 text-xs font-mono">{form.id}</td>

                          {/* Campaign dropdown */}
                          <td className="px-6 py-4 min-w-[260px]">
                            <select
                              value={form.campaign_id || ''}
                              disabled={isSaving}
                              onChange={e => saveFormMapping(form.id, e.target.value)}
                              className="w-full text-sm bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                            >
                              <option value="">— Unmapped (skip on sync) —</option>
                              {formMappingCampaigns.map(c => (
                                <option key={c.meta_campaign_id} value={c.meta_campaign_id}>
                                  {c.campaign_name}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Status badge */}
                          <td className="px-6 py-4 text-center">
                            {isSaving ? (
                              <div className="inline-flex items-center gap-1.5 text-xs text-blue-400">
                                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                Saving...
                              </div>
                            ) : isMapped ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-700/40 font-medium">
                                ✓ Mapped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-900/20 text-yellow-500 border border-yellow-700/30 font-medium">
                                ⚠ Unmapped
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Summary footer */}
                <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {formMappings.filter(f => f.campaign_id).length} of {formMappings.length} forms mapped
                  </span>
                  <span className="text-gray-600">
                    Only mapped forms sync leads · Unmapped forms are skipped
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
