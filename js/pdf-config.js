/* pdf.js worker served locally - MV3 extensions cannot load remote scripts */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}
