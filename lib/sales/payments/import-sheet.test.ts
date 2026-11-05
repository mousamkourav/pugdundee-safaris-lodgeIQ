// Run with:  npx tsx --test lib/sales/payments/import-sheet.test.ts
// The rows of the payments sheet as in the owner's screenshot (5 Nov 2026), read by the import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDate, readPaymentsSheet, type Cell, type ImportPreview } from "./import-sheet";
import { money } from "./money";

const H: Cell[] = ["Check In", "Check Out", "Booking No.", "Guest Name", "Rooms", "Nights", "R. Tariff", "S. Tariff", "T. TAriff", "Total", "Payment 1", "Date", "Payment 2", "Date", "Payment 3", "Date", "Balance"];
// prettier-ignore
const ROWS: Cell[][] = [
  ["01-10-26", "04-10-26", "DBE0004616", "Marc Burlon", 1, 3, 63850, 75600, 22050, 161500, 161500, "03-09-2026", null, null, null, null, null],
  ["02-10-26", "04-10-26", "DBE0004650", "Harsh Satish Niser", 2, 4, 73632, null, null, 73632, 15000, "21-09-2026", 58632, "25-09-2026", null, null, null],
  ["02-10-26", "06-10-26", "DBE0004551", "Alok Mitta", 1, 2, 35400, null, null, 35400, 15000, "20-07-2026", 20400, "29-09-2026", null, null, null],
  ["04-10-26", "09-10-26", "WEL0012031", "Jerome Yvan Stoebener", 2, 10, 216873, 199500, 19950, 436323, 436323, "28-07-2025", null, null, null, null, null],
  ["09-10-26", "11-10-26", "PTL0004642", "Jerome Yvan Stoebener", 2, 4, 86749, 58275, 9450, 154474, 154474, "28-07-2025", null, null, null, null, null],
  ["11-10-26", "16-10-26", "KEL0003606", "Jerome Yvan Stoebener", 2, 10, 216873, 155400, 9450, 381723, 381723, "28-07-2025", null, null, null, null, null],
  ["05-10-26", "08-10-26", "WEL0012472", "Amy Fine", 1, 3, 47725, 69300, 30975, 148000, 148000, "03-09-2026", null, null, null, null, null],
  ["06-10-26", "08-10-26", "KIN0005709", "Satyendra Singh", 2, 4, 62540, 42000, null, 104540, 62540, "02-09-2026", 42000, "09-09-2026", null, null, null],
  ["11-10-26", "13-10-26", "KIN0005805", "Shantanu", 1, 3, 53100, null, null, 53100, 53100, "PAL", null, null, null, null, null],
  ["11-10-27", "15-10-27", "KIN0005797", "Belpu Aditya Raqo", 1, 2, 33040, null, null, 33040, 20000, "06-10-2026", 13040, "06-10-2026", null, null, null],
  ["13-10-26", "16-10-26", "WEL0012454", "Gauri Wallia", 1, 4, 88350, 144900, 15750, 249000, 249000, "07-07-2026", null, null, null, null, null],
  ["14-10-26", "18-10-26", "KIN0005691", "Emily Kausah", 1, 3, 63725, 102375, 33600, 199700, 199700, "26-08-2026", null, null, null, null, null],
  ["15-10-26", "18-10-26", "KIN0005525", "Devika Gupta", 1, 4, 70800, 67200, 18900, 156900, 156900, "24-05-2026", null, null, null, null, null],
  ["16-10-26", "20-10-26", "DBE0004643", "Karishma Parikh", 2, 8, 112000, 84000, null, 196000, 112000, "17-09-2026", 84000, "26-09-2026", null, null, null],
  ["17-10-19", "19-10-19", "KEL0004214", "Kasturi Shailesh Wagh", 1, 4, 97940, 91350, 18900, 208190, 91350, "22-08-2026", 116840, "PAL", null, null, null],
  ["17-10-26", "20-10-26", "THH0002748", "Veerle Vick Verhaeghe", 1, 2, 62540, 80325, 13650, 156515, 71990, "website", 80325, "19-09-2026", 4200, "PAL", null],
  ["19-10-26", "21-10-26", "KIN0005660", "Viraj Anil Gokhale", 3, 9, 230100, null, null, 230100, 70500, "10-08-2026", 141750, "15-10-2026", null, null, 17850],
  ["21-10-26", "23-10-26", "PTL0005475", "Rounak Agarwal", 2, 4, 70800, null, null, 70800, 35400, "14-09-2026", 35400, "16-10-2026", null, null, null],
  ["25-10-26", "28-10-26", "KIN0005558", "Ryan Pacheco", 1, 3, 56900, 88200, 18900, 164000, 164000, "08-06-2026", null, null, null, null, null],
];

