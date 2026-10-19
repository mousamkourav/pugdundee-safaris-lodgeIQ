// Run with:  npx tsx --test lib/sales/media-import.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLodge, planPhoto, themeCategory } from "./media-import";

const lodges = [
  { id: "KL", name: "Kings Lodge" },
  { id: "THH", name: "Tree House Hideaway" },
  { id: "KEL", name: "Kanha Earth Lodge" },
  { id: "PTL", name: "Pench Tree Lodge" },
  { id: "DBE", name: "Denwa Backwater Escape" },
  { id: "WEL", name: "Waghoba Eco Lodge" },
];
const rooms = [
  { id: "KL_C", property_id: "KL", name: "AC Deluxe Cottage" },
  { id: "THH_T", property_id: "THH", name: "AC Tree House" },
  { id: "PTL_C", property_id: "PTL", name: "AC Cottage" },
  { id: "PTL_T", property_id: "PTL", name: "AC Treehouse" },
  { id: "DBE_C", property_id: "DBE", name: "AC Cottage" },
  { id: "DBE_T", property_id: "DBE", name: "AC Treehouse" },
];

test("the lodge folders in your Drive match the right lodge", () => {
  const cases: [string, string | null][] = [
    ["A - Denwa Lodge @ Satpura", "DBE"],
    ["A - Kanha Lodge @ Kanha", "KEL"],
    ["A - Kings Lodge @ Bandhavgarh", "KL"],
    ["A - Tree House @ Bandhavgarh", "THH"],
    ["A - Waghoba Tadoba", "WEL"],
    ["A- Pench Lodge @ Pench", "PTL"],
    ["A - Ken River Lodge @ Panna", null], // not set up in LodgeIQ
    ["A- Panna Lodge", null],
    ["Kipling Hide", null],
  ];
  for (const [folder, id] of cases) assert.equal(matchLodge(folder, lodges)?.id ?? null, id, folder);
});

test("theme folders become brand photos; office folders are skipped", () => {
  const cases: [string, string | null][] = [
    ["Animals", "wildlife"], ["BIRDS IMAGES", "wildlife"], ["Butterflies", "wildlife"], ["Insects", "wildlife"], ["Wildlife Pictures", "wildlife"],
    ["Activities", "experience"], ["Cycling Safari", "experience"], ["Walking Safari", "experience"], ["Organic farm", "experience"], ["Festivals", "experience"],
    ["Food and Bev", "dining"], ["Sunset", "landscape"], ["flowering trees", "landscape"], ["Bandhavgarh Forest", "landscape"],
    ["Personal", null], ["SOP 2024", null], ["FIRST AID", null], ["Ads April 2025 @ Delhi", null], ["Solar Panel", null], ["Temp", null],
    ["Awards", null], ["Media", null], ["Pugdundee Stall", null], ["Teams Member Photos", null], ["Misc @ Marketing", null],
  ];
  for (const [folder, cat] of cases) assert.equal(themeCategory(folder), cat, folder);
});

test("photos inside a lodge folder get a category and, for rooms, the room", () => {
  const p = (path: string) => planPhoto(path, 1000, lodges, rooms);
  let r = p("Nikon Z8 Still/A - Kings Lodge @ Bandhavgarh/Rooms/DSC_001.jpg");
  assert.deepEqual([r.dest?.owner, r.dest?.ownerId, r.category], ["room_category", "KL_C", "room"]); // only one room type
  r = p("A- Pench Lodge @ Pench/Tree House rooms/DSC_002.JPG");
  assert.deepEqual([r.dest?.ownerId, r.category], ["PTL_T", "room"]);
  r = p("A- Pench Lodge @ Pench/Cottages/DSC_003.jpg");
  assert.deepEqual([r.dest?.ownerId, r.category], ["PTL_C", "room"]);
  r = p("A - Denwa Lodge @ Satpura/Rooms/DSC_004.jpg"); // two room types, not named -> the lodge, as a room photo
  assert.deepEqual([r.dest?.owner, r.dest?.ownerId, r.category], ["property", "DBE", "room"]);
  r = p("A - Waghoba Tadoba/Food/DSC_005.jpg");
  assert.deepEqual([r.dest?.ownerId, r.category], ["WEL", "dining"]);
  r = p("A - Tree House @ Bandhavgarh/DSC_006.jpg"); // straight in the lodge folder
  assert.deepEqual([r.dest?.ownerId, r.category], ["THH", "exterior"]);
  r = p("A - Kanha Lodge @ Kanha/Pool & Spa/DSC_007.jpg");
  assert.deepEqual([r.dest?.ownerId, r.category], ["KEL", "experience"]);
});

test("brand and skipped photos", () => {
  let r = planPhoto("Nikon Z8 Still/BIRDS IMAGES/Kingfisher.jpg", 1, lodges, rooms);
  assert.deepEqual([r.dest?.owner, r.category], ["brand", "wildlife"]);
  r = planPhoto("Nikon Z8 Still/Personal/me.jpg", 1, lodges, rooms);
  assert.equal(r.dest, null);
  r = planPhoto("Nikon Z8 Still/A - Ken River Lodge @ Panna/x.jpg", 1, lodges, rooms);
  assert.equal(r.dest, null);
});
