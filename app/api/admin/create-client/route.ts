import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { email, password, full_name, campaign_ids } = await request.json()

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password and name are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Step 1: Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm so they can login immediately
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    // Step 2: Create profile row
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email,
        full_name,
        role: 'client',
      })

    if (profileError) {
      // Rollback: delete auth user if profile creation fails
      await supabase.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    // Step 3: Assign campaigns if provided
    if (campaign_ids && campaign_ids.length > 0) {
      for (const metaCampaignId of campaign_ids) {
        // Upsert campaign into campaigns table
        const { data: campaignRow } = await supabase
          .from('campaigns')
          .upsert({
            meta_campaign_id: metaCampaignId.id,
            meta_ad_account_id: metaCampaignId.ad_account_id,
            campaign_name: metaCampaignId.name,
          }, { onConflict: 'meta_campaign_id' })
          .select()
          .single()

        if (campaignRow) {
          await supabase.from('client_campaigns').insert({
            client_id: userId,
            campaign_id: campaignRow.id,
          })
        }
      }
    }

    return NextResponse.json({ success: true, user_id: userId })
  } catch (error) {
    console.error('Create client error:', error)
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
}
