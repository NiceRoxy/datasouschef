# Dashboard View Plan

## Context Assessment
- **Context:** Building an MVP/Prototype for a course requirement.
- **Engineering Values:** Prioritize development speed, readability, and a strong UX/UI (Honest Startup philosophy) over complex state management. Modularity is key—we will add a new "view" to the existing SPA shell without breaking the others.

## Recommendations for the Dashboard
A good dashboard should serve as a control center. Since DataSousChef is an offline-first tool (data stays local), the metrics are simple. I recommend including:
1. **Welcome & Subscription Status:** Clear indicator of the 3-day trial and an "Upgrade" CTA.
2. **Profile / Account Details:** User's name, email, and organization, with a placeholder to "Edit Profile".
3. **Recent Scripts (History):** A quick-access list of the 2-3 most recently generated scripts with download buttons.
4. **Quick Start Action:** A prominent button to "Start a New Task" (which jumps to the procedure selection screen).
5. **Privacy Reminder:** A small badge reinforcing the core promise: "0 rows uploaded. Your data stays on your machine."

## Checklist
- [x] Update `app.html` to include a new `<section id="view-dashboard" class="view">` containing the recommended widgets.
- [x] Update `app.html` sidebar to add a "Dashboard" nav item and make it the default active view.
- [x] Add necessary CSS to `app.css` for dashboard widgets (profile card, stat cards, recent activity list).
- [x] Update `app.js` routing logic to handle the new default view and ensure the "Start a New Task" button routes to the `view-home` (New Task) screen.
- [x] Review changes to ensure they are simple, self-contained, and don't break existing views.

## Review
- **Summary of Changes:** Successfully added the Dashboard view to `app.html` without altering the DOM structure of existing views. Kept the UI consistent with the Honest Startup philosophy by ensuring the primary user path (Start a New Task) remains prominent. Added CSS for new Dashboard widgets (Profile, Trial, Privacy, Scripts) in a modular block. Updated JavaScript SPA routing to default to the Dashboard and connected quick-action buttons.
- **Tradeoffs:** Used placeholder data in the HTML (e.g., "Helen", "2 days left") to prioritize development speed over complex state management at this MVP stage.
- **Verification:** All links route correctly within the SPA shell. Tested and validated the design using the existing color variables.
