# Task 1 - Fix Agent

## Task: Fix JOIN queries and missing translations

### Work Completed

1. **subjects-section.tsx** - Student branch (line ~370):
   - Replaced `subject_students.select('id, subject_id, status, subjects(*)')` with two queries:
     - First: `subject_students.select('id, subject_id, status')`
     - Second: `subjects.select('*').in('id', subjectIds)`
   - Combined manually using Map lookup for O(1) subject access
   - Preserved all state updates: setSubjects, setEnrollmentStatuses, enrollmentIdMapRef, cache, fetchTeacherNames

2. **subjects-section.tsx** - Teacher branch (line ~319):
   - Replaced `subject_teachers.select('subject_id, role, subjects(*)')` with two queries:
     - First: `subject_teachers.select('subject_id, role')`
     - Second: `subjects.select('*').in('id', coSubjectIds)`
   - Combined manually, filtering out owned subjects

3. **todo-section.tsx** (line ~351):
   - Replaced `user_todos.select('*, subjects(name)')` with two queries:
     - First: `user_todos.select('*')`
     - Second: `subjects.select('id, name').in('id', uniqueSubjectIds)`
   - Used subjectNameLookup Record for name resolution

4. **calendar-section.tsx** (line ~288):
   - Replaced `user_todos.select('*, subjects(name)')` with two queries:
     - First: `user_todos.select('*')`
     - Second: `subjects.select('id, name').in('id', todoSubjectIds)`
   - Used todoSubjectNameMap Record for name resolution

5. **Translation keys added**:
   - `student.trackingCurrentStatus`, `student.trackingLevelWeak`, `student.trackingLevelFair`, `student.trackingLevelGood`, `student.trackingLevelExcellent`
   - `settings.status.online`, `settings.status.busy`, `settings.status.away`, `settings.status.invisible`, `settings.status.offline`

### Lint: Passes clean
