/** This site's public address, for links in emails and worker callbacks. */
export function siteUrl() {
  return (process.env.SITE_URL ?? "https://www.viralowner.com").replace(/\/$/, "");
}
