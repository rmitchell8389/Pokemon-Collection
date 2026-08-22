"use client";

import { useState } from "react";

// A password <input> with a "show/hide" toggle, so people typing on a phone
// (or anyone who fat-fingered it) can check what they actually entered
// before submitting. Client component because toggling the input's `type`
// needs interactivity — the login/signup pages around it stay server
// components, this is just the bit that needs state.
export function PasswordField({
  name,
  placeholder,
  required,
  minLength,
}: {
  name: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        name={name}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="input w-full pr-16"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Doesn't submit the form, doesn't need a name/value — purely a
        // display toggle for the input next to it.
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium
          text-black/50 transition-colors hover:bg-black/5 hover:text-black/80
          dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
