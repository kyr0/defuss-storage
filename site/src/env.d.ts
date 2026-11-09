// Module declarations for build-provided imports. VERIFIED: (tsc) the virtual
// module 'virtual:site-data' is typed by build/data.ts.
declare module 'virtual:site-data' {
  const data: import('../build/data.ts').SiteData;
  export default data;
}
