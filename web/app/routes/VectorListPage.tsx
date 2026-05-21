// Copyright 2026 The OpenAgent Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useStoreFilter } from "~/hooks/useStoreFilter"
import { EditIcon, Loader2Icon, PlusIcon, SearchIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import i18next from "i18next"
import "~/i18n"

import {
  type Vector,
  addVector,
  deleteVector,
  deleteAllVectors,
  getVectors,
} from "~/backend/VectorBackend"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip"
import { useDeclareStoreFilter } from "~/context/StoreFilterContext"

export function meta() {
  return [{ title: "Vectors — OpenAgent" }]
}

type SortOrder = "ascend" | "descend" | ""
type Pagination = { current: number; pageSize: number; total: number }

function newVector(): Vector {
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    owner: "admin",
    name: `vector_${rand}`,
    createdTime: new Date().toISOString(),
    displayName: `New Vector - ${rand}`,
    store: "store-built-in",
    file: "/aaa/openagent.txt",
    text: "The text of vector",
    data: [0.1, 0.2, 0.3],
  }
}

function getShortText(text: string, maxLen: number): string {
  if (!text) return ""
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "..."
}

export default function VectorListPage() {
  useDeclareStoreFilter(true)
  const navigate = useNavigate()
  const storeFilter = useStoreFilter()
  const [vectors, setVectors] = useState<Vector[]>([])
  const [pagination, setPagination] = useState<Pagination>({ current: 1, pageSize: 10, total: 0 })
  const [loading, setLoading] = useState(false)
  const [sortField, setSortField] = useState("")
  const [sortOrder, setSortOrder] = useState<SortOrder>("")
  const [searchField, setSearchField] = useState("name")
  const [searchValue, setSearchValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Vector | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const fetchVectors = useCallback(
    (params: {
      current?: number
      pageSize?: number
      sortField?: string
      sortOrder?: SortOrder
      field?: string
      value?: string
    } = {}) => {
      const current = params.current ?? pagination.current
      const pageSize = params.pageSize ?? pagination.pageSize
      const sf = params.sortField ?? sortField
      const so = params.sortOrder ?? sortOrder
      const field = params.field ?? searchField
      const value = params.value ?? searchValue
      setLoading(true)
      getVectors("admin", storeFilter ?? "", String(current), String(pageSize), field, value, sf, so)
        .then((res) => {
          if (res.status === "ok") {
            setVectors(res.data ?? [])
            setPagination((p) => ({ ...p, current, pageSize, total: res.data2 ?? 0 }))
            setSortField(sf)
            setSortOrder(so)
            setSearchField(field)
            setSearchValue(value)
          } else {
            toast.error(`${i18next.t("general:Failed to get")}: ${res.msg}`)
          }
        })
        .catch((err: Error) => toast.error(err.message))
        .finally(() => setLoading(false))
    },
    [pagination, searchField, searchValue, sortField, sortOrder, storeFilter]
  )

  useEffect(() => {
    fetchVectors({ current: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter])

  function handleAdd() {
    const v = { ...newVector(), store: storeFilter || "store-built-in" }
    addVector(v)
      .then((res) => {
        if (res.status === "ok") {
          toast.success(i18next.t("general:Successfully added"))
          navigate(`/vectors/${v.name}`, { state: { isNewVector: true } })
        } else {
          toast.error(`${i18next.t("general:Failed to add")}: ${res.msg}`)
        }
      })
      .catch((err: Error) => toast.error(err.message))
  }

  function handleDelete(vector: Vector) {
    deleteVector(vector)
      .then((res) => {
        if (res.status === "ok") {
          toast.success(i18next.t("general:Successfully deleted"))
          setVectors((prev) => prev.filter((v) => v.name !== vector.name))
          setPagination((p) => ({ ...p, total: Math.max(0, p.total - 1) }))
          setSelectedNames((prev) => {
            const next = new Set(prev)
            next.delete(vector.name)
            return next
          })
        } else {
          toast.error(`${i18next.t("general:Failed to delete")}: ${res.msg}`)
        }
      })
      .catch((err: Error) => toast.error(err.message))
    setDeleteTarget(null)
  }

  function handleDeleteAll() {
    deleteAllVectors()
      .then((res) => {
        if (res.status === "ok") {
          toast.success(i18next.t("general:Successfully deleted"))
          setVectors([])
          setPagination((p) => ({ ...p, current: 1, total: 0 }))
          setSelectedNames(new Set())
        } else {
          toast.error(`${i18next.t("general:Failed to delete")}: ${res.msg}`)
        }
      })
      .catch((err: Error) => toast.error(err.message))
    setDeleteAllOpen(false)
  }

  function handleBulkDelete() {
    const toDelete = vectors.filter((v) => selectedNames.has(v.name))
    Promise.all(toDelete.map((v) => deleteVector(v)))
      .then(() => {
        toast.success(i18next.t("general:Successfully deleted"))
        setVectors((prev) => prev.filter((v) => !selectedNames.has(v.name)))
        setPagination((p) => ({ ...p, total: Math.max(0, p.total - selectedNames.size) }))
        setSelectedNames(new Set())
      })
      .catch((err: Error) => toast.error(err.message))
    setBulkDeleteOpen(false)
  }

  function handleSearch() {
    fetchVectors({ current: 1, field: searchField, value: searchValue })
  }

  function toggleSelect(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedNames.size === vectors.length && vectors.length > 0) {
      setSelectedNames(new Set())
    } else {
      setSelectedNames(new Set(vectors.map((v) => v.name)))
    }
  }

  const allSelected = vectors.length > 0 && selectedNames.size === vectors.length
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{i18next.t("general:Vectors")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {i18next.t("general:{total} in total").replace("{total}", String(pagination.total))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={searchField} onValueChange={(v) => setSearchField(v ?? "name")}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{i18next.t("general:Name")}</SelectItem>
              <SelectItem value="store">{i18next.t("general:Store")}</SelectItem>
              <SelectItem value="provider">{i18next.t("general:Provider")}</SelectItem>
              <SelectItem value="file">{i18next.t("store:File")}</SelectItem>
              <SelectItem value="text">{i18next.t("general:Text")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 w-52 pl-8"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch() }}
            />
          </div>
          <Button size="sm" onClick={handleAdd}>
            <PlusIcon className="h-4 w-4" />
            {i18next.t("general:Add")}
          </Button>
          {selectedNames.size > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2Icon className="h-4 w-4" />
              {i18next.t("general:Delete")} ({selectedNames.size})
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => setDeleteAllOpen(true)}>
            {i18next.t("general:Delete All")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
              </TableHead>
              <TableHead className="w-32">{i18next.t("general:Store")}</TableHead>
              <TableHead className="w-40">{i18next.t("general:Name")}</TableHead>
              <TableHead className="w-48">{i18next.t("general:Provider")}</TableHead>
              <TableHead className="w-48">{i18next.t("store:File")}</TableHead>
              <TableHead className="w-16">{i18next.t("vector:Index")}</TableHead>
              <TableHead className="w-48">{i18next.t("general:Text")}</TableHead>
              <TableHead className="w-16">{i18next.t("general:Size")}</TableHead>
              <TableHead className="w-48">{i18next.t("general:Data")}</TableHead>
              <TableHead className="w-20">{i18next.t("vector:Dimension")}</TableHead>
              <TableHead className="w-28 text-right">{i18next.t("general:Action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="py-16 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {i18next.t("general:Loading")}
                  </div>
                </TableCell>
              </TableRow>
            ) : vectors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-16 text-center text-muted-foreground">
                  {i18next.t("general:No data")}
                </TableCell>
              </TableRow>
            ) : (
              vectors.map((vector) => (
                <TableRow key={vector.name}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedNames.has(vector.name)}
                      onChange={() => toggleSelect(vector.name)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </TableCell>
                  <TableCell>
                    {vector.store ? (
                      <Link
                        to={`/stores/admin/${vector.store}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {vector.store}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/vectors/${vector.name}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {vector.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {vector.provider ? (
                      <Link
                        to={`/providers/${vector.provider}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {vector.provider}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{vector.file ?? "-"}</TableCell>
                  <TableCell className="text-sm">{vector.index ?? "-"}</TableCell>
                  <TableCell>
                    {vector.text ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="max-w-[200px] truncate text-sm cursor-default">
                            {getShortText(vector.text, 60)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[400px] whitespace-pre-wrap break-words text-xs">
                          {vector.text.slice(0, 500)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{vector.size ?? "-"}</TableCell>
                  <TableCell>
                    {vector.data ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="max-w-[200px] truncate text-sm cursor-default font-mono">
                            {getShortText(JSON.stringify(vector.data), 50)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[400px] whitespace-pre-wrap break-words text-xs font-mono">
                          {getShortText(JSON.stringify(vector.data), 1000)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{vector.dimension ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={i18next.t("general:Edit")}
                        onClick={() => navigate(`/vectors/${vector.name}`)}
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title={i18next.t("general:Delete")}
                        onClick={() => setDeleteTarget(vector)}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{i18next.t("general:{total} in total").replace("{total}", String(pagination.total))}</span>
          <div className="flex items-center gap-2">
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) => fetchVectors({ current: 1, pageSize: Number(v ?? "10") })}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["10", "20", "50", "100", "1000"].map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.current <= 1}
              onClick={() => fetchVectors({ current: pagination.current - 1 })}
            >
              {i18next.t("general:Previous")}
            </Button>
            <span className="px-2 text-sm">{pagination.current} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.current >= totalPages}
              onClick={() => fetchVectors({ current: pagination.current + 1 })}
            >
              {i18next.t("general:Next")}
            </Button>
          </div>
        </div>
      )}

      {/* Delete single */}
      <AlertDialog open={!!deleteTarget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18next.t("general:Sure to delete")}</AlertDialogTitle>
            <AlertDialogDescription>{deleteTarget?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>
              {i18next.t("general:Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              {i18next.t("general:OK")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All confirmation */}
      <AlertDialog open={deleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="h-5 w-5 text-destructive" />
              {i18next.t("general:Sure to delete all")} {i18next.t("general:Vectors")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteAllOpen(false)}>
              {i18next.t("general:Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteAll}>
              {i18next.t("general:OK")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18next.t("general:Sure to delete")}: {selectedNames.size} {i18next.t("general:items")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBulkDeleteOpen(false)}>
              {i18next.t("general:Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleBulkDelete}>
              {i18next.t("general:OK")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
