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

---
Task ID: 2
Agent: main
Task: Category cards single-row course names + breadcrumb fix (المقررات » التصنيف » المقرر)

Work Log:
- Modified category card course names display from flex-wrap individual pills to single-line comma-separated text with CSS truncation and count badge
- Changed subjects-section breadcrumb condition from `filterCategory && !categoriesView` to `!categoriesView` so it shows for "All Courses" view too
- Added handling for `filterCategory === '__none__'` (بدون تصنيف) in breadcrumb
- Added "كل المقررات" label in breadcrumb when filterCategory is empty (All Courses view)
- Added breadcrumb to course-page.tsx banner area showing "المقررات » {اسم التصنيف}" next to back button
- Extended category fetching in course-page.tsx to work for both teacher and student roles (removed role check)
- Added RTL direction support for chevron icons in course-page breadcrumb
- Build and lint both pass with zero errors

Stage Summary:
- Category cards now show course names in a single non-wrapping row with truncation + count badge
- Breadcrumb in subjects-section now shows for all non-category views: "المقررات » كل المقررات" or "المقررات » {اسم التصنيف}" or "المقررات » بدون تصنيف"
- Course page now has breadcrumb: "المقررات » {اسم التصنيف}" (with course name as h1 below), giving full path: المقررات » التصنيف » المقرر
- Files modified: src/components/shared/subjects-section.tsx, src/components/course/course-page.tsx
