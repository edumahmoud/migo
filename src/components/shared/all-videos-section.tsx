'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  FileVideo,
  Loader2,
  Search,
  Filter,
  User,
  Calendar,
  MessageSquare,
  Eye,
  ChevronLeft,
  Video,
  BookOpen,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, SubjectVideo, VideoComment } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AllVideosSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// -------------------------------------------------------
// Extended types
// -------------------------------------------------------
interface SubjectWithVideoCount extends Subject {
  video_count?: number;
}

interface VideoWithMeta extends SubjectVideo {
  uploader_name?: string;
  comment_count?: number;
  subject_name?: string;
  subject_color?: string;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AllVideosSection({ profile, role }: AllVideosSectionProps) {
  const [videos, setVideos] = useState<VideoWithMeta[]>([]);
  const [subjects, setSubjects] = useState<SubjectWithVideoCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ─── Video player state ───
  const [selectedVideo, setSelectedVideo] = useState<VideoWithMeta | null>(null);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // -------------------------------------------------------
  // Fetch all videos
  // -------------------------------------------------------
  const fetchVideos = useCallback(async () => {
    setLoading(true);
    try {
      // Get user's enrolled/owned subjects
      let subjectIds: string[] = [];

      if (role === 'teacher') {
        const { data: ownedSubjects } = await supabase
          .from('subjects')
          .select('id')
          .eq('teacher_id', profile.id);
        if (ownedSubjects) {
          subjectIds = ownedSubjects.map((s: { id: string }) => s.id);
        }
        // Also get co-taught subjects
        const { data: coTaught } = await supabase
          .from('subject_teachers')
          .select('subject_id')
          .eq('teacher_id', profile.id);
        if (coTaught) {
          const coIds = coTaught.map((c: { subject_id: string }) => c.subject_id);
          subjectIds = [...new Set([...subjectIds, ...coIds])];
        }
      } else {
        const { data: enrollments } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id)
          .eq('status', 'approved');
        if (enrollments) {
          subjectIds = enrollments.map((e: { subject_id: string }) => e.subject_id);
        }
      }

      if (subjectIds.length === 0) {
        setVideos([]);
        setSubjects([]);
        setLoading(false);
        return;
      }

      // Fetch subjects info
      const { data: subjectsData } = await supabase
        .from('subjects')
        .select('*')
        .in('id', subjectIds);

      const subjectMap = new Map<string, Subject>();
      if (subjectsData) {
        for (const s of subjectsData as Subject[]) {
          subjectMap.set(s.id, s);
        }
      }

      // Fetch all videos from these subjects
      const { data: videosData, error } = await supabase
        .from('subject_videos')
        .select('*')
        .in('subject_id', subjectIds)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching videos:', error);
      } else if (videosData && videosData.length > 0) {
        // Fetch uploader profiles
        const uploaderIds = [...new Set(videosData.map((v: SubjectVideo) => v.uploaded_by))];
        const uploaderMap = new Map<string, { name: string; title_id?: string | null; gender?: string | null; role?: string | null }>();

        const { data: uploaders } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', uploaderIds);

        if (uploaders) {
          for (const u of uploaders as { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }[]) {
            uploaderMap.set(u.id, u);
          }
        }

        // Fetch comment counts
        const videoIds = videosData.map((v: SubjectVideo) => v.id);
        const commentCountMap = new Map<string, number>();

        const { data: commentCounts } = await supabase
          .from('video_comments')
          .select('video_id')
          .in('video_id', videoIds);

        if (commentCounts) {
          for (const c of commentCounts as { video_id: string }[]) {
            commentCountMap.set(c.video_id, (commentCountMap.get(c.video_id) || 0) + 1);
          }
        }

        const enrichedVideos: VideoWithMeta[] = (videosData as SubjectVideo[]).map((v) => {
          const uploader = uploaderMap.get(v.uploaded_by);
          const subject = subjectMap.get(v.subject_id);
          return {
            ...v,
            uploader_name: uploader
              ? formatNameWithTitle(uploader.name, uploader.role, uploader.title_id, uploader.gender)
              : 'مستخدم',
            comment_count: commentCountMap.get(v.id) || 0,
            subject_name: subject?.name || 'مقرر غير معروف',
            subject_color: subject?.color,
          };
        });

        setVideos(enrichedVideos);

        // Build subjects with video counts
        const videoCountsBySubject = new Map<string, number>();
        for (const v of videosData as SubjectVideo[]) {
          videoCountsBySubject.set(v.subject_id, (videoCountsBySubject.get(v.subject_id) || 0) + 1);
        }

        const subjectsWithCounts: SubjectWithVideoCount[] = (subjectsData as Subject[])
          .map((s) => ({ ...s, video_count: videoCountsBySubject.get(s.id) || 0 }))
          .filter((s) => s.video_count > 0)
          .sort((a, b) => (b.video_count || 0) - (a.video_count || 0));

        setSubjects(subjectsWithCounts);
      } else {
        setVideos([]);
        setSubjects([]);
      }
    } catch (err) {
      console.error('Fetch all videos error:', err);
    } finally {
      setLoading(false);
    }
  }, [profile.id, role]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // -------------------------------------------------------
  // Fetch comments for a video
  // -------------------------------------------------------
  const fetchComments = useCallback(async (videoId: string) => {
    setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('video_comments')
        .select('*')
        .eq('video_id', videoId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching comments:', error);
      } else if (data && data.length > 0) {
        const userIds = [...new Set(data.map((c: VideoComment) => c.user_id))];
        const userMap = new Map<string, { name: string; title_id?: string | null; gender?: string | null; role?: string | null }>();
        const { data: users } = await supabase.from('users').select('id, name, title_id, gender, role').in('id', userIds);
        if (users) {
          for (const u of users as { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }[]) {
            userMap.set(u.id, u);
          }
        }
        setComments(
          (data as VideoComment[]).map((c) => {
            const user = userMap.get(c.user_id);
            return {
              ...c,
              user_name: user ? formatNameWithTitle(user.name, user.role, user.title_id, user.gender) : 'مستخدم',
              user_role: user?.role ?? undefined,
              user_title_id: user?.title_id ?? undefined,
              user_gender: user?.gender ?? undefined,
            };
          })
        );
      } else {
        setComments([]);
      }
    } catch (err) {
      console.error('Fetch comments error:', err);
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  // -------------------------------------------------------
  // Record unique view
  // -------------------------------------------------------
  const handleVideoPlay = async (videoId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { data: isFirstView } = await supabase.rpc('record_video_view', {
        p_video_id: videoId,
        p_user_id: userId,
      });

      if (isFirstView) {
        setVideos((prev) =>
          prev.map((v) => v.id === videoId ? { ...v, view_count: v.view_count + 1 } : v)
        );
        if (selectedVideo?.id === videoId) {
          setSelectedVideo((prev) => prev ? { ...prev, view_count: prev.view_count + 1 } : prev);
        }
      }
    } catch { /* non-critical */ }
  };

  // -------------------------------------------------------
  // Filtered videos
  // -------------------------------------------------------
  const filteredVideos = videos.filter((v) => {
    const matchesSubject = !selectedSubjectId || v.subject_id === selectedSubjectId;
    const matchesSearch = !searchQuery.trim() ||
      v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.subject_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.uploader_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSubject && matchesSearch;
  });

  // -------------------------------------------------------
  // Handle select video
  // -------------------------------------------------------
  const handleSelectVideo = (video: VideoWithMeta) => {
    setSelectedVideo(video);
    fetchComments(video.id);
  };

  const handleBackToList = () => {
    setSelectedVideo(null);
    setComments([]);
  };

  // -------------------------------------------------------
  // Render: Video Player
  // -------------------------------------------------------
  const renderVideoPlayer = () => {
    if (!selectedVideo) return null;

    return (
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
        <button
          onClick={handleBackToList}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          العودة للقائمة
        </button>

        <div className="overflow-hidden rounded-xl border bg-black">
          <video
            key={selectedVideo.video_url}
            controls
            autoPlay
            className="w-full max-h-[70vh] aspect-video"
            poster={selectedVideo.thumbnail_url || undefined}
            onPlay={() => handleVideoPlay(selectedVideo.id)}
          >
            <source src={selectedVideo.video_url} type={selectedVideo.video_type} />
            متصفحك لا يدعم تشغيل الفيديو.
          </video>
        </div>

        <div className="space-y-3">
          {/* Subject badge */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: selectedVideo.subject_color || '#0369A1' }}
            >
              <BookOpen className="h-3 w-3" />
              {selectedVideo.subject_name}
            </span>
          </div>
          <h2 className="text-xl font-bold text-foreground">{selectedVideo.title}</h2>
          {selectedVideo.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedVideo.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              {selectedVideo.uploader_name}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(selectedVideo.created_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {selectedVideo.view_count} مشاهدة
            </span>
            {selectedVideo.comment_count !== undefined && selectedVideo.comment_count > 0 && (
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                {selectedVideo.comment_count} تعليق
              </span>
            )}
          </div>
        </div>

        {/* Comments section */}
        {selectedVideo.comments_enabled && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              <h3 className="text-base font-bold text-foreground">التعليقات</h3>
              {comments.length > 0 && (
                <span className="rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 px-2 py-0.5 text-[11px] font-medium">
                  {comments.length}
                </span>
              )}
            </div>

            {commentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-300" />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">لا توجد تعليقات بعد</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {comments.map((comment) => (
                    <motion.div
                      key={comment.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="rounded-lg border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-foreground">
                              {comment.user_name || 'مستخدم'}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Video Grid
  // -------------------------------------------------------
  const renderVideoGrid = () => (
    <>
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Video className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            كل الفيديوهات
          </h3>
          <p className="text-muted-foreground text-sm mt-1 mb-3">
            {filteredVideos.length} فيديو من {subjects.length} مقرر
          </p>
        </div>
      </motion.div>

      {/* Search + Filter */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في الفيديوهات..."
              className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              dir="rtl"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800' : ''}
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        {/* Subject filter chips */}
        <AnimatePresence>
          {showFilters && subjects.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 flex-wrap pb-1">
                <button
                  onClick={() => setSelectedSubjectId(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    !selectedSubjectId
                      ? 'bg-sky-700 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  الكل
                </button>
                {subjects.map((subject) => (
                  <button
                    key={subject.id}
                    onClick={() => setSelectedSubjectId(subject.id === selectedSubjectId ? null : subject.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      selectedSubjectId === subject.id
                        ? 'text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                    style={selectedSubjectId === subject.id ? { backgroundColor: subject.color || '#0369A1' } : undefined}
                  >
                    {subject.name}
                    <span className="opacity-70">({subject.video_count})</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Video cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : filteredVideos.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <FileVideo className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">
            {searchQuery || selectedSubjectId ? 'لا توجد نتائج' : 'لا توجد فيديوهات'}
          </p>
          <p className="text-sm text-muted-foreground">
            {searchQuery || selectedSubjectId ? 'جرّب تغيير معايير البحث' : 'لم يتم رفع فيديوهات بعد في مقرراتك'}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {filteredVideos.map((video) => (
            <motion.div key={video.id} variants={itemVariants}>
              <Card
                className="group overflow-hidden transition-all border-border/60 cursor-pointer hover:shadow-lg"
                onClick={() => handleSelectVideo(video)}
              >
                <CardContent className="p-0">
                  {/* Thumbnail area */}
                  <div className="relative aspect-video bg-gradient-to-br from-sky-100 to-sky-200 dark:from-sky-900/40 dark:to-sky-800/40 overflow-hidden">
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt={video.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <FileVideo className="h-12 w-12 text-sky-500 dark:text-sky-400 opacity-60" />
                      </div>
                    )}
                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-6 w-6 text-white fill-white" />
                      </div>
                    </div>
                    {/* Duration badge */}
                    {video.duration && (
                      <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                    {/* Subject badge on thumbnail */}
                    <div className="absolute top-2 right-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white bg-black/50 backdrop-blur-sm"
                      >
                        <BookOpen className="h-2.5 w-2.5" />
                        {video.subject_name}
                      </span>
                    </div>
                  </div>

                  {/* Video info */}
                  <div className="p-4 space-y-2">
                    <h4 className="text-sm font-semibold text-foreground line-clamp-2 leading-relaxed">
                      {video.title}
                    </h4>
                    {video.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{video.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {video.uploader_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(video.created_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {video.view_count}
                      </span>
                      {video.comment_count !== undefined && video.comment_count > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {video.comment_count}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </>
  );

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
      dir="rtl"
    >
      {selectedVideo ? (
        <div key="player">{renderVideoPlayer()}</div>
      ) : (
        <div key="list">{renderVideoGrid()}</div>
      )}
    </motion.div>
  );
}
