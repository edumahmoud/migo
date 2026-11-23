// =====================================================
// SCORM RTE engine (pure, runs in the browser)
// Implements the LMS side of SCORM 1.2 (window.API) and SCORM 2004 (window.API_1484_11)
// with correct data model element names, read/write rules and error codes.
// =====================================================

export type ScormApiVersion = '1.2' | '2004';

/** Values sent to the server. status/lesson_status are raw SCORM values; the server normalizes them. */
export interface ScormSnapshot {
  lesson_status?: string;
  completion_status?: string;
  success_status?: string;
  score_raw?: string;
  score_min?: string;
  score_max?: string;
  score_scaled?: string;
  /** Raw session time as set by the SCO ('' if it never set one) */
  session_time: string;
  suspend_data: string;
}

export interface ScormEngineHooks {
  /** Called when a tracked value changed (status, score, suspend data) */
  onChange?: (snapshot: ScormSnapshot) => void;
  /** Called on Commit and on Finish/Terminate */
  onCommit?: (snapshot: ScormSnapshot, final: boolean) => void;
}

type Api = Record<string, (...args: string[]) => string>;

const MAX_SUSPEND_12 = 4096;
const MAX_SUSPEND_2004 = 64000;

// ───────── SCORM 1.2 ─────────

const READ_ONLY_12 = new Set([
  'cmi.core._children',
  'cmi.core.student_id',
  'cmi.core.student_name',
  'cmi.core.credit',
  'cmi.core.entry',
  'cmi.core.total_time',
  'cmi.core.lesson_mode',
  'cmi.core.score._children',
  'cmi.launch_data',
  'cmi.comments_from_lms',
  'cmi.objectives._children',
  'cmi.objectives._count',
  'cmi.interactions._children',
  'cmi.interactions._count',
  'cmi.student_data._children',
  'cmi.student_data.mastery_score',
  'cmi.student_data.max_time_allowed',
  'cmi.student_data.time_limit_action',
  'cmi.student_preference._children',
]);
const WRITE_ONLY_12 = new Set(['cmi.core.exit', 'cmi.core.session_time']);
const LESSON_STATUS_12 = new Set(['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted']);

const ERRORS_12: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '201': 'Invalid argument error',
  '202': 'Element cannot have children',
  '203': 'Element not an array. Cannot have count',
  '301': 'Not initialized',
  '401': 'Not implemented error',
  '402': 'Invalid set value, element is a keyword',
  '403': 'Element is read only',
  '404': 'Element is write only',
  '405': 'Incorrect Data Type',
};

function isNumeric(v: string): boolean {
  return v.trim() !== '' && Number.isFinite(Number(v));
}

/** SCORM 1.2 CMITimespan: HHHH:MM:SS.SS */
function isTimespan12(v: string): boolean {
  return /^\d{2,4}:[0-5]\d:[0-5]\d(\.\d{1,2})?$/.test(v);
}

