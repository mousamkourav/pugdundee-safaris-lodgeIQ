// =====================================================================
// Bulk photo import: decides where each photo from a Drive folder belongs,
// from its folder path alone. Pure functions (tested in media-import.test.ts).
//
//   "A - Kings Lodge @ Bandhavgarh/Rooms/IMG_01.jpg" -> Kings Lodge, room
//   "A - Tree House @ .../Exterior/x.jpg"            -> Tree House Hideaway, exterior
//   "BIRDS IMAGES/x.jpg"                              -> brand, wildlife
//   "SOP 2024/x.jpg", "Personal/x.jpg"                -> not imported
// =====================================================================

export const PHOTO_CATEGORIES = ["exterior", "room", "experience", "dining", "wildlife", "landscape", "people", "other"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  exterior: "Lodge & exterior",
  room: "Rooms",
  experience: "Experiences",
  dining: "Food & dining",
  wildlife: "Wildlife",
  landscape: "Landscape",
  people: "Guests & team",
  other: "Other",
};

export type MediaOwner = "property" | "room_category" | "brand";
export interface Destination {
  owner: MediaOwner;
  ownerId: string | null; // null for brand
}

export interface ImportLodge {
  id: string;
  name: string;
}
export interface ImportRoom {
  id: string;
  property_id: string;
  name: string;
}

// Photos a browser can turn into WebP. Camera RAW (NEF, CR2...) and HEIC are skipped.
export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/@.*$/, " ") // "A - Kings Lodge @ Bandhavgarh" -> "a - kings lodge"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Words that do not tell lodges apart.
const GENERIC = new Set(["a", "the", "lodge", "lodges", "eco", "escape", "camp", "resort", "retreat", "hideaway", "backwater", "earth", "and", "of"]);
const words = (s: string) => norm(s).split(" ").filter((w) => w && !GENERIC.has(w));

// Which lodge a folder name points to: the lodge sharing the most distinctive words.
// "A - Tree House @..." -> Tree House Hideaway (tree + house), not Pench Tree Lodge (tree).
export function matchLodge(folder: string, lodges: ImportLodge[]): ImportLodge | null {
  const fw = new Set(words(folder));
  if (!fw.size) return null;
  let best: ImportLodge | null = null;
  let bestScore = 0;
  let tie = false;
  for (const l of lodges) {
    const score = words(l.name).filter((w) => fw.has(w)).length;
    if (score > bestScore) {
      best = l;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) tie = true;
  }
  return best && !tie ? best : null;
}

// Theme folders that make good brand photos, and what kind of photo they hold.
const THEMES: [RegExp, PhotoCategory][] = [
  [/\b(animals?|birds?|butterfl\w*|insects?|wildlife|cheetal|tigers?|leopards?|mammals?|reptiles?)\b/, "wildlife"],
  [/\b(activit\w*|cycling|walking|safari|organic farm|farm|workshop|festivals?|events?|experiences?|boat|canoe)\b/, "experience"],
  [/\b(food|bev|dining|dinner|breakfast|lunch|kitchen|restaurant|bar|cuisine)\b/, "dining"],
  [/\b(sunset|sunrise|trees?|flowering|landscapes?|forest|park|lake|river|monsoon)\b/, "landscape"],
  [/\b(guests?|people|team|staff|naturalists?|portraits?)\b/, "people"],
];

// A folder that names a lodge we do not have ("A - Ken River Lodge @ Panna"): skip it,
// never treat it as a theme (its "River" is not a landscape folder).
const LODGE_LIKE = /^a |\b(lodge|camp|resort|hideaway|escape|hotel)\b/;

// Folders never imported automatically, even if a theme word appears.
const NEVER = /\b(personal|sop|first aid|ads?|temp|solar|marketing|members?|awards?|media|stall)\b/;

export function themeCategory(folder: string): PhotoCategory | null {
  const n = ` ${norm(folder)} `;
  if (NEVER.test(n)) return null;
  for (const [re, cat] of THEMES) if (re.test(n)) return cat;
  return null;
}

