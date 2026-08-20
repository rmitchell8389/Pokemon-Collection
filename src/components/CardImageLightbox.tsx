"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// Wraps a card thumbnail so clicking it opens a fullscreen view of the same
// image. Client component because it needs click/keyboard state — the
// collection page around it stays a server component; only this one tile of
// interactivity gets shipped to the browser.
export function CardImageLightbox({
  src,
  alt,
  thumbnailClassName,
}: {
  src: string;
  alt: string;
  thumbnailClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    // Prevent the page behind the overlay from scrolling while it's open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label={`View ${alt} full size`}
      >
        <Image
          src={src}
          alt={alt}
          width={200}
          height={280}
          className={thumbnailClassName}
          unoptimized
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          {/*
            Bug fixed 2026-08-20: this div used to be `max-h-[85vh] w-auto`
            with no explicit height. It's a flex item inside the overlay's
            `flex items-center justify-center`, and its only child (the
            `fill` Image below) is absolutely positioned — meaning it
            contributes zero intrinsic size to this box. With `width: auto`
            on a flex item, sizing falls back to content size, which was
            zero, so `aspect-[5/7]` had nothing to resolve against and the
            box collapsed to 0x0. The `fill` image was rendering into a
            zero-size container — present in the DOM, invisible on screen.
            Giving the box an explicit `h-[85vh]` anchors the size; the
            browser derives width from the aspect ratio and clamps it via
            `max-w-[85vw]` on narrow screens, recomputing height downward
            to match (standard CSS Sizing 4 behavior in evergreen browsers).
          */}
          <div
            className="relative aspect-[5/7] h-[85vh] max-w-[85vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              fill
              unoptimized
              sizes="85vw"
              className="rounded-xl object-contain shadow-2xl"
            />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
