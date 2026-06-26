// Barrel module: the widget implementation has been split into focused modules
// under `./widgets/`. This file re-exports the public API so existing imports
// (`./Widget.jsx`) keep working.
export { default } from './ui/widgets/legacy.jsx'
export { WidgetCard, Viz } from './ui/widgets/viz.jsx'
export { FormButton, FormModal } from './ui/widgets/forms.jsx'
