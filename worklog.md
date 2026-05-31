---
Task ID: 1
Agent: main
Task: Add categories improvements - "All Courses" card, empty category state, translations

Work Log:
- Read subjects-section.tsx and discovered categories view already implemented with: grid, CRUD, breadcrumb, uncategorized card, realtime
- Identified missing features: "All Courses" card, empty category state with "Add Course" button
- Added translation keys in ar.json and en.json: allCourses, allCoursesDesc, emptyCategory, emptyCategoryDesc, addCourseToCategory
- Added "All Courses" card at the beginning of categories grid with sky-blue gradient design
- Added empty category state component for when teacher enters a category with no courses
- Empty state shows FolderTree icon, descriptive text, and "Add Course to Category" button that pre-sets the category
- Ran lint check - passed with zero errors

Stage Summary:
- Categories grid now shows: "All Courses" → category cards → "Uncategorized" card
- Empty categories show clear message + action button
- All new text is bilingual (Arabic/English)
- Files modified: src/i18n/messages/ar.json, src/i18n/messages/en.json, src/components/shared/subjects-section.tsx
