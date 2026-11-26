// =====================================================
// Question Bank API — CRUD for question banks and questions
// =====================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import {
  filterDuplicateQuestions,
  questionFingerprint,
  type DedupQuestionInput,
} from '@/lib/question-dedup';

export const maxDuration = 60;

// -------------------------------------------------------
// v136 — question-row normalization + duplicate protection
// -------------------------------------------------------

const VALID_BANK_DIFFICULTIES = ['easy', 'medium', 'hard', 'very_hard'];

interface NormalizedQuestionRow {
  bank_id: string;
  type: string;
  question: string;
  options: string[] | null;
  correct_answer: string | null;
  pairs: { key: string; value: string }[] | null;
  difficulty: string | null;
  category: string | null;
  fingerprint: string | null;
}

function normalizePairs(raw: unknown): { key: string; value: string }[] | null {
  const list = (raw as Record<string, string>[] | null | undefined) ||
    ([] as Record<string, string>[]);
  const arr = Array.isArray(list) ? list : [];
  const normalized = arr
    .map((p) => ({
      key: p.key ?? p.term ?? p.left ?? '',
      value: p.value ?? p.definition ?? p.right ?? '',
    }))
    .filter((p: { key: string; value: string }) => p.key && p.value);
  return normalized.length > 0 ? normalized : null;
}

/** Validate + normalize one incoming question. Returns null when invalid. */
function normalizeQuestionRow(bankId: string, q: Record<string, unknown>): NormalizedQuestionRow | null {
  const type = String(q.type || '').trim();
  const question = String(q.question || '').trim();
  if (!type || !question) return null;

  const rawDifficulty = q.difficulty;
  const difficulty =
    typeof rawDifficulty === 'string' && VALID_BANK_DIFFICULTIES.includes(rawDifficulty)
      ? rawDifficulty
      : null;

  const correct = (q.correct_answer || q.correctAnswer || null) as string | null;
  const options = Array.isArray(q.options) ? (q.options as string[]) : null;
  const pairs = normalizePairs(q.pairs || q.matching_pairs || q.matchingPairs || q.pair_list);

  const fingerprint = questionFingerprint({
    type,
    question,
    correctAnswer: correct,
    options,
    pairs,
  });

  return {
    bank_id: bankId,
    type,
    question,
    options,
    correct_answer: correct ? String(correct) : null,
    pairs,
    difficulty,
    category: q.category ? String(q.category) : null,
    fingerprint: fingerprint || null,
  };
}

/** Load a bank's existing questions as dedup references. */
async function loadExistingForDedup(bankId: string): Promise<DedupQuestionInput[]> {
  const { data, error } = await supabaseServer
    .from('bank_questions')
    .select('type, question, correct_answer, options, pairs, fingerprint')
    .eq('bank_id', bankId);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    type: (row.type as string) || null,
    question: (row.question as string) || '',
    correctAnswer: (row.correct_answer as string) || null,
    options: (row.options as string[] | null) || null,
    pairs: (row.pairs as { key: string; value: string }[] | null) || null,
    fingerprint: (row.fingerprint as string) || null,
  }));
}

