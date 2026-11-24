'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  UserCog,
  Power,
  Check,
  X,
  Copy,
  AlertCircle,
  KeyRound,
  Users,
  Search,
  Building2,
  Mail,
  Phone,
  MapPin,
  BarChart3,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import MascotLoader from '@/components/shared/mascot-loader';

// ------------------------------------
// Types (local)
// ------------------------------------
type Kind = 'center' | 'external_office' | 'other';

interface RegistrationAgent {
  id: string;
  user_id: string;
  teacher_id: string;
  source_id: string | null;
  display_name: string | null;
  kind: Kind | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  students_count?: number;              // legacy alias of registrations_count
  registrations_count?: number;        // rows in subject_students (one per course enrollment)
  unique_students_count?: number;       // distinct student_id values
  // v114: per-agent allowed teacher sections. null = all allowed.
  allowed_sections?: string[] | null;
  user?: { id: string; email: string; name: string | null; username: string | null } | null;
}

interface AgentsAggregate {
  total_agents: number;
  total_registrations: number;
  total_unique_students: number;
}

interface AgentStudent {
  id: string;
  subject_id: string;
  student_id: string;
  status: string;
  enrollment_method: string;
  enrolled_at: string;
  subject?: { id: string; name: string; join_code: string | null; level: string | null; sub_level: string | null; is_paused: boolean } | null;
  student?: { id: string; email: string; name: string | null; student_code: string | null; username: string | null } | null;
}

interface DashboardData {
  success: boolean;
  agent: { id: string; display_name: string | null };
  totals: { total_registrations: number; total_unique_students: number; total_courses: number };
  per_course: Array<{ subject_id: string; subject_name: string; level: string | null; sub_level: string | null; students_count: number }>;
  per_month: Array<{ month: string; count: number }>;
  recent: Array<{ id: string; student_id: string; student_name: string | null; student_email: string | null; student_code: string | null; subject_id: string; subject_name: string | null; enrolled_at: string }>;
}



// v132: Agent sections that the teacher can grant per-agent.
// These match AGENT_SECTION_DEFS in src/components/agent/agent-portal.tsx.
// v132 reduced the list from 18 sub-sections to 9 top-level sections.
const TEACHER_SECTION_OPTIONS: Array<{ id: string; label: string; description: string }> = [
  { id: 'search',               label: 'regAgents.section.search.label',              description: 'regAgents.section.search.description' },
  { id: 'pendingOrders',        label: 'regAgents.section.pendingOrders.label',       description: 'regAgents.section.pendingOrders.description' },
  { id: 'dashboard',            label: 'regAgents.section.dashboard.label',           description: 'regAgents.section.dashboard.description' },
  { id: 'subjects',             label: 'regAgents.section.subjects.label',            description: 'regAgents.section.subjects.description' },
  { id: 'students',             label: 'regAgents.section.students.label',            description: 'regAgents.section.students.description' },
  { id: 'tracking',             label: 'regAgents.section.tracking.label',            description: 'regAgents.section.tracking.description' },
  { id: 'financialManagement',  label: 'regAgents.section.financialManagement.label', description: 'regAgents.section.financialManagement.description' },
  { id: 'calendar',             label: 'regAgents.section.calendar.label',            description: 'regAgents.section.calendar.description' },
  { id: 'reports',              label: 'regAgents.section.reports.label',             description: 'regAgents.section.reports.description' },
];

