"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, CopyIcon, FileUpIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ImportPreview } from "@/lib/csv-import";
import { commitImport, previewImport } from "../actions";

export function ImportClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  async function load(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) return void toast.error("File is larger than 1 MB.");
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    startTransition(async () => {
      const res = await previewImport(text);
      if (!res.ok) return void toast.error(res.error);
      setPreview(res.data);
    });
  }

  function reset() {
    setCsv(null);
    setPreview(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function confirm() {
    if (!csv) return;
    startTransition(async () => {
      const res = await commitImport(csv);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Imported ${res.data.created} site${res.data.created === 1 ? "" : "s"}. First checks start within ~30 s.`);
      router.push("/sites");
      router.refresh();
    });
  }

  if (!preview) {
    return (
      <Card>
        <CardContent>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void load(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-primary bg-accent" : "hover:bg-accent/50"}`}
          >
            <FileUpIcon className="text-muted-foreground size-8" />
            <span className="font-medium">{pending ? "Reading…" : "Choose a CSV file or drop it here"}</span>
            <span className="text-muted-foreground text-xs">UTF-8 CSV, first row = headers</span>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void load(e.target.files?.[0])} />
          </label>
        </CardContent>
      </Card>
    );
  }

  if (preview.fatal) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{preview.fatal}</span>
          <Button size="sm" variant="outline" onClick={reset}>
            Choose another file
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { valid, invalid, duplicates } = preview;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          Preview: <span className="font-normal">{fileName}</span>{" "}
          <span className="text-muted-foreground text-sm font-normal">({preview.totalRows} rows)</span>
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pending || valid.length === 0}>
            {pending ? "Importing…" : `Import ${valid.length} site${valid.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {preview.unknownColumns.length > 0 && (
          <p className="text-muted-foreground text-xs">Ignored columns: {preview.unknownColumns.join(", ")}</p>
        )}
        <Tabs defaultValue={valid.length ? "valid" : invalid.length ? "invalid" : "duplicates"}>
          <TabsList>
            <TabsTrigger value="valid">
              <CheckCircle2Icon className="text-success" /> Valid <Badge variant="secondary">{valid.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="invalid">
              <XCircleIcon className="text-destructive" /> Invalid <Badge variant="secondary">{invalid.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="duplicates">
              <CopyIcon /> Duplicates <Badge variant="secondary">{duplicates.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="valid" className="mt-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="hidden sm:table-cell">Client</TableHead>
                    <TableHead className="hidden md:table-cell">Tags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {valid.map(({ row, data }) => (
                    <TableRow key={row}>
                      <TableCell className="text-muted-foreground">{row}</TableCell>
                      <TableCell className="font-medium">{data.name}</TableCell>
                      <TableCell className="font-mono text-xs">{data.url}</TableCell>
                      <TableCell className="hidden sm:table-cell">{data.clientName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{data.tags.map((t) => `#${t}`).join(" ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {valid.length === 0 && <p className="text-muted-foreground py-4 text-sm">No valid rows to import.</p>}
          </TabsContent>

          <TabsContent value="invalid" className="mt-3">
            {invalid.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">No invalid rows.</p>
            ) : (
              <ul className="grid gap-2">
                {invalid.map((r) => (
                  <li key={r.row} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-wrap gap-x-2">
                      <span className="text-muted-foreground">Row {r.row}</span>
                      <span className="font-medium">{r.name || "(no name)"}</span>
                      <span className="font-mono text-xs">{r.url || "(no url)"}</span>
                    </div>
                    <ul className="text-destructive mt-1 list-disc pl-5 text-xs">
                      {r.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="duplicates" className="mt-3">
            {duplicates.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">No duplicates.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Why skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duplicates.map((d) => (
                    <TableRow key={d.row}>
                      <TableCell className="text-muted-foreground">{d.row}</TableCell>
                      <TableCell className="font-mono text-xs">{d.url}</TableCell>
                      <TableCell className="text-xs">{d.reason === "exists" ? `Already monitored as “${d.conflictWith}”` : `Same URL as ${d.conflictWith}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
        <p className="text-muted-foreground text-xs">Only valid rows are imported. Invalid rows and duplicates are skipped.</p>
      </CardContent>
    </Card>
  );
}
