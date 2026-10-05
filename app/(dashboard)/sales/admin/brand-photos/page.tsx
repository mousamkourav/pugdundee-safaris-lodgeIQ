import Link from "next/link";
import { MediaManager } from "@/components/sales/media-manager";
import { getMedia } from "@/lib/sales/media";

export default async function BrandPhotosPage() {
  const items = await getMedia("brand", null);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Brand photos</h1>
        <p className="mt-1 text-sm text-sand-500">
          Pugdundee Safaris photos for itinerary covers and section breaks: wildlife, landscapes, guests on safari.
        </p>
      </div>
      <MediaManager
        owner="brand"
        ownerId={null}
        items={items}
        max={40}
        hint="The starred photo is the default itinerary cover. Use the arrows to change the order."
      />
    </div>
  );
}
