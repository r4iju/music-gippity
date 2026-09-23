// TypeScript 6 type-checks side-effect imports; plain stylesheets such as the
// root layout's global.css have no declarations of their own.
declare module "*.css" {}