export function createScorm12Api(initial: Record<string, unknown>, hooks: ScormEngineHooks = {}): Api {
  const str = (v: unknown, d = '') => (v === undefined || v === null || v === '' ? d : String(v));
  const cmi: Record<string, string> = {
    'cmi.core._children': 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
    'cmi.core.student_id': str(initial.cmi_core_student_id),
    'cmi.core.student_name': str(initial.cmi_core_student_name),
    'cmi.core.lesson_location': str(initial.cmi_core_lesson_location),
    'cmi.core.credit': str(initial.cmi_core_credit, 'credit'),
    'cmi.core.lesson_status': str(initial.cmi_core_lesson_status, 'not attempted'),
    'cmi.core.entry': str(initial.cmi_core_entry, 'ab-initio'),
    'cmi.core.score._children': 'raw,min,max',
    'cmi.core.score.raw': str(initial.cmi_core_score_raw),
    'cmi.core.score.min': str(initial.cmi_core_score_min),
    'cmi.core.score.max': str(initial.cmi_core_score_max),
    'cmi.core.total_time': str(initial.cmi_core_total_time, '0000:00:00'),
    'cmi.core.lesson_mode': str(initial.cmi_core_mode, 'normal'),
    'cmi.core.exit': '',
    'cmi.core.session_time': '',
    'cmi.suspend_data': str(initial.cmi_core_suspend_data),
    'cmi.launch_data': '',
    'cmi.comments': '',
    'cmi.comments_from_lms': '',
    'cmi.objectives._children': 'id,score,status',
    'cmi.objectives._count': '0',
    'cmi.interactions._children': 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
    'cmi.interactions._count': '0',
    'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
    'cmi.student_preference._children': 'audio,language,speed,text',
  };

  let initialized = false;
  let finished = false;
  let lastError = '0';
  const fail = (code: string): string => {
    lastError = code;
    return 'false';
  };

  const snapshot = (): ScormSnapshot => ({
    lesson_status: cmi['cmi.core.lesson_status'],
    score_raw: cmi['cmi.core.score.raw'],
    score_min: cmi['cmi.core.score.min'],
    score_max: cmi['cmi.core.score.max'],
    session_time: cmi['cmi.core.session_time'],
    suspend_data: cmi['cmi.suspend_data'],
  });

  return {
    LMSInitialize: (param) => {
      if (param !== '') return fail('201');
      if (initialized) return fail('101');
      initialized = true;
      lastError = '0';
      // Spec: the LMS marks a fresh attempt as incomplete once the SCO starts
      if (cmi['cmi.core.lesson_status'] === 'not attempted') cmi['cmi.core.lesson_status'] = 'incomplete';
      return 'true';
    },
    LMSFinish: (param) => {
      if (param !== '') return fail('201');
      if (!initialized || finished) return fail('301');
      finished = true;
      lastError = '0';
      hooks.onCommit?.(snapshot(), true);
      return 'true';
    },
    LMSGetValue: (element) => {
      if (!initialized || finished) {
        fail('301');
        return '';
      }
      if (WRITE_ONLY_12.has(element)) {
        fail('404');
        return '';
      }
      if (element in cmi) {
        lastError = '0';
        return cmi[element];
      }
      if (/\._children$/.test(element) || /\._count$/.test(element)) {
        fail('202');
        return '';
      }
      fail('401');
      return '';
    },
    LMSSetValue: (element, value) => {
      if (!initialized || finished) return fail('301');
      if (READ_ONLY_12.has(element)) return fail('403');
      const v = String(value);
      switch (element) {
        case 'cmi.core.lesson_status':
          if (!LESSON_STATUS_12.has(v)) return fail('405');
          break;
        case 'cmi.core.score.raw':
        case 'cmi.core.score.min':
        case 'cmi.core.score.max':
          if (v !== '' && (!isNumeric(v) || Number(v) < 0 || Number(v) > 100)) return fail('405');
          break;
        case 'cmi.core.session_time':
          if (!isTimespan12(v)) return fail('405');
          break;
        case 'cmi.core.exit':
          if (!['time-out', 'suspend', 'logout', ''].includes(v)) return fail('405');
          break;
        case 'cmi.suspend_data':
          if (v.length > MAX_SUSPEND_12) return fail('405');
          break;
        case 'cmi.core.lesson_location':
          if (v.length > 255) return fail('405');
          break;
        default:
          // Collections (objectives, interactions, preferences, comments): accepted but not stored
          if (!(element in cmi)) {
            if (/^cmi\.(objectives|interactions|student_preference)\./.test(element)) {
              lastError = '0';
              return 'true';
            }
            return fail('401');
          }
      }
      cmi[element] = v;
      lastError = '0';
      if (
        element === 'cmi.core.lesson_status' ||
        element.startsWith('cmi.core.score.') ||
        element === 'cmi.suspend_data'
      ) {
        hooks.onChange?.(snapshot());
      }
      return 'true';
    },
    LMSCommit: (param) => {
      if (param !== '') return fail('201');
      if (!initialized || finished) return fail('301');
      lastError = '0';
      hooks.onCommit?.(snapshot(), false);
      return 'true';
    },
    LMSGetLastError: () => lastError,
    LMSGetErrorString: (code) => ERRORS_12[String(code)] || 'Unknown error',
    LMSGetDiagnostic: (code) => ERRORS_12[String(code || lastError)] || 'Unknown error',
  };
}

// ───────── SCORM 2004 ─────────

