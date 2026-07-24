// =====================================================
// SCORM Support — TypeScript Type Definitions
// Matches the database schema in v60_scorm_support.sql
// =====================================================

// =====================================================
// SCORM Packages
// =====================================================

export type ScormVersion = '1.2' | '2004';
export type ScormPackageStatus = 'active' | 'draft' | 'archived';

export interface ScormPackage {
  id: string;
  title: string;
  description?: string | null;
  version: ScormVersion;
  manifest_xml: string;
  uploaded_by: string;
  subject_id: string;
  status: ScormPackageStatus;
  entry_point: string;
  total_objects: number;
  package_size: number;
  storage_path: string;
  created_at: string;
  updated_at: string;
  // Joined data (populated by API queries)
  uploader_name?: string;
  subject_name?: string;
  resources?: ScormResource[];
}

// =====================================================
// SCORM Resources (SCO items parsed from manifest)
// =====================================================

export type ScormResourceType = 'sco' | 'asset';

export interface ScormResource {
  id: string;
  package_id: string;
  identifier: string;
  title: string;
  type: ScormResourceType;
  href?: string | null;
  scorm_type: string;
  parent_identifier?: string | null;
  order_index: number;
  launch_url: string;
  // Joined data (populated by API queries)
  children?: ScormResource[];
}

// =====================================================
// SCORM Tracking (Student progress data)
// =====================================================

export type ScormCompletionStatus = 'not_attempted' | 'incomplete' | 'completed' | 'unknown';
export type ScormSuccessStatus = 'passed' | 'failed' | 'unknown';

export interface ScormTracking {
  id: string;
  student_id: string;
  package_id: string;
  resource_id: string;
  completion_status: ScormCompletionStatus;
  success_status: ScormSuccessStatus;
  score_raw?: number | null;
  score_min?: number | null;
  score_max?: number | null;
  score_scaled?: number | null;
  total_time: string;
  session_time: string;
  suspend_data?: string | null;
  launch_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  // Joined data (populated by API queries)
  student_name?: string;
  student_email?: string;
  student_avatar_url?: string | null;
  resource_title?: string;
  package_title?: string;
}

// =====================================================
// SCORM API Data Model — for launch/initialization
// =====================================================

export interface ScormLaunchData {
  package: ScormPackage;
  resource: ScormResource;
  tracking?: ScormTracking | null;
}

// =====================================================
// SCORM CMIDataModel — for SCORM 1.2/2004 API communication
// =====================================================

export interface ScormCmiData {
  // Core fields (SCORM 1.2)
  cmi_core_lesson_status: ScormCompletionStatus;
  cmi_core_score_raw: string;
  cmi_core_score_min: string;
  cmi_core_score_max: string;
  cmi_core_session_time: string;
  cmi_core_total_time: string;
  cmi_core_lesson_location: string;
  cmi_core_suspend_data: string;
  cmi_core_entry: 'ab-initio' | 'resume';
  cmi_core_credit: 'credit' | 'no-credit';
  cmi_core_mode: 'normal' | 'browse' | 'review';

  // SCORM 2004 additional fields
  cmi_completion_status?: ScormCompletionStatus;
  cmi_success_status?: ScormSuccessStatus;
  cmi_score_scaled?: string;
  cmi_score_raw?: string;
  cmi_score_min?: string;
  cmi_score_max?: string;
  cmi_progress_measure?: string;
  cmi_total_time?: string;
  cmi_session_time?: string;
  cmi_suspend_data?: string;
  cmi_location?: string;
  cmi_entry?: string;
  cmi_mode?: string;
  cmi_credit?: string;
}

// =====================================================
// SCORM API Request/Response types
// =====================================================

export interface ScormTrackingUpsertRequest {
  student_id: string;
  package_id: string;
  resource_id: string;
  completion_status?: ScormCompletionStatus;
  success_status?: ScormSuccessStatus;
  score_raw?: number | null;
  score_min?: number | null;
  score_max?: number | null;
  score_scaled?: number | null;
  session_time?: string;
  suspend_data?: string | null;
  launch_count?: number;
}

export interface ScormPackageUploadRequest {
  subject_id: string;
  title?: string;
  description?: string;
  version?: ScormVersion;
  status?: ScormPackageStatus;
}

export interface ScormTrackingSummary {
  package_id: string;
  package_title: string;
  total_students: number;
  completed_count: number;
  in_progress_count: number;
  not_attempted_count: number;
  average_score_raw: number;
  average_score_scaled: number;
  passed_count: number;
  failed_count: number;
}

export interface ScormStudentProgress {
  student_id: string;
  student_name: string;
  student_email: string;
  student_avatar_url?: string | null;
  package_id: string;
  package_title: string;
  completion_status: ScormCompletionStatus;
  success_status: ScormSuccessStatus;
  score_raw?: number | null;
  score_scaled?: number | null;
  total_time: string;
  launch_count: number;
  last_accessed: string;
  resource_progress: {
    resource_id: string;
    resource_title: string;
    completion_status: ScormCompletionStatus;
    success_status: ScormSuccessStatus;
    score_raw?: number | null;
  }[];
}
