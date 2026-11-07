/** How the app is handed out right now, decided only from the download link an admin sets
 * (Admin Panel → Site settings). One link controls the website button, this page and the
 * in-app update notice: an APK file link today, the Google Play page after launch, with no
 * code change. */
export type DownloadMode = "none" | "apk" | "play";

export function downloadMode(url: string | undefined | null): DownloadMode {
  if (!url) return "none";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "play.google.com" || host.endsWith(".play.google.com") ? "play" : "apk";
  } catch {
    return "none"; // not a usable address: show "coming soon", never a broken button
  }
}

export type AppUpdate = {
  latest_version: string;
  min_version: string;
  download_url: string;
  note: string;
  update_available: boolean;
  update_required: boolean;
};