const READ_ONLY_2004 = new Set([
  'cmi._version',
  'cmi.completion_threshold',
  'cmi.credit',
  'cmi.entry',
  'cmi.launch_data',
  'cmi.learner_id',
  'cmi.learner_name',
  'cmi.max_time_allowed',
  'cmi.mode',
  'cmi.scaled_passing_score',
  'cmi.time_limit_action',
  'cmi.total_time',
  'cmi.score._children',
  'cmi.comments_from_learner._children',
  'cmi.comments_from_lms._children',
  'cmi.interactions._children',
  'cmi.objectives._children',
  'cmi.learner_preference._children',
]);
const WRITE_ONLY_2004 = new Set(['cmi.exit', 'cmi.session_time']);
const COMPLETION_2004 = new Set(['completed', 'incomplete', 'not attempted', 'unknown']);
const SUCCESS_2004 = new Set(['passed', 'failed', 'unknown']);

const ERRORS_2004: Record<string, string> = {
  '0': 'No Error',
  '101': 'General Exception',
  '102': 'General Initialization Failure',
  '103': 'Already Initialized',
  '104': 'Content Instance Terminated',
  '111': 'General Termination Failure',
  '112': 'Termination Before Initialization',
  '113': 'Termination After Termination',
  '122': 'Retrieve Data Before Initialization',
  '123': 'Retrieve Data After Termination',
  '132': 'Store Data Before Initialization',
  '133': 'Store Data After Termination',
  '142': 'Commit Before Initialization',
  '143': 'Commit After Termination',
  '201': 'General Argument Error',
  '301': 'General Get Failure',
  '351': 'General Set Failure',
  '391': 'General Commit Failure',
  '401': 'Undefined Data Model Element',
  '402': 'Unimplemented Data Model Element',
  '403': 'Data Model Element Value Not Initialized',
  '404': 'Data Model Element Is Read Only',
  '405': 'Data Model Element Is Write Only',
  '406': 'Data Model Element Type Mismatch',
  '407': 'Data Model Element Value Out Of Range',
  '408': 'Data Model Dependency Not Established',
};

/** ISO 8601 duration check for cmi.session_time */
function isIsoDuration(v: string): boolean {
  return /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d{1,2})?S)?)?$/.test(v);
}

