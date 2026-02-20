import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Auth check — only admins can call this
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { clientId, campaigns } = await request.json()
    // campaigns = [{ id, name, ad_account_id }]

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

    // Use admin client to bypass RLS entirely
    const admin = createAdminClient()

    // Step 1: Clear all existing campaign assignments for this client
    const { error: deleteError } = await admin
      .from('client_campaigns')
      .delete()
      .eq('client_id', clientId)

    if (deleteError) {
      console.error('Delete error:', deleteError)
      return NextResponse.json({ error: `Failed to clear old assignments: ${deleteError.message}` }, { status: 500 })
    }

    // Step 2: For each campaign, find-or-create the campaign row, then link to client
    for (const campaign of campaigns || []) {
      let campaignRowId: string | null = null

      // Try to find existing campaign row by meta_campaign_id
      const { data: existing } = await admin
        .from('campaigns')
        .select('id')
        .eq('meta_campaign_id', campaign.id)
        .maybeSingle()

      if (existing) {
        // Update name/account in case it changed in Meta
        await admin
          .from('campaigns')
          .update({
            campaign_name: campaign.name,
            meta_ad_account_id: campaign.ad_account_id,
          })
          .eq('meta_campaign_id', campaign.id)
        campaignRowId = existing.id
        console.log(`Found existing campaign row: ${campaign.id} → ${campaignRowId}`)
      } else {
        // Insert new campaign row
        const { data: inserted, error: insertErr } = await admin
          .from('campaigns')
          .insert({
            meta_campaign_id: campaign.id,
            meta_ad_account_id: campaign.ad_account_id,
            campaign_name: campaign.name,
          })
          .select('id')
          .single()

        if (insertErr) {
          console.error(`Failed to insert campaign ${campaign.id}:`, insertErr)
          continue // skip linking this one, but keep going for others
        }
        campaignRowId = inserted?.id ?? null
        console.log(`Inserted new campaign row: ${campaign.id} → ${campaignRowId}`)
      }

      // Link the campaign to the client
      if (campaignRowId) {
        const { error: linkErr } = await admin
          .from('client_campaigns')
          .insert({
            client_id: clientId,
            campaign_id: campaignRowId,
          })

        if (linkErr) {
          console.error(`Failed to link campaign ${campaignRowId} to client ${clientId}:`, linkErr)
        } else {
          console.log(`Linked campaign ${campaignRowId} to client ${clientId} ✓`)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Assign campaigns error:', error)
    return NextResponse.json({ error: 'Failed to assign campaigns' }, { status: 500 })
  }
}