// Inside a lodge folder: what kind of photo a sub-folder holds.
const LODGE_SUB: [RegExp, PhotoCategory][] = [
  [/\b(rooms?|cottages?|bungalows?|tree ?houses?|suites?|bed ?rooms?|bath ?rooms?|interiors?|villas?)\b/, "room"],
  [/\b(food|bev|dining|dinner|breakfast|lunch|kitchen|restaurant|bar)\b/, "dining"],
  [/\b(activit\w*|cycling|walking|safari|experiences?|spa|pool|boat|canoe|farm|workshop|presentation)\b/, "experience"],
  [/\b(animals?|birds?|wildlife|tigers?|leopards?)\b/, "wildlife"],
  [/\b(guests?|people|team|staff|naturalists?)\b/, "people"],
  [/\b(exteriors?|property|lodge|outside|aerial|drone|garden|grounds|landscape|sunset)\b/, "exterior"],
];
function lodgeSubCategory(segments: string[]): PhotoCategory {
  for (const seg of segments) {
    const n = ` ${norm(seg)} `;
    for (const [re, cat] of LODGE_SUB) if (re.test(n)) return cat;
  }
  return "exterior"; // photos straight in the lodge folder: the lodge itself
}

// A room of this lodge named in the sub-folders ("Treehouse", "Cottage")?
export function matchRoom(segments: string[], rooms: ImportRoom[]): ImportRoom | null {
  if (!rooms.length) return null;
  const text = ` ${segments.map(norm).join(" ")} `.replace(/tree house/g, "treehouse");
  const hits = rooms.filter((r) => {
    const core = norm(r.name).replace(/\b(ac|deluxe|room|rooms)\b/g, " ").replace(/tree house/g, "treehouse").trim();
    return core && core.split(" ").every((w) => text.includes(` ${w} `) || text.includes(` ${w}s `));
  });
  if (hits.length === 1) return hits[0];
  return rooms.length === 1 ? rooms[0] : null;
}

export interface PlannedPhoto {
  path: string; // folder path + file name, as the browser gives it
  size: number;
  dest: Destination | null; // null = not imported unless the user picks a destination
  category: PhotoCategory;
  groupKey: string; // photos from the same folder that land in the same place
  groupLabel: string;
}

// Plan one file. `path` is "Folder/Sub/file.jpg" (webkitRelativePath style).
export function planPhoto(path: string, size: number, lodges: ImportLodge[], rooms: ImportRoom[]): PlannedPhoto {
  const parts = path.split("/").filter(Boolean);
  const folders = parts.slice(0, -1);
  const folderLabel = folders.join(" / ") || "(no folder)";

  // 1. a lodge folder anywhere in the path
  for (let i = 0; i < folders.length; i++) {
    const lodge = matchLodge(folders[i], lodges);
    if (!lodge) continue;
    const sub = folders.slice(i + 1);
    const category = lodgeSubCategory(sub);
    if (category === "room") {
      const room = matchRoom(sub, rooms.filter((r) => r.property_id === lodge.id));
      if (room) {
        return { path, size, dest: { owner: "room_category", ownerId: room.id }, category, groupKey: `room:${room.id}:${folderLabel}`, groupLabel: folderLabel };
      }
    }
    return { path, size, dest: { owner: "property", ownerId: lodge.id }, category, groupKey: `property:${lodge.id}:${category}:${folderLabel}`, groupLabel: folderLabel };
  }

  // 2. a theme folder (Animals, Activities, Sunset...) -> brand photos
  for (const f of folders) {
    const n = norm(f);
    if (NEVER.test(` ${n} `) || LODGE_LIKE.test(n)) break;
    const cat = themeCategory(f);
    if (cat) return { path, size, dest: { owner: "brand", ownerId: null }, category: cat, groupKey: `brand:${cat}:${folderLabel}`, groupLabel: folderLabel };
  }

  // 3. not recognised: skipped unless the user chooses where it goes
  return { path, size, dest: null, category: "other", groupKey: `skip:${folderLabel}`, groupLabel: folderLabel };
}

// Remembered per photo so the same folder can be imported again without duplicates.
export const sourceRef = (path: string, size: number) => `${path}|${size}`;

// How many photos each place can hold, as in the galleries.
export const MEDIA_LIMIT: Record<MediaOwner, number> = { property: 30, room_category: 10, brand: 120 };