export function createScorm2004Api(initial: Record<string, unknown>, hooks: ScormEngineHooks = {}): Api {
  const str = (v: unknown, d = '') => (v === undefined || v === null || v === '' ? d : String(v));
  const cmi: Record<string, string> = {
    'cmi._version': '1.0',
    'cmi.completion_status': str(initial.cmi_completion_status, 'unknown'),
    'cmi.success_status': str(initial.cmi_success_status, 'unknown'),
    'cmi.score._children': 'scaled,raw,min,max',
    'cmi.score.scaled': str(initial.cmi_score_scaled),
    'cmi.score.raw': str(initial.cmi_score_raw),
    'cmi.score.min': str(initial.cmi_score_min),
    'cmi.score.max': str(initial.cmi_score_max),
    'cmi.progress_measure': str(initial.cmi_progress_measure),
    'cmi.completion_threshold': '',
    'cmi.total_time': str(initial.cmi_total_time, 'PT0H0M0S'),
    'cmi.session_time': '',
    'cmi.suspend_data': str(initial.cmi_suspend_data),
    'cmi.location': str(initial.cmi_location),
    'cmi.entry': str(initial.cmi_entry, 'ab-initio'),
    'cmi.mode': str(initial.cmi_mode, 'normal'),
    'cmi.credit': str(initial.cmi_credit, 'credit'),
    'cmi.exit': '',
    'cmi.learner_id': str(initial.cmi_learner_id),
    'cmi.learner_name': str(initial.cmi_learner_name),
    'cmi.launch_data': '',
    'cmi.max_time_allowed': '',
    'cmi.scaled_passing_score': '',
    'cmi.time_limit_action': '',
    'cmi.learner_preference._children': 'audio_level,language,delivery_speed,audio_captioning',
    'cmi.comments_from_learner._children': 'comment,location,timestamp',
    'cmi.comments_from_learner._count': '0',
    'cmi.comments_from_lms._children': 'comment,location,timestamp',
    'cmi.comments_from_lms._count': '0',
    'cmi.interactions._children': 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description',
    'cmi.interactions._count': '0',
    'cmi.objectives._children': 'id,score,success_status,completion_status,description',
    'cmi.objectives._count': '0',
  };

  let state: 'not_initialized' | 'running' | 'terminated' = 'not_initialized';
  let lastError = '0';
  const fail = (code: string): string => {
    lastError = code;
    return 'false';
  };

  const snapshot = (): ScormSnapshot => ({
    completion_status: cmi['cmi.completion_status'].replace(/ /g, '_'),
    success_status: cmi['cmi.success_status'],
    score_raw: cmi['cmi.score.raw'],
    score_min: cmi['cmi.score.min'],
    score_max: cmi['cmi.score.max'],
    score_scaled: cmi['cmi.score.scaled'],
    session_time: cmi['cmi.session_time'],
    suspend_data: cmi['cmi.suspend_data'],
  });

  return {
    Initialize: (param) => {
      if (param !== '') return fail('201');
      if (state === 'running') return fail('103');
      if (state === 'terminated') return fail('104');
      state = 'running';
      lastError = '0';
      return 'true';
    },
    Terminate: (param) => {
      if (param !== '') return fail('201');
      if (state === 'not_initialized') return fail('112');
      if (state === 'terminated') return fail('113');
      state = 'terminated';
      lastError = '0';
      hooks.onCommit?.(snapshot(), true);
      return 'true';
    },
    GetValue: (element) => {
      if (state === 'not_initialized') {
        fail('122');
        return '';
      }
      if (state === 'terminated') {
        fail('123');
        return '';
      }
      if (WRITE_ONLY_2004.has(element)) {
        fail('405');
        return '';
      }
      if (element in cmi) {
        lastError = '0';
        return cmi[element];
      }
      if (/^cmi\.(objectives|interactions|comments_from_learner|comments_from_lms)\./.test(element)) {
        fail('301');
        return '';
      }
      fail('401');
      return '';
    },
    SetValue: (element, value) => {
      if (state === 'not_initialized') return fail('132');
      if (state === 'terminated') return fail('133');
      if (READ_ONLY_2004.has(element) || /\._(children|count)$/.test(element)) return fail('404');
      const v = String(value);
      switch (element) {
        case 'cmi.completion_status':
          if (!COMPLETION_2004.has(v)) return fail('406');
          break;
        case 'cmi.success_status':
          if (!SUCCESS_2004.has(v)) return fail('406');
          break;
        case 'cmi.score.scaled':
          if (!isNumeric(v)) return fail('406');
          if (Number(v) < -1 || Number(v) > 1) return fail('407');
          break;
        case 'cmi.score.raw':
        case 'cmi.score.min':
        case 'cmi.score.max':
          if (!isNumeric(v)) return fail('406');
          break;
        case 'cmi.progress_measure':
          if (!isNumeric(v)) return fail('406');
          if (Number(v) < 0 || Number(v) > 1) return fail('407');
          break;
        case 'cmi.session_time':
          if (!isIsoDuration(v)) return fail('406');
          break;
        case 'cmi.exit':
          if (!['timeout', 'suspend', 'logout', 'normal', ''].includes(v)) return fail('406');
          break;
        case 'cmi.suspend_data':
          if (v.length > MAX_SUSPEND_2004) return fail('407');
          break;
        case 'cmi.location':
          if (v.length > 1000) return fail('407');
          break;
        default:
          if (!(element in cmi)) {
            if (/^cmi\.(objectives|interactions|comments_from_learner|learner_preference)\./.test(element)) {
              lastError = '0';
              return 'true';
            }
            return fail('401');
          }
      }
      cmi[element] = v;
      lastError = '0';
      if (
        element === 'cmi.completion_status' ||
        element === 'cmi.success_status' ||
        element.startsWith('cmi.score.') ||
        element === 'cmi.suspend_data'
      ) {
        hooks.onChange?.(snapshot());
      }
      return 'true';
    },
    Commit: (param) => {
      if (param !== '') return fail('201');
      if (state === 'not_initialized') return fail('142');
      if (state === 'terminated') return fail('143');
      lastError = '0';
      hooks.onCommit?.(snapshot(), false);
      return 'true';
    },
    GetLastError: () => lastError,
    GetErrorString: (code) => ERRORS_2004[String(code)] || '',
    GetDiagnostic: (code) => ERRORS_2004[String(code || lastError)] || '',
  };
}
