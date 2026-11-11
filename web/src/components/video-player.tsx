"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { embedUrl, isYoutubeId, thumbnailUrl, watchUrl } from "@/lib/materials";

/** A YouTube video that loads nothing from YouTube until the visitor presses play (faster pages and no
 * tracking before a choice). Only an 11-character ID is ever used to build an address. Pressing play
 * swaps the cover for the privacy-friendly embed; the "Watch on YouTube" link always works, also
 * without JavaScript. */
export function VideoPlayer({ id, title, playLabel, watchLabel }: { id: string; title: string; playLabel: string; watchLabel: string }) {
  const [playing, setPlaying] = useState(false);
  if (!isYoutubeId(id)) return null;
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-card bg-neutral-900">
        {playing ? (
          <iframe
            src={embedUrl(id)}
            title={title}
            className="absolute inset-0 size-full"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={playLabel} className="group absolute inset-0 size-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- a remote cover, loaded lazily */}
            <img src={thumbnailUrl(id)} alt="" loading="lazy" decoding="async" className="size-full object-cover opacity-90 transition group-hover:opacity-100" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white/40 transition group-hover:bg-brand-700">
                <Play className="size-6 translate-x-0.5" aria-hidden fill="currentColor" />
              </span>
            </span>
          </button>
        )}
      </div>
      <a href={watchUrl(id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
        {watchLabel}
      </a>
    </div>
  );
}
