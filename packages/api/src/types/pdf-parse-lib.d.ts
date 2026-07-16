// The package index of pdf-parse runs a debug block under ESM, so the
// library file is imported directly; it has the same signature.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
