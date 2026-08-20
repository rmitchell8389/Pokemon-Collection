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
          <div
            className="relative aspect-[5/7] max-h-[85vh] w-auto max-w-[85vw]"
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
