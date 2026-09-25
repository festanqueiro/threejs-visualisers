// Vite resolves `?url` imports to the asset's URL (inlined as a data URL
// in the library build).
declare module '*?url' {
  const url: string
  export default url
}
