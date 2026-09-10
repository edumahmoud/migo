'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers,
  Plus,
  Loader2,
  Trash2,
  Edit3,
  Save,
  X,
  GripVertical,
  BookOpen,
  AlertCircle,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Subject, LessonUnit } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';

interface LessonUnitsSectionProps {
  subject: Subject;
  /** Called when units are updated, so parent can refetch lessons */
  onUnitsChanged?: () => void;
}

export default function LessonUnitsSection({ subject, onUnitsChanged }: LessonUnitsSectionProps) {
  const { t } = useTranslations('lessons');
  const [units, setUnits] = useState<LessonUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingUnit, setEditingUnit] = useState<LessonUnit | null>(null);
  const [deleteUnit, setDeleteUnit] = useState<LessonUnit | null>(null);
  const [saving, setSaving] = useState(false);

  // New unit form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passThreshold, setPassThreshold] = useState<number>(60);
  const [isPublished, setIsPublished] = useState(true);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lesson-units?subject_id=${subject.id}`, {
        headers: await getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch units');
      const data = await res.json();
      setUnits(data.units || []);
    } catch (err) {
      console.error('[LessonUnitsSection] Fetch error:', err);
      toast.error(t('unitsFetchError') || 'Failed to load units');
    } finally {
      setLoading(false);
    }
  }, [subject.id, t]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPassThreshold(60);
    setIsPublished(true);
    setEditingUnit(null);
  };

  const openAddDialog = () => {
    resetForm();
    setShowAddDialog(true);
  };

  const openEditDialog = (unit: LessonUnit) => {
    setEditingUnit(unit);
    setTitle(unit.title);
    setDescription(unit.description || '');
    setPassThreshold(unit.pass_threshold ?? 60);
    setIsPublished(unit.is_published);
    setShowAddDialog(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t('unitTitleRequired') || 'Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subject_id: subject.id,
        title: title.trim(),
        description: description.trim() || null,
        pass_threshold: passThreshold,
        is_published: isPublished,
      };

      const authHeaders = await getAuthHeaders();
      let res: Response;
      if (editingUnit) {
        res = await fetch(`/api/lesson-units/${editingUnit.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/lesson-units', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }

      toast.success(editingUnit ? t('unitUpdated') || 'Unit updated' : t('unitCreated') || 'Unit created');
      setShowAddDialog(false);
      resetForm();
      fetchUnits();
      onUnitsChanged?.();
    } catch (err: any) {
      console.error('[LessonUnitsSection] Save error:', err);
      toast.error(err.message || 'Failed to save unit');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteUnit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/lesson-units/${deleteUnit.id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }
      toast.success(t('unitDeleted') || 'Unit deleted');
      setDeleteUnit(null);
      fetchUnits();
      onUnitsChanged?.();
    } catch (err: any) {
      console.error('[LessonUnitsSection] Delete error:', err);
      toast.error(err.message || 'Failed to delete unit');
    } finally {
      setSaving(false);
    }
  };

  const moveUnit = async (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === units.length - 1) return;

    const newOrder = [...units];
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    [newOrder[index], newOrder[swapWith]] = [newOrder[swapWith], newOrder[index]];
    setUnits(newOrder);

    const reorderHeaders = await getAuthHeaders();
    try {
      await fetch('/api/lesson-units/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...reorderHeaders },
        body: JSON.stringify({
          subject_id: subject.id,
          ordered_unit_ids: newOrder.map((u) => u.id),
        }),
      });
    } catch (err) {
      console.error('[LessonUnitsSection] Reorder error:', err);
      toast.error(t('reorderFailed') || 'Failed to reorder');
      fetchUnits(); // revert
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">{t('unitsTitle') || 'Units & Modules'}</h3>
          {units.length > 0 && (
            <Badge variant="secondary">{units.length}</Badge>
          )}
        </div>
        <Button size="sm" onClick={openAddDialog}>
          <Plus className="h-4 w-4 me-1" />
          {t('addUnit') || 'Add Unit'}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : units.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-lg">
          <Layers className="h-10 w-10 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mb-3">
            {t('noUnits') || 'No units yet. Create your first unit to organize lessons into modules.'}
          </p>
          <Button variant="outline" size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4 me-1" />
            {t('addFirstUnit') || 'Add First Unit'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {units.map((unit, index) => (
            <motion.div
              key={unit.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="flex items-start gap-2 p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow"
            >
              <div className="flex flex-col gap-0.5 pt-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => moveUnit(index, 'up')}
                  disabled={index === 0}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => moveUnit(index, 'down')}
                  disabled={index === units.length - 1}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{unit.title}</span>
                  {!unit.is_published && (
                    <Badge variant="outline" className="text-xs">
                      {t('unitDraft') || 'Draft'}
                    </Badge>
                  )}
                  {typeof unit.lesson_count === 'number' && (
                    <Badge variant="secondary" className="text-xs">
                      <BookOpen className="h-3 w-3 me-1" />
                      {unit.lesson_count}
                    </Badge>
                  )}
                  {unit.pass_threshold != null && (
                    <Badge variant="outline" className="text-xs">
                      {t('passThreshold') || 'Pass'}: {unit.pass_threshold}%
                    </Badge>
                  )}
                </div>
                {unit.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {unit.description}
                  </p>
                )}
              </div>

              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEditDialog(unit)}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setDeleteUnit(unit)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingUnit ? t('editUnit') || 'Edit Unit' : t('addUnit') || 'Add Unit'}
            </DialogTitle>
            <DialogDescription>
              {t('unitDialogDesc') || 'Group lessons into modules and set pass thresholds to gate student progression.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="unit-title">{t('unitTitle') || 'Unit Title'}</Label>
              <Input
                id="unit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('unitTitlePlaceholder') || 'e.g. Unit 1: Introduction'}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-desc">{t('unitDescription') || 'Description'}</Label>
              <Textarea
                id="unit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('unitDescPlaceholder') || 'Optional description of what this unit covers'}
                rows={3}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-threshold">
                {t('passThreshold') || 'Pass Threshold'} (%)
              </Label>
              <Input
                id="unit-threshold"
                type="number"
                min={0}
                max={100}
                value={passThreshold}
                onChange={(e) => setPassThreshold(Number(e.target.value))}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                {t('passThresholdHint') || 'Students must achieve this score to advance to the next unit. Set to 0 to disable.'}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="unit-published">{t('published') || 'Published'}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('unitPublishedHint') || 'When off, students cannot see this unit.'}
                </p>
              </div>
              <Switch
                id="unit-published"
                checked={isPublished}
                onCheckedChange={setIsPublished}
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={saving}>
              {t('cancel') || 'Cancel'}
            </Button>
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              <Save className="h-4 w-4 me-1" />
              {editingUnit ? t('save') || 'Save' : t('create') || 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUnit} onOpenChange={(o) => !o && setDeleteUnit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteUnitTitle') || 'Delete Unit'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteUnitConfirm') || 'Are you sure you want to delete this unit? Lessons inside will remain but become unassigned.'}
              <br />
              <strong>{deleteUnit?.title}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t('cancel') || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {t('delete') || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
