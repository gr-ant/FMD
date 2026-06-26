// Barrel module: the widget implementation has been split into focused modules
// under `./widgets/`. This file re-exports the public API so existing imports
// (`./Widget.jsx`) keep working.
export { default } from './widgets/legacy.jsx'
export { WidgetCard, Viz } from './widgets/viz.jsx'
export { FormButton, FormModal } from './widgets/forms.jsx'
