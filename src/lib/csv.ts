// Spreadsheets the manager downloads: the month sheet, the month's reports, the
// month's finished work.
//
// CSV rather than a real workbook because every spreadsheet opens one and it
// needs no library — but written for Excel specifically: a byte-order mark so
// it reads the file as UTF-8 instead of guessing a codepage (every name and
// report here is Arabic as often as not), and CRLF line endings.

export type CsvCell = string | number;

/** One line of cells. */
export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

/** The whole file, lines already built, mark on the front of it. */
export function csvFile(lines: string[]): string {
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * One cell, quoted when it has to be.
 *
 * A leading `=`, `+` or `@` is defused with an apostrophe, which Excel eats
 * when it opens the file: notes and reports are typed by people, and a
 * spreadsheet that runs what it was handed is a spreadsheet that can be made
 * to do anything by anybody who can write a note.
 */
export function csvCell(value: CsvCell): string {
  if (typeof value === "number") return String(value);

  const text = /^[=+@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}