export default function RegistrationAgentsSection() {
  const { t } = useTranslations();

  const [agents, setAgents] = useState<RegistrationAgent[]>([]);
  const [aggregate, setAggregate] = useState<AgentsAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    display_name: '',
    kind: 'center' as Kind,
    contact_email: '',
    contact_phone: '',
    address: '',
    account_email: '',
    account_name: '',
  });
  const [saving, setSaving] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    tempPassword: string;
    name: string;
  } | null>(null);

  const [editTarget, setEditTarget] = useState<RegistrationAgent | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '',
    kind: 'center' as Kind,
    contact_email: '',
    contact_phone: '',
    address: '',
  });
  // v114: per-agent allowed_sections editing state.
  //   allowAll = true  → reset allowed_sections to null (all allowed)
  //   allowAll = false → use the Set to pick specific sections
  const [editAllowAll, setEditAllowAll] = useState(true);
  const [editAllowedSet, setEditAllowedSet] = useState<Set<string>>(new Set());
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<RegistrationAgent | null>(null);

  // Students dialog
  const [studentsTarget, setStudentsTarget] = useState<RegistrationAgent | null>(null);
  const [studentsList, setStudentsList] = useState<AgentStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // Dashboard dialog
  const [dashboardTarget, setDashboardTarget] = useState<RegistrationAgent | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/registration-agents', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        setAgents([]);
        setAggregate(null);
      } else {
        setAgents(json.agents as RegistrationAgent[]);
        setAggregate((json.aggregate as AgentsAggregate) ?? null);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredAgents = useMemo(() => {
    let list = agents;
    if (kindFilter !== 'all') {
      list = list.filter((a) => (a.kind ?? 'center') === kindFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => {
        const name = a.display_name || a.user?.name || '';
        const email = a.contact_email || a.user?.email || '';
        return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
      });
    }
    return list;
  }, [agents, kindFilter, search]);

  const totalAgents = agents.length;
  const activeAgents = agents.filter((a) => a.is_active).length;

  const openCreate = () => {
    setForm({
      display_name: '',
      kind: 'center',
      contact_email: '',
      contact_phone: '',
      address: '',
      account_email: '',
      account_name: '',
    });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!form.display_name.trim()) {
      toast.error(t('regAgents.nameRequired'));
      return;
    }
    if (!form.contact_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) {
      toast.error(t('regAgents.contactEmailInvalid'));
      return;
    }
    if (!form.account_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.account_email)) {
      toast.error(t('regAgents.accountEmailInvalid'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/registration-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success(t('regAgents.createSuccess'));
        setCreateOpen(false);
        setCreatedCreds({
          email: json.user.email,
          tempPassword: json.temporaryPassword,
          name: json.user.name,
        });
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (a: RegistrationAgent) => {
    setEditTarget(a);
    setEditForm({
      display_name: a.display_name ?? '',
      kind: (a.kind ?? 'center') as Kind,
      contact_email: a.contact_email ?? '',
      contact_phone: a.contact_phone ?? '',
      address: a.address ?? '',
    });
    // v114: initialize permission editor state.
    //   null  = all allowed → allowAll=true, empty set
    //   array = restrict   → allowAll=false, set from array
    const arr = a.allowed_sections ?? null;
    setEditAllowAll(arr === null);
    setEditAllowedSet(new Set(arr ?? []));
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.display_name.trim()) {
      toast.error(t('regAgents.nameRequired'));
      return;
    }
    setEditSaving(true);
    try {
      // v114: include allowed_sections in the PATCH body.
      //   allowAll=true  → null  (resets to "all sections allowed")
      //   allowAll=false → sorted array (empty array means no teacher sections)
      const allowedSections = editAllowAll ? null : Array.from(editAllowedSet).sort();
      const res = await fetch(`/api/teacher/registration-agents/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ ...editForm, allowed_sections: allowedSections }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success(t('regAgents.updateSuccess'));
        setEditTarget(null);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setEditSaving(false);
    }
  };

  const toggleActive = async (a: RegistrationAgent, next: boolean) => {
    try {
      const res = await fetch(`/api/teacher/registration-agents/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: next }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      toast.success(next ? t('regAgents.activateSuccess') : t('regAgents.deactivateSuccess'));
      await load();
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/teacher/registration-agents/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success(t('regAgents.deleteSuccess'));
        setDeleteTarget(null);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const openStudents = async (a: RegistrationAgent) => {
    setStudentsTarget(a);
    setStudentsList([]);
    setStudentsLoading(true);
    try {
      const res = await fetch(`/api/teacher/registration-agents/${a.id}/students`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        setStudentsList(json.students as AgentStudent[]);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setStudentsLoading(false);
    }
  };

  const openDashboard = async (a: RegistrationAgent) => {
    setDashboardTarget(a);
    setDashboard(null);
    setDashboardLoading(true);
    try {
      const res = await fetch(`/api/teacher/registration-agents/${a.id}/dashboard`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        setDashboard(json as DashboardData);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setDashboardLoading(false);
    }
  };

  const copyCreds = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('regAgents.copied', { label: label }));
    } catch {
      toast.error(t('regAgents.copyFailed'));
    }
  };

  // (totalAgents/activeAgents already computed above alongside the filter)

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <UserCog className="h-5 w-5 text-sky-600" />
            {t('regAgents.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('regAgents.subtitle')}
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 me-1" />
          {t('regAgents.newAgent')}
        </Button>
      </div>

      {/* Aggregate dashboard cards */}
      {!loading && agents.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="border-sky-200 bg-sky-50/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('regAgents.totalAgents')}</span>
                <UserCog className="h-4 w-4 text-sky-600" />
              </div>
              <div className="text-2xl font-bold mt-1">{totalAgents}</div>
              <div className="text-xs text-muted-foreground">{t('regAgents.activeCount', { count: activeAgents })}</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('regAgents.totalRegistrations')}</span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold mt-1">{aggregate?.total_registrations ?? 0}</div>
              <div className="text-xs text-muted-foreground">{t('regAgents.registrationsInCourses')}</div>
            </CardContent>
          </Card>
          <Card className="border-teal-200 bg-teal-50/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('regAgents.uniqueStudents')}</span>
                <Users className="h-4 w-4 text-teal-600" />
              </div>
              <div className="text-2xl font-bold mt-1">{aggregate?.total_unique_students ?? 0}</div>
              <div className="text-xs text-muted-foreground">{t('regAgents.studentsAcrossAgents')}</div>
            </CardContent>
          </Card>
          <Card className="border-purple-200 bg-purple-50/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('regAgents.centersCount')}</span>
                <Building2 className="h-4 w-4 text-purple-600" />
              </div>
              <div className="text-2xl font-bold mt-1">
                {agents.filter((a) => (a.kind ?? 'center') === 'center').length}
              </div>
              <div className="text-xs text-muted-foreground">{t('regAgents.mainCenter')}</div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('regAgents.externalOffices')}</span>
                <Building2 className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold mt-1">
                {agents.filter((a) => a.kind === 'external_office').length}
              </div>
              <div className="text-xs text-muted-foreground">{t('regAgents.externalOffice')}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search + filter */}
      {!loading && agents.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('regAgents.searchPlaceholder')}
              className="ps-10"
            />
          </div>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder={t('regAgents.allTypes')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('regAgents.allTypes')}</SelectItem>
              <SelectItem value="center">{t('regAgents.kind.center')}</SelectItem>
              <SelectItem value="external_office">{t('regAgents.kind.externalOffice')}</SelectItem>
              <SelectItem value="other">{t('regAgents.kind.other')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Agents grid */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <MascotLoader kind="ai" size={72} />
        </div>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <UserCog className="h-10 w-10 mx-auto mb-3 opacity-30" />
            {t('regAgents.emptyState')}
          </CardContent>
        </Card>
      ) : filteredAgents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t('regAgents.noResults')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAgents.map((a) => {
            const name = a.display_name ?? a.user?.name ?? '—';
            return (
              <Card
                key={a.id}
                className={`overflow-hidden ${a.is_active ? '' : 'opacity-70 border-amber-300'}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        <span className="truncate">{name}</span>
                        {a.is_active ? (
                          <Badge variant="default" className="text-xs shrink-0">{t('regAgents.active')}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs shrink-0">{t('regAgents.disabledBadge')}</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1 flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {t(`regAgents.kind.${a.kind === 'external_office' ? 'externalOffice' : (a.kind ?? 'center')}`)}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(a)}
                        aria-label={t('regAgents.editAria')}
                        title={t('regAgents.editTitle')}
                      >
                        <UserCog className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTarget(a)}
                        aria-label={t('regAgents.deleteAria')}
                        title={t('regAgents.deleteTitle')}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Contact info */}
                  <div className="text-xs text-muted-foreground space-y-1">
                    {a.contact_email && (
                      <div className="flex items-center gap-1.5 truncate" dir="ltr">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{a.contact_email}</span>
                      </div>
                    )}
                    {a.contact_phone && (
                      <div className="flex items-center gap-1.5" dir="ltr">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{a.contact_phone}</span>
                      </div>
                    )}
                    {a.address && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{a.address}</span>
                      </div>
                    )}
                  </div>

                  {/* Stats: registrations (rows in subject_students) + unique students */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-200/50 px-2 py-1.5">
                      <div className="text-[10px] text-muted-foreground">{t('regAgents.registrations')}</div>
                      <div className="flex items-baseline gap-1">
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">
                          {a.registrations_count ?? a.students_count ?? 0}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{t('regAgents.inCourses')}</span>
                      </div>
                    </div>
                    <div className="rounded-md bg-teal-50/60 dark:bg-teal-900/15 border border-teal-200/50 px-2 py-1.5">
                      <div className="text-[10px] text-muted-foreground">{t('regAgents.uniqueStudents')}</div>
                      <div className="flex items-baseline gap-1">
                        <span className="font-bold text-teal-700 dark:text-teal-300">
                          {a.unique_students_count ?? 0}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{t('regAgents.studentUnit')}</span>
                      </div>
                    </div>
                  </div>

                  {/* v114: permission badge */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                    <Badge
                      variant={a.allowed_sections === null || a.allowed_sections === undefined ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
                      {a.allowed_sections === null || a.allowed_sections === undefined
                        ? t('regAgents.allSections')
                        : t('regAgents.allowedSectionsCount', { count: a.allowed_sections.length })}
                    </Badge>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDashboard(a)}
                      className="text-xs flex-1"
                      title={t('regAgents.dashboardTitle')}
                    >
                      <BarChart3 className="h-3.5 w-3.5 me-1" />
                      {t('regAgents.dashboardButton')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openStudents(a)}
                      className="text-xs flex-1"
                    >
                      <Users className="h-3.5 w-3.5 me-1" />
                      {t('regAgents.studentsButton')}
                    </Button>
                    {a.is_active ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => toggleActive(a, false)}
                        className="text-xs"
                        title={t('regAgents.deactivateTitle')}
                      >
                        <Power className="h-3.5 w-3.5 me-1" />
                        {t('regAgents.deactivate')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => toggleActive(a, true)}
                        className="text-xs bg-emerald-600 hover:bg-emerald-700"
                        title={t('regAgents.activateTitle')}
                      >
                        <Power className="h-3.5 w-3.5 me-1" />
                        {t('regAgents.activate')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create agent dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('regAgents.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('regAgents.createDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ra-display-name">{t('regAgents.agentNameLabel')}</Label>
                <Input
                  id="ra-display-name"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder={t('regAgents.agentNamePlaceholder')}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.kindLabel')}</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm({ ...form, kind: v as Kind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="center">{t('regAgents.kind.center')}</SelectItem>
                    <SelectItem value="external_office">{t('regAgents.kind.externalOffice')}</SelectItem>
                    <SelectItem value="other">{t('regAgents.kind.other')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ra-contact-email">{t('regAgents.contactEmailLabel')}</Label>
              <Input
                id="ra-contact-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                placeholder="contact@center.com"
                dir="ltr"
                maxLength={254}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ra-contact-phone">{t('regAgents.contactPhoneLabel')}</Label>
                <Input
                  id="ra-contact-phone"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  dir="ltr"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ra-address">{t('regAgents.addressLabel')}</Label>
                <Input
                  id="ra-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  maxLength={300}
                />
              </div>
            </div>

            <div className="border-t pt-3 mt-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">{t('regAgents.accountSection')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="ra-account-email">{t('regAgents.accountEmailLabel')}</Label>
                  <Input
                    id="ra-account-email"
                    type="email"
                    value={form.account_email}
                    onChange={(e) => setForm({ ...form, account_email: e.target.value })}
                    placeholder="login@center.com"
                    dir="ltr"
                    maxLength={254}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ra-account-name">{t('regAgents.accountNameLabel')}</Label>
                  <Input
                    id="ra-account-name"
                    value={form.account_name}
                    onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                    maxLength={120}
                    placeholder={t('regAgents.accountNamePlaceholder')}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('regAgents.passwordNote')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              <X className="h-4 w-4 me-1" />
              {t('common.cancel')}
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              {t('regAgents.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('regAgents.editDialogTitle')}</DialogTitle>
            <DialogDescription>{t('regAgents.editDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('regAgents.nameLabel')}</Label>
                <Input
                  value={editForm.display_name}
                  onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.kindLabel')}</Label>
                <Select
                  value={editForm.kind}
                  onValueChange={(v) => setEditForm({ ...editForm, kind: v as Kind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="center">{t('regAgents.kind.center')}</SelectItem>
                    <SelectItem value="external_office">{t('regAgents.kind.externalOffice')}</SelectItem>
                    <SelectItem value="other">{t('regAgents.kind.other')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('regAgents.contactEmailShort')}</Label>
              <Input
                type="email"
                value={editForm.contact_email}
                onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                dir="ltr"
                maxLength={254}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('regAgents.contactPhoneShort')}</Label>
                <Input
                  value={editForm.contact_phone}
                  onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })}
                  dir="ltr"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.addressShort')}</Label>
                <Input
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  maxLength={300}
                />
              </div>
            </div>

            {/* v114: per-agent permission editor */}
            <div className="border-t pt-3 mt-2 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">{t('regAgents.sectionsPermission')}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t('regAgents.sectionsPermissionDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="allow-all-switch" className="text-xs cursor-pointer">
                    {t('regAgents.allSectionsShort')}
                  </Label>
                  <Switch
                    id="allow-all-switch"
                    checked={editAllowAll}
                    onCheckedChange={setEditAllowAll}
                  />
                </div>
              </div>

              {!editAllowAll && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {t('regAgents.allowedSectionsOf', { count: editAllowedSet.size, total: TEACHER_SECTION_OPTIONS.length })}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setEditAllowedSet(new Set(TEACHER_SECTION_OPTIONS.map(s => s.id)))}
                      >
                        {t('regAgents.selectAll')}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setEditAllowedSet(new Set())}
                      >
                        {t('regAgents.clearAll')}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto rounded-md border border-border/60 p-2">
                    {TEACHER_SECTION_OPTIONS.map((sec) => {
                      const checked = editAllowedSet.has(sec.id);
                      return (
                        <label
                          key={sec.id}
                          className={`flex items-start gap-2 rounded px-2 py-2 text-xs cursor-pointer transition-colors ${
                            checked
                              ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              setEditAllowedSet((prev) => {
                                const next = new Set(prev);
                                if (c) next.add(sec.id);
                                else next.delete(sec.id);
                                return next;
                              });
                            }}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{t(sec.label)}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                              {t(sec.description)}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {editAllowedSet.size === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {t('regAgents.noSectionsWarning')}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitEdit} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              {t('regAgents.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show temp credentials ONCE */}
      <Dialog open={!!createdCreds} onOpenChange={(o) => !o && setCreatedCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-sky-600" />
              {t('regAgents.credsTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('regAgents.credsDesc')}
            </DialogDescription>
          </DialogHeader>
          {createdCreds && (
            <div className="space-y-3">
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {t('regAgents.credsWarning')}
                </span>
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.nameLabel')}</Label>
                <div className="text-sm">{createdCreds.name}</div>
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.accountEmailFull')}</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted px-2 py-1 rounded" dir="ltr">
                    {createdCreds.email}
                  </code>
                  <Button size="icon" variant="ghost" onClick={() => copyCreds(createdCreds.email, t('regAgents.emailLabel'))}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t('regAgents.tempPasswordLabel')}</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-mono bg-muted px-2 py-1 rounded tracking-widest">
                    {createdCreds.tempPassword}
                  </code>
                  <Button size="icon" variant="ghost" onClick={() => copyCreds(createdCreds.tempPassword, t('regAgents.passwordLabel'))}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs p-3">
                {t('regAgents.loginNote')}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedCreds(null)}>
              <Check className="h-4 w-4 me-1" />
              {t('regAgents.credsSaved')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent students dialog */}
      <Dialog open={!!studentsTarget} onOpenChange={(o) => !o && setStudentsTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-sky-600" />
              {t('regAgents.studentsOf', { name: studentsTarget?.display_name ?? studentsTarget?.user?.name ?? '—' })}
            </DialogTitle>
            <DialogDescription>
              {t('regAgents.studentsListDesc')}
            </DialogDescription>
          </DialogHeader>
          {studentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
            </div>
          ) : studentsList.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              {t('regAgents.noStudents')}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-start text-muted-foreground border-b">
                    <th className="py-2 px-2 text-start">{t('regAgents.colStudent')}</th>
                    <th className="py-2 px-2 text-start">{t('regAgents.colEmail')}</th>
                    <th className="py-2 px-2 text-start">{t('regAgents.colStudentCode')}</th>
                    <th className="py-2 px-2 text-start">{t('regAgents.colCourse')}</th>
                    <th className="py-2 px-2 text-start">{t('regAgents.colDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {studentsList.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">{s.student?.name ?? '—'}</td>
                      <td className="py-2 px-2" dir="ltr">{s.student?.email ?? '—'}</td>
                      <td className="py-2 px-2 font-mono text-xs">{s.student?.student_code ?? '—'}</td>
                      <td className="py-2 px-2">{s.subject?.name ?? '—'}</td>
                      <td className="py-2 px-2 text-xs">
                        {s.enrolled_at ? new Date(s.enrolled_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentsTarget(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Financial dashboard dialog */}
      <Dialog open={!!dashboardTarget} onOpenChange={(o) => !o && setDashboardTarget(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-sky-600" />
              {t('regAgents.dashboardOf', { name: dashboardTarget?.display_name ?? '—' })}
            </DialogTitle>
            <DialogDescription>
              {t('regAgents.dashboardDesc')}
            </DialogDescription>
          </DialogHeader>
          {dashboardLoading ? (
            <div className="flex items-center justify-center py-12">
              <MascotLoader kind="ai" size={72} />
            </div>
          ) : dashboard ? (
            <div className="space-y-5">
              {/* Totals */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-sky-200 bg-sky-50/40">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">{t('regAgents.totalRegistrations')}</div>
                    <div className="text-2xl font-bold text-sky-700">
                      {dashboard.totals.total_registrations}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/40">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">{t('regAgents.uniqueStudentsCount')}</div>
                    <div className="text-2xl font-bold text-emerald-700">
                      {dashboard.totals.total_unique_students}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-purple-200 bg-purple-50/40">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">{t('regAgents.coursesCount')}</div>
                    <div className="text-2xl font-bold text-purple-700">
                      {dashboard.totals.total_courses}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Per-course table */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <Building2 className="h-4 w-4" />
                  {t('regAgents.registrationsByCourse')}
                </h4>
                {dashboard.per_course.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">{t('regAgents.noCourses')}</div>
                ) : (
                  <div className="overflow-x-auto max-h-48 overflow-y-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-start text-muted-foreground border-b">
                          <th className="py-2 px-3 text-start">{t('regAgents.colCourse')}</th>
                          <th className="py-2 px-3 text-start">{t('regAgents.colLevel')}</th>
                          <th className="py-2 px-3 text-end">{t('regAgents.colStudentsCount')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.per_course
                          .sort((a, b) => b.students_count - a.students_count)
                          .map((c) => (
                            <tr key={c.subject_id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 px-3">{c.subject_name}</td>
                              <td className="py-2 px-3 text-xs text-muted-foreground">
                                {[c.level, c.sub_level].filter(Boolean).join(' / ') || '—'}
                              </td>
                              <td className="py-2 px-3 text-end font-mono font-semibold">
                                {c.students_count}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Per-month mini bar chart */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {t('regAgents.monthlyRegistrations')}
                </h4>
                <div className="flex items-end gap-1 h-24 border-b border-muted">
                  {dashboard.per_month.map((m) => {
                    const maxCount = Math.max(1, ...dashboard.per_month.map((x) => x.count));
                    const height = Math.max(2, (m.count / maxCount) * 90);
                    return (
                      <div
                        key={m.month}
                        className="flex-1 flex flex-col items-center justify-end gap-1"
                        title={`${m.month}: ${m.count}`}
                      >
                        <div
                          className="w-full bg-gradient-to-t from-sky-600 to-teal-400 rounded-t-sm transition-all"
                          style={{ height: `${height}%` }}
                        />
                        <span className="text-[8px] text-muted-foreground rotate-0 truncate w-full text-center">
                          {m.month.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent registrations */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  {t('regAgents.recentRegistrations')}
                </h4>
                {dashboard.recent.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">{t('regAgents.noRegistrations')}</div>
                ) : (
                  <div className="overflow-x-auto max-h-48 overflow-y-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-muted-foreground border-b">
                          <th className="py-2 px-3 text-start">{t('regAgents.colStudent')}</th>
                          <th className="py-2 px-3 text-start">{t('regAgents.colCode')}</th>
                          <th className="py-2 px-3 text-start">{t('regAgents.colCourse')}</th>
                          <th className="py-2 px-3 text-start">{t('regAgents.colDate')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.recent.map((r) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 px-3">{r.student_name ?? '—'}</td>
                            <td className="py-2 px-3 font-mono text-xs">{r.student_code ?? '—'}</td>
                            <td className="py-2 px-3">{r.subject_name ?? '—'}</td>
                            <td className="py-2 px-3 text-xs">
                              {r.enrolled_at ? new Date(r.enrolled_at).toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDashboardTarget(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('regAgents.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('regAgents.deleteConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              {t('regAgents.deleteLabel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
