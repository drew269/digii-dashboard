import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_STAGES = ['new_lead', 'no_answer', 'booked_job', 'completed', 'lead_lost', 'lead_cancelled'] as const
type PipelineStage = typeof VALID_STAGES[number]

// PATCH /api/meta/leads/[id] — update the pipeline stage of a lead
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { pipeline_stage } = body

  if (!VALID_STAGES.includes(pipeline_stage as PipelineStage)) {
    return NextResponse.json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('leads')
    .update({ pipeline_stage })
    .eq('id', id)

  if (error) {
    console.error('Lead stage update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, pipeline_stage })
}
