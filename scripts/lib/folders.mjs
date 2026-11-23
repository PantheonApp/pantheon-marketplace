// Kept apart from validate.mjs so the job that signs, which installs nothing, can read them without ajv.

/** Catalog folders and the kind each one holds. */
export const FOLDERS = { connections: "connection", templates: "template", packages: "package" };
/** The folders the catalog takes today. Templates and packages wait for their own plan, and a file in them is refused. */
export const OPEN_FOLDERS = ["connections"];