const P = readPaymentsSheet([H, ...ROWS]) as ImportPreview;

test("every row is read; Jerome's three lodges become one booking with three lines", () => {
  assert.ok(!("error" in P));
  assert.equal(P.rowsRead, 19);
  assert.equal(P.notes.filter((n) => n.level === "error").length, 0);
  assert.equal(P.bookings.length, 17);
  const jerome = P.bookings.find((b) => b.guest_name === "Jerome Yvan Stoebener")!;
  assert.deepEqual(jerome.lines.map((l) => [l.booking_no, l.lodge_name, l.check_in, l.check_out]), [
    ["WEL0012031", "Waghoba Eco Lodge", "2026-10-04", "2026-10-09"],
    ["PTL0004642", "Pench Tree Lodge", "2026-10-09", "2026-10-11"],
    ["KEL0003606", "Kanha Earth Lodge", "2026-10-11", "2026-10-16"],
  ]);
  assert.deepEqual(jerome.lines.map((l) => l.payments.map((p) => [p.amount, p.paid_on])), [[[436323, "2025-07-28"]], [[154474, "2025-07-28"]], [[381723, "2025-07-28"]]]);
});

test("PAL / website in a date cell is the payment mode (no date)", () => {
  const veerle = P.bookings.find((b) => b.guest_name.startsWith("Veerle"))!.lines[0];
  assert.deepEqual(veerle.payments.map((p) => [p.amount, p.paid_on, p.mode]), [[71990, null, "website"], [80325, "2026-09-19", "other"], [4200, null, "payment_link"]]);
  const shantanu = P.bookings.find((b) => b.guest_name === "Shantanu")!.lines[0];
  assert.deepEqual(shantanu.payments.map((p) => p.mode), ["payment_link"]);
});

test("the balances come out as in the sheet (Viraj 17,850; everyone else 0)", () => {
  const bal = (name: string) => {
    const b = P.bookings.find((x) => x.guest_name === name)!;
    const lines = b.lines.map((l, i) => ({ ...l, id: `l${i}`, property_id: null, sort: i }));
    const payments = b.lines.flatMap((l, i) => l.payments.map((p, k) => ({ id: `p${i}${k}`, line_id: `l${i}`, kind: "payment" as const, reference: null, received_by: null, attachment_path: null, ...p })));
    return money({ lines, payments, other_amount: 0, discount_amount: 0, cancelled: false }).balance;
  };
  assert.equal(bal("Viraj Anil Gokhale"), 17850);
  for (const b of P.bookings.filter((x) => x.guest_name !== "Viraj Anil Gokhale")) assert.equal(bal(b.guest_name), 0, b.guest_name);
});

test("rows worth a look are reported, not guessed: odd years, payments without a date", () => {
  const text = (row: number) => P.notes.filter((n) => n.row === row).map((n) => n.text).join(" | ");
  assert.match(text(11), /Check-in year 2027: most rows are 2026/); // Belpu 11-10-27
  assert.match(text(16), /Check-in year 2019: most rows are 2026/); // Kasturi 17-10-19
  assert.match(text(10), /payment 1: no date \(mode PAL\)/); // Shantanu
  // nothing else about the dates of correct rows
  assert.equal(P.notes.filter((n) => /year/.test(n.text)).length, 2);
});

test("dates: dd-mm-yy, dd-mm-yyyy, Excel dates and day numbers; nonsense is refused", () => {
  assert.equal(readDate("01-10-26"), "2026-10-01");
  assert.equal(readDate("03-09-2026"), "2026-09-03");
  assert.equal(readDate("3/9/2026"), "2026-09-03");
  assert.equal(readDate(new Date(Date.UTC(2026, 9, 1))), "2026-10-01");
  assert.equal(readDate(46296), "2026-10-01");
  assert.equal(readDate("31-02-2026"), null);
  assert.equal(readDate("PAL"), null);
  const bad = readPaymentsSheet([H, ["32-10-26", "04-10-26", "DBE1", "X", 1, 1, 0, 0, 0, "abc", null, null, null, null, null, null, null]]) as ImportPreview;
  assert.equal(bad.bookings.length, 0);
  assert.match(bad.notes[0].text, /Left out: check-in "32-10-26" is not a date; total "abc" is not an amount/);
});
