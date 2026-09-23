import { CSV_TEMPLATE } from "@/lib/csv-import";

/** Sample CSV for bulk import (contains only example data). */
export function GET() {
  return new Response(`﻿${CSV_TEMPLATE}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="siteguard-sites-template.csv"',
    },
  });
}
