'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Trash2,
  Edit3,
  UserPlus,
  UserMinus,
  Shuffle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Palette,
  Check,
  X,
  AlertCircle,
  Download,
  FileSpreadsheet,
  ClipboardList,
  CheckSquare,
  Square,
  BarChart3,
  Send,
  MessageSquare,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile } from '@/lib/types';
import * as XLSX from 'xlsx';
import { useI18n } from '@/lib/i18n/context';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface Team {
  id: string;
  name: string;
  level: string | null;
  color: string;
  created_at: string;
  member_count?: number;
}

interface TeamMember {
  id: string;
  student_id: string;
  joined_at: string;
  user: UserProfile | null;
}

interface TeamsTabProps {
  subjectId: string;
  profile: UserProfile;
}

// -------------------------------------------------------
// Color options
// -------------------------------------------------------
const TEAM_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#0D9488',
  '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16',
  '#f97316', '#14b8a6', '#a855f7', '#e11d48',
];

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export default function TeamsTab({ subjectId, profile }: TeamsTabProps) {
  const { t, dir } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Record<string, TeamMember[]>>({});
  const [unassigned, setUnassigned] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formLevel, setFormLevel] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
  const [autoTeamCount, setAutoTeamCount] = useState(2);
  const [saving, setSaving] = useState(false);

  // Export state
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());

  // Performance assign state
  const [perfAssignOpen, setPerfAssignOpen] = useState(false);
  const [perfTeamCount, setPerfTeamCount] = useState(3);

  // Group message state
  const [msgTeamId, setMsgTeamId] = useState<string | null>(null);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);

  // -------------------------------------------------------
  // Data fetching — single optimized function
  // -------------------------------------------------------
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const headers = { 'Authorization': `Bearer ${token}` };

      // Fetch teams list
      const teamsRes = await fetch(`/api/teams?action=list&subjectId=${subjectId}`, { headers });
      const teamsData = await teamsRes.json();

      if (teamsData.teams && teamsData.teams.length > 0) {
        setTeams(teamsData.teams);

        // Fetch members for all teams in parallel
        const memberResults = await Promise.all(
          teamsData.teams.map(async (team: Team) => {
            const res = await fetch(`/api/teams?action=members&teamId=${team.id}`, { headers });
            const data = await res.json();
            return { teamId: team.id, members: data.members || [] };
          })
        );

        const membersMap: Record<string, TeamMember[]> = {};
        memberResults.forEach(r => { membersMap[r.teamId] = r.members; });
        setMembers(membersMap);
      } else {
        setTeams([]);
      }

      // Fetch unassigned students
      const unassignedRes = await fetch(`/api/teams?action=unassigned&subjectId=${subjectId}`, { headers });
      const unassignedData = await unassignedRes.json();
      setUnassigned(unassignedData.students || []);
    } catch (err) {
      console.error('Fetch teams data error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // -------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------
  const handleCreateTeam = async () => {
    if (!formName.trim()) {
      toast.error('اسم المجموعة مطلوب');
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          subjectId,
          name: formName.trim(),
          level: formLevel.trim() || undefined,
          color: formColor,
        }),
      });
      const data = await res.json();
      if (data.team) {
        toast.success('تم إنشاء المجموعة بنجاح');
        setCreateOpen(false);
        setFormName('');
        setFormLevel('');
        setFormColor('#6366f1');
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل إنشاء المجموعة');
      }
    } catch {
      toast.error('حدث خطأ أثناء إنشاء المجموعة');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTeam = async () => {
    if (!editTeam || !formName.trim()) {
      toast.error('اسم المجموعة مطلوب');
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          teamId: editTeam.id,
          name: formName.trim(),
          level: formLevel.trim() || null,
          color: formColor,
        }),
      });
      const data = await res.json();
      if (data.team) {
        toast.success('تم تحديث المجموعة بنجاح');
        setEditTeam(null);
        setFormName('');
        setFormLevel('');
        setFormColor('#6366f1');
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل تحديث المجموعة');
      }
    } catch {
      toast.error('حدث خطأ أثناء تحديث المجموعة');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه المجموعة؟ سيتم إزالة جميع الأعضاء.')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', teamId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف المجموعة');
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل حذف المجموعة');
      }
    } catch {
      toast.error('حدث خطأ أثناء حذف المجموعة');
    }
  };

  const handleAddMember = async (teamId: string, studentId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-member', teamId, studentId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تمت إضافة العضو');
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل إضافة العضو');
      }
    } catch {
      toast.error('حدث خطأ أثناء إضافة العضو');
    }
  };

  const handleRemoveMember = async (teamId: string, studentId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-member', teamId, studentId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تمت إزالة العضو');
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل إزالة العضو');
      }
    } catch {
      toast.error('حدث خطأ أثناء إزالة العضو');
    }
  };

  const handleAutoAssign = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-assign', subjectId, teamCount: autoTeamCount }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم توزيع ${data.assignedCount} طالب على ${data.teamCount} مجموعة`);
        setAutoAssignOpen(false);
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل التوزيع التلقائي');
      }
    } catch {
      toast.error('حدث خطأ أثناء التوزيع التلقائي');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (team: Team) => {
    setEditTeam(team);
    setFormName(team.name);
    setFormLevel(team.level || '');
    setFormColor(team.color);
  };

  // -------------------------------------------------------
  // Auto-assign by performance
  // -------------------------------------------------------
  const handlePerformanceAssign = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-assign-by-performance', subjectId, teamCount: perfTeamCount }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم توزيع ${data.assignedCount} طالب على ${data.teamCount} مجموعة حسب الأداء${data.studentsWithoutScores > 0 ? ` (${data.studentsWithoutScores} طالب بدون درجات)` : ''}`);
        setPerfAssignOpen(false);
        fetchAllData();
      } else {
        toast.error(data.error || 'فشل التوزيع حسب الأداء');
      }
    } catch {
      toast.error('حدث خطأ أثناء التوزيع حسب الأداء');
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // Send group message
  // -------------------------------------------------------
  const handleSendGroupMessage = async () => {
    if (!msgTeamId || !msgText.trim()) return;
    setMsgSending(true);
    try {
      const teamMembersList = members[msgTeamId] || [];
      if (teamMembersList.length === 0) {
        toast.error('لا يوجد أعضاء في هذه المجموعة');
        setMsgSending(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      // Use the existing /api/notify endpoint with a custom action
      // We'll send individual notifications to each team member
      const studentIds = teamMembersList.map(m => m.student_id);

      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'team_message',
          studentIds,
          message: msgText.trim(),
          teacherName: profile.name,
        }),
      });

      if (res.ok) {
        toast.success(`تم إرسال الملاحظة إلى ${teamMembersList.length} طالب`);
        setMsgTeamId(null);
        setMsgText('');
      } else {
        // Fallback: save notifications directly via Supabase
        const notifInserts = studentIds.map(sid => ({
          user_id: sid,
          title: 'ملاحظة من المعلم',
          message: msgText.trim(),
          type: 'team_message',
          link: `team:${msgTeamId}`,
          is_read: false,
        }));

        const { error: notifError } = await supabase
          .from('notifications')
          .insert(notifInserts);

        if (notifError) {
          toast.error('فشل إرسال الملاحظة');
        } else {
          toast.success(`تم إرسال الملاحظة إلى ${teamMembersList.length} طالب`);
          setMsgTeamId(null);
          setMsgText('');
        }
      }
    } catch {
      toast.error('حدث خطأ أثناء إرسال الملاحظة');
    } finally {
      setMsgSending(false);
    }
  };

  // -------------------------------------------------------
  // Export to Excel
  // -------------------------------------------------------
  const handleExportAll = () => {
    if (teams.length === 0) {
      toast.error('لا توجد مجموعات للتنزيل');
      return;
    }
    try {
      const wb = XLSX.utils.book_new();

      teams.forEach((team) => {
        const teamMembers = members[team.id] || [];
        const sheetData = teamMembers.map((member, idx) => ({
          '#': idx + 1,
          'الاسم': member.user ? formatNameWithTitle(member.user.name, member.user.role, member.user.title_id, member.user.gender) : 'مستخدم',
          'البريد الإلكتروني': member.user?.email || '',
          'تاريخ الانضمام': member.joined_at ? new Date(member.joined_at).toLocaleDateString('ar-SA') : '',
        }));

        // Add team info header row
        const headerRow = {
          '#': '',
          'الاسم': `المجموعة: ${team.name}${team.level ? ' | المستوى: ' + team.level : ''}`,
          'البريد الإلكتروني': `عدد الأعضاء: ${teamMembers.length}`,
          'تاريخ الانضمام': '',
        };

        const ws = XLSX.utils.json_to_sheet([headerRow, ...sheetData]);

        // Set column widths
        ws['!cols'] = [
          { wch: 5 },   // #
          { wch: 30 },  // الاسم
          { wch: 35 },  // البريد
          { wch: 15 },  // التاريخ
        ];

        // Sheet name must be <= 31 chars and no special chars
        const sheetName = team.name.replace(/[\\/\?\*\[\]]/g, '').substring(0, 31) || 'Sheet';
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      XLSX.writeFile(wb, `المجموعات_${new Date().toLocaleDateString('ar-SA')}.xlsx`);
      toast.success('تم تنزيل الملف بنجاح');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('حدث خطأ أثناء تنزيل الملف');
    }
  };

  const handleExportSelected = () => {
    if (selectedTeamIds.size === 0) {
      toast.error('يرجى تحديد مجموعة واحدة على الأقل');
      return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const selectedTeams = teams.filter(t => selectedTeamIds.has(t.id));

      selectedTeams.forEach((team) => {
        const teamMembers = members[team.id] || [];
        const sheetData = teamMembers.map((member, idx) => ({
          '#': idx + 1,
          'الاسم': member.user ? formatNameWithTitle(member.user.name, member.user.role, member.user.title_id, member.user.gender) : 'مستخدم',
          'البريد الإلكتروني': member.user?.email || '',
          'تاريخ الانضمام': member.joined_at ? new Date(member.joined_at).toLocaleDateString('ar-SA') : '',
        }));

        const headerRow = {
          '#': '',
          'الاسم': `المجموعة: ${team.name}${team.level ? ' | المستوى: ' + team.level : ''}`,
          'البريد الإلكتروني': `عدد الأعضاء: ${teamMembers.length}`,
          'تاريخ الانضمام': '',
        };

        const ws = XLSX.utils.json_to_sheet([headerRow, ...sheetData]);
        ws['!cols'] = [
          { wch: 5 },
          { wch: 30 },
          { wch: 35 },
          { wch: 15 },
        ];

        const sheetName = team.name.replace(/[\\/\?\*\[\]]/g, '').substring(0, 31) || 'Sheet';
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      XLSX.writeFile(wb, `مجموعات_محددة_${new Date().toLocaleDateString('ar-SA')}.xlsx`);
      toast.success(`تم تنزيل ${selectedTeamIds.size} مجموعة بنجاح`);
      setExportOpen(false);
      setSelectedTeamIds(new Set());
    } catch (err) {
      console.error('Export selected error:', err);
      toast.error('حدث خطأ أثناء تنزيل الملف');
    }
  };

  const toggleTeamSelection = (teamId: string) => {
    setSelectedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTeamIds.size === teams.length) {
      setSelectedTeamIds(new Set());
    } else {
      setSelectedTeamIds(new Set(teams.map(t => t.id)));
    }
  };

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-sky-700" />
        <span className="ms-3 text-muted-foreground">جاري تحميل المجموعات...</span>
      </div>
    );
  }

  // -------------------------------------------------------
  // Render: Create/Edit Team Dialog
  // -------------------------------------------------------
  const renderTeamFormDialog = () => {
    const isOpen = createOpen || !!editTeam;
    const isEdit = !!editTeam;
    return (
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditTeam(null); setFormName(''); setFormLevel(''); setFormColor('#6366f1'); }
      }}>
        <DialogContent className="sm:max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'تعديل المجموعة' : 'إنشاء مجموعة جديدة'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>اسم المجموعة *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: مجموعة أ" className="mt-1" />
            </div>
            <div>
              <Label>المستوى (اختياري)</Label>
              <Input value={formLevel} onChange={(e) => setFormLevel(e.target.value)} placeholder="مثال: مبتدئ، متوسط، متقدم" className="mt-1" />
            </div>
            <div>
              <Label>اللون</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {TEAM_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center"
                    style={{ backgroundColor: c, borderColor: formColor === c ? '#fff' : 'transparent', outline: formColor === c ? `2px solid ${c}` : 'none' }}
                  >
                    {formColor === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditTeam(null); }}>
              إلغاء
            </Button>
            <Button onClick={isEdit ? handleUpdateTeam : handleCreateTeam} disabled={saving || !formName.trim()} className="bg-sky-700 hover:bg-sky-800">
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              {isEdit ? 'حفظ التعديلات' : 'إنشاء'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // -------------------------------------------------------
  // Render: Auto-Assign Dialog
  // -------------------------------------------------------
  const renderAutoAssignDialog = () => (
    <Dialog open={autoAssignOpen} onOpenChange={setAutoAssignOpen}>
      <DialogContent className="sm:max-w-sm" dir={dir}>
        <DialogHeader>
          <DialogTitle>توزيع تلقائي على المجموعات</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            سيتم توزيع جميع الطلاب المسجلين بالتساوي على المجموعات.
            {teams.length > 0 ? ` يوجد حالياً ${teams.length} مجموعة.` : ' سيتم إنشاء مجموعات جديدة.'}
          </p>
          <div>
            <Label>عدد المجموعات</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={autoTeamCount}
              onChange={(e) => setAutoTeamCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setAutoAssignOpen(false)}>إلغاء</Button>
          <Button onClick={handleAutoAssign} disabled={saving} className="bg-sky-700 hover:bg-sky-800">
            {saving ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Shuffle className="h-4 w-4 me-2" />}
            توزيع تلقائي
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // -------------------------------------------------------
  // Render: Add Member Dialog
  // -------------------------------------------------------
  const renderAddMemberDialog = () => (
    <Dialog open={!!addMemberTeamId} onOpenChange={(open) => { if (!open) setAddMemberTeamId(null); }}>
      <DialogContent className="sm:max-w-md max-h-[80vh]" dir={dir}>
        <DialogHeader>
          <DialogTitle>إضافة عضو للمجموعة</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto max-h-96 space-y-2 py-2">
          {unassigned.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Users className="h-8 w-8" />
              <p className="text-sm">لا يوجد طلاب غير مخصصين لمجموعة</p>
            </div>
          ) : (
            unassigned.map(student => (
              <div key={student.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted transition-colors">
                <div className="flex items-center gap-3">
                  <UserAvatar name={student.name || 'مستخدم'} avatarUrl={student.avatar_url} size="sm" />
                  <span className="text-sm font-medium">{formatNameWithTitle(student.name, student.role, student.title_id, student.gender)}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (addMemberTeamId) {
                      handleAddMember(addMemberTeamId, student.id);
                    }
                  }}
                  className="text-sky-700 hover:text-sky-800"
                >
                  <UserPlus className="h-4 w-4 me-1" />
                  إضافة
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  // -------------------------------------------------------
  // Render: Team Card
  // -------------------------------------------------------
  const renderTeamCard = (team: Team) => {
    const teamMembers = members[team.id] || [];
    const isExpanded = expandedTeam === team.id;

    return (
      <motion.div
        key={team.id}
        variants={itemVariants}
        className="rounded-xl border bg-card shadow-sm overflow-hidden"
      >
        {/* Team Header */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-10 rounded-full" style={{ backgroundColor: team.color }} />
            <div>
              <h3 className="font-semibold text-sm">{team.name}</h3>
              {team.level && (
                <Badge variant="secondary" className="text-xs mt-1">{team.level}</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {team.member_count || teamMembers.length} عضو
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <Edit3 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(team)}>
                  <Edit3 className="h-4 w-4 me-2" />
                  تعديل
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddMemberTeamId(team.id)}>
                  <UserPlus className="h-4 w-4 me-2" />
                  إضافة عضو
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setMsgTeamId(team.id); setMsgText(''); }}>
                  <MessageSquare className="h-4 w-4 me-2" />
                  إرسال ملاحظة
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDeleteTeam(team.id)} className="text-red-600">
                  <Trash2 className="h-4 w-4 me-2" />
                  حذف
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Team Members */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2 border-t pt-3">
                {teamMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">لا يوجد أعضاء في هذه المجموعة</p>
                ) : (
                  teamMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={member.user?.name || 'مستخدم'} avatarUrl={member.user?.avatar_url} size="sm" />
                        <span className="text-sm">{member.user ? formatNameWithTitle(member.user.name, member.user.role, member.user.title_id, member.user.gender) : 'مستخدم'}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveMember(team.id, member.student_id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-sky-700" />
            {t('course.teams')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            قسّم طلاب المقرر إلى مجموعات ومستويات
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={teams.length === 0}>
                <Download className="h-4 w-4" />
                تنزيل Excel
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportAll}>
                <FileSpreadsheet className="h-4 w-4 me-2" />
                تنزيل كل المجموعات
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSelectedTeamIds(new Set()); setExportOpen(true); }}>
                <CheckSquare className="h-4 w-4 me-2" />
                تحديد مجموعات
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoAssignOpen(true)}
            className="gap-2"
          >
            <Shuffle className="h-4 w-4" />
            توزيع تلقائي
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPerfAssignOpen(true)}
            className="gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            تقسيم حسب الأداء
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setFormName('');
              setFormLevel('');
              setFormColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]);
              setCreateOpen(true);
            }}
            className="bg-sky-700 hover:bg-sky-800 gap-2"
          >
            <Plus className="h-4 w-4" />
            مجموعة جديدة
          </Button>
        </div>
      </div>

      {/* Teams List */}
      {teams.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 py-16 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">لا يوجد فرق بعد</h3>
            <p className="text-sm text-muted-foreground mt-1">
              أنشئ فرقاً لتقسيم طلاب المقرر أو استخدم التوزيع التلقائي
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setAutoAssignOpen(true)}
              className="gap-2"
            >
              <Shuffle className="h-4 w-4" />
              توزيع تلقائي
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-sky-700 hover:bg-sky-800 gap-2"
            >
              <Plus className="h-4 w-4" />
              إنشاء مجموعة
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {teams.map(renderTeamCard)}
        </motion.div>
      )}

      {/* Unassigned Students */}
      {unassigned.length > 0 && (
        <div className="rounded-xl border border-dashed p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            طلاب غير مخصصين لمجموعة ({unassigned.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {unassigned.map(student => (
              <Badge key={student.id} variant="secondary" className="gap-1 py-1.5 px-3">
                {student.name || 'مستخدم'}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* EXPORT: Select Teams Dialog                  */}
      {/* ============================================ */}
      <Dialog open={exportOpen} onOpenChange={(open) => { if (!open) { setExportOpen(false); setSelectedTeamIds(new Set()); } }}>
        <DialogContent className="sm:max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-sky-700" />
              تحديد مجموعات للتنزيل
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Select all toggle */}
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 w-full rounded-lg border p-3 hover:bg-muted/50 transition-colors text-sm font-medium"
            >
              {selectedTeamIds.size === teams.length ? (
                <CheckSquare className="h-4 w-4 text-sky-700 shrink-0" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              تحديد الكل
            </button>

            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {teams.map((team) => {
                const teamMembers = members[team.id] || [];
                const isSelected = selectedTeamIds.has(team.id);
                return (
                  <button
                    key={team.id}
                    onClick={() => toggleTeamSelection(team.id)}
                    className="flex items-center justify-between gap-3 w-full p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-sky-700 shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="w-3 h-8 rounded-full" style={{ backgroundColor: team.color }} />
                      <div className="text-right">
                        <p className="text-sm font-medium">{team.name}</p>
                        {team.level && <p className="text-xs text-muted-foreground">{team.level}</p>}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {team.member_count || teamMembers.length} عضو
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setExportOpen(false); setSelectedTeamIds(new Set()); }}>
              إلغاء
            </Button>
            <Button
              onClick={handleExportSelected}
              disabled={selectedTeamIds.size === 0}
              className="bg-sky-700 hover:bg-sky-800 gap-2"
            >
              <Download className="h-4 w-4" />
              تنزيل ({selectedTeamIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogs */}
      {renderTeamFormDialog()}
      {renderAutoAssignDialog()}
      {renderAddMemberDialog()}

      {/* Performance Assign Dialog */}
      <Dialog open={perfAssignOpen} onOpenChange={setPerfAssignOpen}>
        <DialogContent className="sm:max-w-sm" dir={dir}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-sky-700" />
              تقسيم حسب الأداء
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              سيتم تقسيم الطلاب إلى مجموعات حسب مستوى أدائهم في اختبارات المقرر.
              الطلاب ذوو الأداء المرتفع في مجموعة، والمتوسط في أخرى، وهكذا.
            </p>
            <div>
              <Label>عدد المستويات</Label>
              <Input
                type="number"
                min={2}
                max={5}
                value={perfTeamCount}
                onChange={(e) => setPerfTeamCount(Math.max(2, Math.min(5, parseInt(e.target.value) || 2)))}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                2 = متقدم/مبتدئ، 3 = متقدم/متوسط/مبتدئ
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPerfAssignOpen(false)}>إلغاء</Button>
            <Button onClick={handlePerformanceAssign} disabled={saving} className="bg-sky-700 hover:bg-sky-800">
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <BarChart3 className="h-4 w-4 me-2" />}
              تقسيم حسب الأداء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Message Dialog */}
      <Dialog open={!!msgTeamId} onOpenChange={(open) => { if (!open) { setMsgTeamId(null); setMsgText(''); } }}>
        <DialogContent className="sm:max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-teal-600" />
              إرسال ملاحظة للمجموعة
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              ستصل الملاحظة لأعضاء هذه المجموعة فقط ولن يراها الطلاب في المجموعات الأخرى.
            </p>
            <div>
              <Label>نص الملاحظة</Label>
              <textarea
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="اكتب ملاحظتك هنا..."
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600 transition-colors min-h-[100px] resize-y"
                dir={dir}
                disabled={msgSending}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setMsgTeamId(null); setMsgText(''); }} disabled={msgSending}>إلغاء</Button>
            <Button
              onClick={handleSendGroupMessage}
              disabled={msgSending || !msgText.trim()}
              className="bg-teal-600 hover:bg-teal-700 text-white gap-2"
            >
              {msgSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              إرسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
