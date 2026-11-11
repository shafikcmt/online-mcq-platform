/**
 * Dynamic Expo config on top of app.json. Everything normal stays in app.json; this file only adds the
 * size-optimisation settings when a build opts in with SMALL_BUILD=1 (the `preview-small` profile in
 * eas.json), so the existing `preview` and `production` builds are not changed until the owner has built,
 * measured and tested the small one on a real phone. See docs/APP_SIZE.md.
 */
module.exports = ({ config }) => {
  if (process.env.SMALL_BUILD !== "1") return config;
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-build-properties",
        {
          android: {
            // Only the 64-bit ARM code that practically every current Android phone runs (the universal
            // APK also carries 32-bit ARM and two x86 copies of every native library).
            buildArchs: ["arm64-v8a"],
            // R8 shrinks and optimises the Java/Kotlin code; resource shrinking drops unused resources.
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
    ],
  };
};
