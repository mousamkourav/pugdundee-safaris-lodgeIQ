// A client link that cannot show the itinerary: turned off by Sales, or too many wrong links
// tried from this device. Plain, with no detail about the quote.
export function LinkMessage({ kind }: { kind: "off" | "blocked" }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#FBF9F4] px-4 py-10 text-center">
      <div className="max-w-md">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8A7A55]">Pugdundee Safaris</p>
        <h1 className="mt-3 font-display text-2xl text-[#3A4519]">{kind === "off" ? "This link is no longer active" : "Please try again later"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#6B5E42]">
          {kind === "off"
            ? "This itinerary link has been turned off. Please contact your safari consultant for the latest version of your trip."
            : "Too many links were opened from this device in a short time. Please wait a few minutes, or ask your safari consultant to send the link again."}
        </p>
      </div>
    </main>
  );
}
