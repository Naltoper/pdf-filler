/**
 * Préparer les zones puis remplir le PDF dans le navigateur.
 * Le serveur ne fait que livrer la page. pdf.js et pdf-lib sont chargés
 * par le navigateur (fetch vers le CDN), pas par UrlFetch.
 * Le PDF et les JSON déposés ne sont jamais envoyés à Google.
 *
 * Après chaque modification : Déployer → Gérer les déploiements → crayon
 * → Version : Nouvelle version → Déployer. Puis recharger l'URL.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Remplissage PDF")
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
