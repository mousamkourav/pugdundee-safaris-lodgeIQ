"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "@/components/ui";
import { COUNTRIES, flag, maxPhoneDigits, phoneFits, phoneHint, phoneValid, splitPhone, toInternational } from "@/lib/sales/countries";

// Nationality: every country. India means Indian pricing, any other country foreign.
export function CountrySelect({ value, onChange, id }: { value: string; onChange: (code: string) => void; id?: string }) {
  return (
    <select id={id} className={`${ui.select} w-full !py-2`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">- Choose country -</option>
      <option value="IN">{flag("IN")} India</option>
      <option disabled>----------</option>
      {COUNTRIES.filter((c) => c.code !== "IN").map((c) => (
        <option key={c.code} value={c.code}>
          {flag(c.code)} {c.name}
        </option>
      ))}
    </select>
  );
}

// Mobile number: country code + exactly the number of digits that country uses.
// Stored as +919876543210.
export function PhoneField({
  value,
  country,
  onChange,
}: {
  value: string;
  country: string;
  onChange: (phone: string, country: string) => void;
}) {
  const init = splitPhone(value, country || "IN");
  const [cc, setCc] = useState(init.country || "IN");
  const [digits, setDigits] = useState(init.national);
  const [touched, setTouched] = useState(false);
  const lastSent = useRef(value);

  // Follow changes made elsewhere (e.g. a number typed in the chat), but not our
  // own updates: re-reading a half-typed number would mangle it.
  useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    const s = splitPhone(value, country || "IN");
    setCc(s.country || "IN");
    setDigits(s.national);
  }, [value, country]);

  const dial = COUNTRIES.find((c) => c.code === cc)?.dial ?? "";
  const invalid = touched && digits.length > 0 && !phoneValid(cc, digits);

  function setNumber(nextDigits: string, nextCc = cc) {
    setDigits(nextDigits);
    const intl = toInternational(nextCc, nextDigits);
    lastSent.current = intl;
    onChange(intl, nextCc);
  }

  return (
    <div>
      <div className="flex gap-1.5">
        <select
          className={`${ui.select} w-[7.5rem] shrink-0 !px-2 !py-2 text-xs`}
          value={cc}
          onChange={(e) => {
            const next = e.target.value;
            setCc(next);
            const trimmed = digits.slice(0, maxPhoneDigits(next));
            setNumber(trimmed, next);
          }}
          aria-label="Country code"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {flag(c.code)} +{c.dial} {c.code}
            </option>
          ))}
        </select>
        <input
          className={`${ui.inputSm} tabular ${invalid ? "!border-error" : ""}`}
          inputMode="numeric"
          autoComplete="tel-national"
          value={digits}
          maxLength={maxPhoneDigits(cc)}
          placeholder="Mobile number"
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
            if (phoneFits(cc, d)) setNumber(d);
          }}
          onBlur={() => setTouched(true)}
          aria-label="Mobile number"
          aria-invalid={invalid}
        />
      </div>
      <p className={`mt-1 text-xs ${invalid ? "font-medium text-error" : "text-sand-500"}`}>
        {invalid ? `Not a valid ${COUNTRIES.find((c) => c.code === cc)?.name ?? ""} mobile number. ${phoneHint(cc)}` : digits ? `+${dial} ${digits}` : phoneHint(cc)}
      </p>
    </div>
  );
}
