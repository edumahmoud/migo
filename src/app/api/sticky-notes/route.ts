import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// -------------------------------------------------------
// GET /api/sticky-notes — Fetch current user's sticky notes
// -------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { data, error } = await supabaseServer
      .from('sticky_notes')
      .select('*')
      .eq('user_id', authResult.user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching sticky notes:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err) {
    console.error('GET /api/sticky-notes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// -------------------------------------------------------
// POST /api/sticky-notes — Create a new sticky note
// -------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { content, color, subject_id, position_x, position_y } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const insertData: Record<string, unknown> = {
      user_id: authResult.user.id,
      content: content.trim(),
      color: color || 'amber',
      position_x: position_x ?? Math.floor(20 + Math.random() * 100),
      position_y: position_y ?? Math.floor(80 + Math.random() * 80),
      is_minimized: false,
    };

    // subject_id is optional
    if (subject_id) {
      insertData.subject_id = subject_id;
    }

    const { data, error } = await supabaseServer
      .from('sticky_notes')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Error creating sticky note:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('POST /api/sticky-notes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// -------------------------------------------------------
// PATCH /api/sticky-notes — Update a sticky note
// Body: { id, ...updates }
// -------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    // Ensure user can only update their own notes
    const { data: existing, error: fetchError } = await supabaseServer
      .from('sticky_notes')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (existing.user_id !== authResult.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Build allowed updates
    const allowedFields = ['content', 'color', 'position_x', 'position_y', 'is_minimized', 'subject_id'];
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowedFields) {
      if (key in updates) {
        updateData[key] = updates[key];
      }
    }

    const { data, error } = await supabaseServer
      .from('sticky_notes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating sticky note:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('PATCH /api/sticky-notes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// -------------------------------------------------------
// DELETE /api/sticky-notes — Delete a sticky note
// Body: { id }
// -------------------------------------------------------
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    // Ensure user can only delete their own notes
    const { data: existing, error: fetchError } = await supabaseServer
      .from('sticky_notes')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    if (existing.user_id !== authResult.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseServer
      .from('sticky_notes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting sticky note:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/sticky-notes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
