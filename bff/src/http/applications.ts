// The browser application this process serves, by the path it is mounted at. There is one, the
// Organization administration application, at the root: no path belongs to another application, so
// the session cookie, the content security policy and the API proxy serve every page alike.

// applicationRoot is the root of the application a path belongs to: the root, for every path.
export const applicationRoot = (_url: string): string => '/';
