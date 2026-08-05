// The local API's route table, as the renderer sees it.
//
// Same arrangement as src/automations/schema.ts and for the same reason: the
// JSON is the single source of truth because nothing compiles electron/, and a
// TypeScript table would have to be maintained twice by hand. This file is the
// compile-time half.
//
// What it replaces: API_GROUPS in src/data/apiDocs.ts used to be a third
// hand-written copy of the list in main.cjs, and had drifted far enough to
// document three routes that do not exist. apiDocs now renders this instead.
import rawRoutes from '../../electron/api/routes.json';

export type ApiMethod = 'GET' | 'POST';

// How a field is spelled in an MCP inputSchema. 'steps' is the automation step
// tree -- an array of objects whose shape comes from step-schema.json, which is
// too large to inline into every tool description, so the tool points at
// argus_automation_schema instead.
export type ApiFieldType = 'string' | 'number' | 'boolean' | 'object' | 'steps' | 'tags';

export type ApiField = {
  key: string;
  type: ApiFieldType;
  required?: boolean;
  description?: string;
};

export type ApiRoute = {
  method: ApiMethod;
  path: string;
  group: string;
  label: string;
  // 'unscoped' additionally requires a key with no folder scope. Automations
  // are org-wide and have no folder of their own, so a key granted one folder
  // may run them but may not author them.
  scope: 'any' | 'unscoped';
  // Present when this route's dispatch is driven from the table. The older
  // routes are documented here but still dispatched by hand in main.cjs.
  channel?: string;
  // Answered in the main process without a renderer round trip.
  local?: boolean;
  // The MCP tool fronting this route, where one exists.
  mcp?: string;
  mcpDescription?: string;
  body?: string;
  fields?: ApiField[];
};

export const API_ROUTES = (rawRoutes.routes as unknown) as ApiRoute[];

// Grouped for display, in the order the groups first appear in the table.
export function routeGroups(): Array<{title: string; routes: ApiRoute[]}> {
  const groups: Array<{title: string; routes: ApiRoute[]}> = [];
  for (const route of API_ROUTES) {
    const found = groups.find((group) => group.title === route.group);
    if (found) {
      found.routes.push(route);
    } else {
      groups.push({title: route.group, routes: [route]});
    }
  }
  return groups;
}

// Every tool an agent brief should name: the ones fronting a route, plus the
// CDP tools that drive an open page and have no route of their own. Derived
// rather than listed, so a tool added to the table shows up in the brief
// without a second edit -- the hand-written list this replaces named six of
// the fourteen that existed.
export function mcpToolNames(): string[] {
  const fromRoutes = API_ROUTES
      .map((route) => route.mcp)
      .filter((name): name is string => Boolean(name));
  return [...fromRoutes, ...(rawRoutes.sessionTools as string[])];
}
