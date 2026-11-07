/** GET /public/app-update/?version=… — the server decides whether this app is out of date. */
export type AppUpdate = {
  latest_version: string;
  min_version: string;
  /** Where the update comes from: an APK link now, the Google Play page after launch. */
  download_url: string;
  /** Short note from the admin (already in the app's language), may be empty. */
  note: string;
  update_available: boolean;
  /** The installed version is older than the oldest allowed one: it must update to go on. */
  update_required: boolean;
};
