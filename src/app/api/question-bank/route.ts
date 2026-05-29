// =====================================================
// Question Bank API — CRUD for question banks and questions
// =====================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export const maxDuration = 60;

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

    // Insert questions if provided
    if (questions && Array.isArray(questions) && questions.length > 0) {
      const questionRows = questions.map((q: Record<string, unknown>) => ({
        bank_id: (bank as { id: string }).id,
        type: q.type,
        question: q.question,
        options: q.options || null,
        correct_answer: q.correct_answer || q.correctAnswer || null,
        pairs: q.pairs || null,
        difficulty: q.difficulty || null,
        category: q.category || null,
      }));

      const { error: qError } = await supabase
        .from('bank_questions')
        .insert(questionRows);

      if (qError) {
        console.error('Error inserting bank questions:', qError);
        // Bank was created but questions failed — still return success
      }
    }

    return NextResponse.json({ success: true, data: bank });
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
    const { bankId, name, description, questions, addQuestions, removeQuestionIds } = body;

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

      // Insert new questions
      if (questions.length > 0) {
        const questionRows = questions.map((q: Record<string, unknown>) => {
        const rawPairs = (q.pairs || q.matching_pairs || q.matchingPairs || q.pair_list) as Record<string, string>[] | null | undefined;
        const normalizedPairs = Array.isArray(rawPairs) && rawPairs.length > 0
          ? rawPairs.map((p: Record<string, string>) => ({
              key: p.key ?? p.term ?? p.left ?? '',
              value: p.value ?? p.definition ?? p.right ?? '',
            })).filter((p: { key: string; value: string }) => p.key && p.value)
          : null;
        return {
          bank_id: bankId,
          type: q.type,
          question: q.question,
          options: q.options || null,
          correct_answer: q.correct_answer || q.correctAnswer || null,
          pairs: normalizedPairs,
          difficulty: q.difficulty || null,
          category: q.category || null,
        };
      });

        const { error: qError } = await supabase
          .from('bank_questions')
          .insert(questionRows);

        if (qError) {
          console.error('Error replacing bank questions:', qError);
        }
      }
    }

    // Add individual questions
    if (addQuestions && Array.isArray(addQuestions) && addQuestions.length > 0) {
      const questionRows = addQuestions.map((q: Record<string, unknown>) => {
        const rawPairs = (q.pairs || q.matching_pairs || q.matchingPairs || q.pair_list) as Record<string, string>[] | null | undefined;
        const normalizedPairs = Array.isArray(rawPairs) && rawPairs.length > 0
          ? rawPairs.map((p: Record<string, string>) => ({
              key: p.key ?? p.term ?? p.left ?? '',
              value: p.value ?? p.definition ?? p.right ?? '',
            })).filter((p: { key: string; value: string }) => p.key && p.value)
          : null;
        return {
          bank_id: bankId,
          type: q.type,
          question: q.question,
          options: q.options || null,
          correct_answer: q.correct_answer || q.correctAnswer || null,
          pairs: normalizedPairs,
          difficulty: q.difficulty || null,
          category: q.category || null,
        };
      });

      const { error: qError } = await supabase
        .from('bank_questions')
        .insert(questionRows);

      if (qError) {
        console.error('Error adding bank questions:', qError);
      }
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