// -------------------------------------------------------
// GET — List question banks (optionally filtered by subject)
//   ?subjectId=xxx  → banks for a specific subject
//   ?bankId=xxx     → single bank with its questions
//   no params       → all banks for the authenticated teacher
// -------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = supabaseServer;

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get('subjectId');
    const bankId = searchParams.get('bankId');

    // Get single bank with questions
    if (bankId) {
      const { data: bank, error: bankError } = await supabase
        .from('question_banks')
        .select('*, subjects(name)')
        .eq('id', bankId)
        .single();

      if (bankError || !bank) {
        return NextResponse.json({ success: false, error: 'لم يتم العثور على بنك الأسئلة' }, { status: 404 });
      }

      // Check access: owner or co-teacher
      if (bank.teacher_id !== user.id) {
        const { data: coTeacher } = await supabase
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', bank.subject_id)
          .eq('teacher_id', user.id)
          .single();
        if (!coTeacher) {
          return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
        }
      }

      const { data: questions, error: qError } = await supabase
        .from('bank_questions')
        .select('*')
        .eq('bank_id', bankId)
        .order('created_at', { ascending: true });

      if (qError) {
        console.error('Error fetching bank questions:', qError);
      }

      return NextResponse.json({
        success: true,
        data: {
          ...bank,
          subject_name: (bank.subjects as { name: string })?.name || '',
          questions: questions || [],
        },
      });
    }

    // List banks
    let query = supabase
      .from('question_banks')
      .select('*, subjects(name)')
      .order('updated_at', { ascending: false });

    // Filter by subject if provided
    if (subjectId) {
      // SECURITY (audit #6): previously ANY authenticated user (e.g. a
      // student) could list every teacher's question banks for a subject
      // by passing its id. Require owner or co-teacher of the subject.
      const { data: subject } = await supabase
        .from('subjects')
        .select('teacher_id')
        .eq('id', subjectId)
        .single();

      if (!subject) {
        return NextResponse.json({ success: false, error: 'المقرر غير موجود' }, { status: 404 });
      }

      if (subject.teacher_id !== user.id) {
        const { data: coTeacher } = await supabase
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('teacher_id', user.id)
          .maybeSingle();
        if (!coTeacher) {
          return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
        }
      }

      query = query.eq('subject_id', subjectId);
    } else {
      // Only show the teacher's own banks
      query = query.eq('teacher_id', user.id);
    }

    const { data: banks, error } = await query;

    if (error) {
      console.error('Error fetching question banks:', error);
      return NextResponse.json({ success: false, error: 'حدث خطأ أثناء جلب بنوك الأسئلة' }, { status: 500 });
    }

    // Get question counts for each bank
    const bankIds = (banks || []).map((b: { id: string }) => b.id);
    let questionCounts: Record<string, number> = {};

    if (bankIds.length > 0) {
      const { data: counts } = await supabase
        .from('bank_questions')
        .select('bank_id')
        .in('bank_id', bankIds);

      if (counts) {
        counts.forEach((c: { bank_id: string }) => {
          questionCounts[c.bank_id] = (questionCounts[c.bank_id] || 0) + 1;
        });
      }
    }

    const enrichedBanks = (banks || []).map((bank: Record<string, unknown>) => ({
      ...bank,
      subject_name: (bank.subjects as { name: string } | null)?.name || '',
      question_count: questionCounts[bank.id as string] || 0,
      subjects: undefined,
    }));

    return NextResponse.json({ success: true, data: enrichedBanks });
  } catch (err) {
    console.error('Question bank GET error:', err);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

// -------------------------------------------------------
// POST — Create a question bank (with optional questions)
// -------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = supabaseServer;

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const body = await req.json();
    const { name, description, subject_id, questions } = body;

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'يرجى إدخال اسم بنك الأسئلة' }, { status: 400 });
    }
    if (!subject_id) {
      return NextResponse.json({ success: false, error: 'يرجى اختيار المقرر' }, { status: 400 });
    }

    // Verify the teacher owns or co-teaches this subject
    const { data: subject } = await supabase
      .from('subjects')
      .select('teacher_id')
      .eq('id', subject_id)
      .single();

    if (!subject) {
      return NextResponse.json({ success: false, error: 'المقرر غير موجود' }, { status: 404 });
    }

    if ((subject as { teacher_id: string }).teacher_id !== user.id) {
      const { data: coTeacher } = await supabase
        .from('subject_teachers')
        .select('id')
        .eq('subject_id', subject_id)
        .eq('teacher_id', user.id)
        .single();
      if (!coTeacher) {
        return NextResponse.json({ success: false, error: 'غير مصرح بإضافة بنك أسئلة لهذا المقرر' }, { status: 403 });
      }
    }

    // Create the bank
    const { data: bank, error: bankError } = await supabase
      .from('question_banks')
      .insert({
        teacher_id: user.id,
        subject_id,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (bankError || !bank) {
      console.error('Error creating question bank:', bankError);
      return NextResponse.json({ success: false, error: 'حدث خطأ أثناء إنشاء بنك الأسئلة' }, { status: 500 });
    }

    // Insert questions if provided (with duplicate protection)
    let addedCount = 0;
    let duplicatesSkipped = 0;
    if (questions && Array.isArray(questions) && questions.length > 0) {
      const normalizedAll = (questions as Record<string, unknown>[])
        .map((q) => normalizeQuestionRow(bank.id, q))
        .filter((r: NormalizedQuestionRow | null): r is NormalizedQuestionRow => r !== null);

      // New bank — dedup within the incoming list itself
      const { unique, duplicates } = filterDuplicateQuestions(normalizedAll, []);
      duplicatesSkipped = duplicates.length;

      if (unique.length > 0) {
        const { error: qError } = await supabase
          .from('bank_questions')
          .insert(unique);
        if (qError) {
          console.error('Error inserting bank questions:', qError);
          // Bank was created but questions failed — still return success
        } else {
          addedCount = unique.length;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: bank,
      addedCount,
      duplicatesSkipped,
    });
  } catch (err) {
    console.error('Question bank POST error:', err);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

// -------------------------------------------------------
// PUT — Update a question bank or its questions
// -------------------------------------------------------
export async function PUT(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = supabaseServer;

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const body = await req.json();
    const { bankId, name, description, questions, addQuestions, removeQuestionIds, aiGenerated } = body;

    if (!bankId) {
      return NextResponse.json({ success: false, error: 'يرجى تحديد بنك الأسئلة' }, { status: 400 });
    }

    // Verify ownership (+ dedup toggle)
    const { data: bank } = await supabase
      .from('question_banks')
      .select('teacher_id, dedup_enabled')
      .eq('id', bankId)
      .single();

    if (!bank || (bank as { teacher_id: string }).teacher_id !== user.id) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }

    const dedupEnabled = (bank as { dedup_enabled?: boolean }).dedup_enabled !== false;

    // Update bank metadata
    if (name !== undefined || description !== undefined) {
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || null;

      const { error: updateError } = await supabase
        .from('question_banks')
        .update(updateData)
        .eq('id', bankId);

      if (updateError) {
        console.error('Error updating question bank:', updateError);
        return NextResponse.json({ success: false, error: 'حدث خطأ أثناء تحديث بنك الأسئلة' }, { status: 500 });
      }
    }

    // Replace all questions (full update mode)
    if (questions && Array.isArray(questions)) {
      // Delete existing questions
      await supabase.from('bank_questions').delete().eq('bank_id', bankId);

      // Insert new questions (normalized + deduped within the list)
      if (questions.length > 0) {
        const normalizedAll = (questions as Record<string, unknown>[])
          .map((q) => normalizeQuestionRow(bankId, q))
          .filter((r: NormalizedQuestionRow | null): r is NormalizedQuestionRow => r !== null);

        const { unique, duplicates } = dedupEnabled
          ? filterDuplicateQuestions(normalizedAll, [])
          : { unique: normalizedAll, duplicates: [] as NormalizedQuestionRow[] };

        if (unique.length > 0) {
          const { error: qError } = await supabase
            .from('bank_questions')
            .insert(unique);

          if (qError) {
            console.error('Error replacing bank questions:', qError);
          }
        }

        return NextResponse.json({
          success: true,
          addedCount: unique.length,
          duplicatesSkipped: duplicates.length,
        });
      }

      return NextResponse.json({ success: true, addedCount: 0, duplicatesSkipped: 0 });
    }

    // Add individual questions (protected against bank duplicates)
    if (addQuestions && Array.isArray(addQuestions) && addQuestions.length > 0) {
      const normalizedAll = (addQuestions as Record<string, unknown>[])
        .map((q) => normalizeQuestionRow(bankId, q))
        .filter((r: NormalizedQuestionRow | null): r is NormalizedQuestionRow => r !== null);

      let toInsert = normalizedAll;
      let duplicatesSkipped = 0;

      if (dedupEnabled) {
        const existing = await loadExistingForDedup(bankId);
        const { unique, duplicates } = filterDuplicateQuestions(normalizedAll, existing);
        toInsert = unique;
        duplicatesSkipped = duplicates.length;
        if (duplicatesSkipped > 0) {
          console.log(`[Question Bank] Duplicate protection skipped ${duplicatesSkipped} question(s) for bank ${bankId}`);
        }
      }

      if (toInsert.length > 0) {
        const { error: qError } = await supabase
          .from('bank_questions')
          .insert(toInsert);

        if (qError) {
          console.error('Error adding bank questions:', qError);
        } else if (aiGenerated === true) {
          // Usage ledger: AI questions count even if they are deleted later.
          await supabaseServer.from('usage_events').insert(
            toInsert.map(() => ({ user_id: user.id, source: 'ai_question' })),
          );
        }
      }

      return NextResponse.json({
        success: true,
        addedCount: toInsert.length,
        duplicatesSkipped,
      });
    }

    // Remove individual questions by ID
    if (removeQuestionIds && Array.isArray(removeQuestionIds) && removeQuestionIds.length > 0) {
      await supabase
        .from('bank_questions')
        .delete()
        .in('id', removeQuestionIds);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Question bank PUT error:', err);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

// -------------------------------------------------------
// DELETE — Delete a question bank
// -------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = supabaseServer;

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const bankId = searchParams.get('bankId');

    if (!bankId) {
      return NextResponse.json({ success: false, error: 'يرجى تحديد بنك الأسئلة' }, { status: 400 });
    }

    // Verify ownership
    const { data: bank } = await supabase
      .from('question_banks')
      .select('teacher_id')
      .eq('id', bankId)
      .single();

    if (!bank || (bank as { teacher_id: string }).teacher_id !== user.id) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }

    // Delete (cascade will remove questions)
    const { error } = await supabase
      .from('question_banks')
      .delete()
      .eq('id', bankId);

    if (error) {
      console.error('Error deleting question bank:', error);
      return NextResponse.json({ success: false, error: 'حدث خطأ أثناء حذف بنك الأسئلة' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Question bank DELETE error:', err);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
