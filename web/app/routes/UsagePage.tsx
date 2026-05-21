// Copyright 2024 The OpenAgent Authors. All Rights Reserved.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { useStoreFilter } from "~/hooks/useStoreFilter"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import i18next from "i18next"
import "~/i18n"

import { isAdminUser } from "~/backend/AccountBackend"
import {
  getUsageHeatmap,
  getUsageProviders,
  getUsages,
  getUsers,
  getRangeUsages,
  getUserTableInfos,
  type HeatmapData,
  type ProviderData,
  type UsageData,
  type UsageMetadata,
  type UserTableInfo,
} from "~/backend/UsageBackend"
import { useAccount } from "~/context/AccountContext"
import { Badge } from "~/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Skeleton } from "~/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import { useTheme } from "~/hooks/useTheme"
import { useDeclareStoreFilter } from "~/context/StoreFilterContext"

export function meta() {
  return [{ title: "Usages - OpenAgent" }]
}

type RangeType = "All" | "Hour" | "Day" | "Week" | "Month"
type SortField = "chats" | "messageCount" | "tokenCount" | "price" | ""
type SortOrder = "asc" | "desc" | ""

const CHART_COLORS = [
  "#1677ff", "#0ea5e9", "#06b6d4", "#14b8a6", "#6366f1",
  "#8b5cf6", "#0958d9", "#0284c7", "#0891b2", "#0f766e",
  "#5734d3", "#7c3aed", "#38bdf8", "#5eead4",
]

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ title, value, prefix, loading }: {
  title: string
  value: number | undefined
  prefix?: string
  loading: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <span className="text-2xl font-semibold tabular-nums">
          {prefix}{value?.toLocaleString() ?? 0}
        </span>
      )}
    </div>
  )
}

// ── Heatmap Calendar ──────────────────────────────────────────────────────────

function CalendarHeatmap({ heatmapData, isDark }: { heatmapData: HeatmapData; isDark: boolean }) {
  const dataMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const entry of heatmapData.data ?? []) {
      m.set(entry.date, entry.count)
    }
    return m
  }, [heatmapData])

  const { startDate, endDate } = useMemo(() => {
    if (heatmapData.dateRange?.length === 2) {
      return { startDate: new Date(heatmapData.dateRange[0]), endDate: new Date(heatmapData.dateRange[1]) }
    }
    const end = new Date()
    const start = new Date(end)
    start.setFullYear(end.getFullYear() - 1)
    return { startDate: start, endDate: end }
  }, [heatmapData.dateRange])

  const maxCount = Math.max(heatmapData.maxCount ?? 1, 1)

  const heatColors = isDark
    ? ["#2a2a2a", "#3a2a5a", "#5a3a8a", "#7c5ce0", "#5734d3"]
    : ["#f3f0ff", "#d9d1f7", "#b5a8ef", "#7c5ce0", "#5734d3"]

  function getColor(count: number): string {
    if (count === 0) return heatColors[0]
    const ratio = Math.min(count / maxCount, 1)
    const idx = Math.ceil(ratio * (heatColors.length - 1))
    return heatColors[idx]
  }

  // Build weeks grid: each column = 1 week (Sun–Sat)
  const weeks = useMemo(() => {
    const result: Array<Array<{ dateStr: string; count: number; inRange: boolean }>> = []
    const cursor = new Date(startDate)
    cursor.setDate(cursor.getDate() - cursor.getDay()) // rewind to Sunday

    const endTime = endDate.getTime()
    while (cursor.getTime() <= endTime) {
      const week: Array<{ dateStr: string; count: number; inRange: boolean }> = []
      for (let d = 0; d < 7; d++) {
        const dateStr = cursor.toISOString().slice(0, 10)
        const inRange = cursor >= startDate && cursor.getTime() <= endTime
        week.push({ dateStr, count: dataMap.get(dateStr) ?? 0, inRange })
        cursor.setDate(cursor.getDate() + 1)
      }
      result.push(week)
    }
    return result
  }, [startDate, endDate, dataMap])

  // Month labels: first week of each new month
  const monthLabels = useMemo(() => {
    const monthNames = [
      i18next.t("usage:Jan"), i18next.t("usage:Feb"), i18next.t("usage:Mar"),
      i18next.t("usage:Apr"), i18next.t("usage:May"), i18next.t("usage:Jun"),
      i18next.t("usage:Jul"), i18next.t("usage:Aug"), i18next.t("usage:Sep"),
      i18next.t("usage:Oct"), i18next.t("usage:Nov"), i18next.t("usage:Dec"),
    ]
    const labels: Array<{ label: string; weekIdx: number }> = []
    let lastMonth = -1
    weeks.forEach((week, wi) => {
      const firstInRange = week.find(d => d.inRange)
      if (!firstInRange) return
      const month = new Date(firstInRange.dateStr).getMonth()
      if (month !== lastMonth) {
        labels.push({ label: monthNames[month], weekIdx: wi })
        lastMonth = month
      }
    })
    return labels
  }, [weeks])

  const dayNames = [
    i18next.t("usage:Sun"), i18next.t("usage:Mon"), i18next.t("usage:Tue"),
    i18next.t("usage:Wed"), i18next.t("usage:Thu"), i18next.t("usage:Fri"),
    i18next.t("usage:Sat"),
  ]

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit">
        {/* Day labels column */}
        <div className="flex flex-col pr-1 pt-5">
          {dayNames.map((name, i) => (
            <div
              key={i}
              className="flex h-[13px] items-center justify-end pr-1 text-[9px] leading-none text-muted-foreground"
              style={{ marginBottom: 2 }}
            >
              {i % 2 === 1 ? name : ""}
            </div>
          ))}
        </div>
        {/* Weeks grid */}
        <div className="flex flex-col">
          {/* Month labels */}
          <div className="relative h-5 text-[10px] text-muted-foreground">
            {monthLabels.map(({ label, weekIdx }) => (
              <span
                key={`${label}-${weekIdx}`}
                className="absolute"
                style={{ left: weekIdx * 15 }}
              >
                {label}
              </span>
            ))}
          </div>
          {/* Cell grid */}
          <div className="flex gap-[2px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[2px]">
                {week.map((day, di) => (
                  <div
                    key={di}
                    title={day.inRange ? `${day.dateStr}: ${day.count}` : ""}
                    className="h-[13px] w-[13px] rounded-[2px]"
                    style={{ backgroundColor: day.inRange ? getColor(day.count) : "transparent" }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Format date for range charts ───────────────────────────────────────────────

function formatDate(date: string, rangeType: RangeType): string {
  switch (rangeType) {
    case "Hour":
      return `${date}:00`
    case "Day":
      return date
    case "Week": {
      const start = new Date(date)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      const fmt = (d: Date) =>
        `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      return `${fmt(start)} ~ ${fmt(end)}`
    }
    case "Month":
      return date.slice(0, 7)
    default:
      return date
  }
}

// ── Left Chart: Users vs Chats ─────────────────────────────────────────────────

function LeftChart({ data, rangeType, isRange }: {
  data: UsageData[]
  rangeType: RangeType
  isRange: boolean
}) {
  const usersLabel = i18next.t("general:Users")
  const chatsLabel = i18next.t("general:Chats")

  const chartData = data.map(d => ({
    date: isRange ? formatDate(d.date, rangeType) : d.date,
    [usersLabel]: d.userCount,
    [chatsLabel]: d.chatCount,
  }))

  const commonProps = {
    data: chartData,
    margin: { top: 10, right: 40, left: 10, bottom: 5 } as const,
  }

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
      <YAxis yAxisId="left" orientation="left" name={usersLabel} tick={{ fontSize: 11 }} />
      <YAxis yAxisId="right" orientation="right" name={chatsLabel} tick={{ fontSize: 11 }} />
      <Tooltip />
      <Legend />
    </>
  )

  return (
    <ResponsiveContainer width="100%" height={400}>
      {isRange ? (
        <BarChart {...commonProps}>
          {axes}
          <Bar yAxisId="left" dataKey={usersLabel} fill={CHART_COLORS[0]} />
          <Bar yAxisId="right" dataKey={chatsLabel} fill={CHART_COLORS[4]} />
        </BarChart>
      ) : (
        <LineChart {...commonProps}>
          {axes}
          <Line yAxisId="left" type="monotone" dataKey={usersLabel} stroke={CHART_COLORS[0]} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey={chatsLabel} stroke={CHART_COLORS[4]} dot={false} />
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}

// ── Right Chart: Messages vs Tokens [vs Price] ─────────────────────────────────

function RightChart({ data, rangeType, isRange, isAdmin }: {
  data: UsageData[]
  rangeType: RangeType
  isRange: boolean
  isAdmin: boolean
}) {
  const messagesLabel = i18next.t("general:Messages")
  const tokensLabel = i18next.t("general:Tokens")
  const priceLabel = i18next.t("chat:Price")

  const chartData = data.map(d => ({
    date: isRange ? formatDate(d.date, rangeType) : d.date,
    [messagesLabel]: d.messageCount,
    [tokensLabel]: d.tokenCount,
    ...(isAdmin ? { [priceLabel]: d.price } : {}),
  }))

  const commonProps = {
    data: chartData,
    margin: { top: 10, right: 40, left: 10, bottom: 5 } as const,
  }

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
      <YAxis yAxisId="messages" orientation="left" name={messagesLabel} tick={{ fontSize: 11 }} />
      <YAxis yAxisId="tokens" orientation="right" name={tokensLabel} tick={{ fontSize: 11 }} />
      {/* Price uses a hidden axis for correct independent scaling; value visible in tooltip */}
      {isAdmin && <YAxis yAxisId="price" orientation="right" hide />}
      <Tooltip />
      <Legend />
    </>
  )

  return (
    <ResponsiveContainer width="100%" height={400}>
      {isRange ? (
        <BarChart {...commonProps}>
          {axes}
          <Bar yAxisId="messages" dataKey={messagesLabel} fill={CHART_COLORS[1]} />
          <Bar yAxisId="tokens" dataKey={tokensLabel} fill={CHART_COLORS[5]} />
          {isAdmin && <Bar yAxisId="price" dataKey={priceLabel} fill={CHART_COLORS[2]} />}
        </BarChart>
      ) : (
        <LineChart {...commonProps}>
          {axes}
          <Line yAxisId="messages" type="monotone" dataKey={messagesLabel} stroke={CHART_COLORS[1]} dot={false} />
          <Line yAxisId="tokens" type="monotone" dataKey={tokensLabel} stroke={CHART_COLORS[5]} dot={false} />
          {isAdmin && <Line yAxisId="price" type="monotone" dataKey={priceLabel} stroke={CHART_COLORS[2]} dot={false} />}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}

// ── Provider Pie Chart ─────────────────────────────────────────────────────────

function ProviderPieChart({ data }: { data: ProviderData[] }) {
  const chartData = data.map(p => ({
    name: p.category || i18next.t("application:Unknown"),
    value: p.count,
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={chartData}
          cx="30%"
          cy="50%"
          innerRadius="42%"
          outerRadius="68%"
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value, name) => [value, name]} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, right: 0, width: "44%" }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ── Usage Table ────────────────────────────────────────────────────────────────

function UsageTable({ data, isAdmin, loading }: {
  data: UserTableInfo[] | null
  isAdmin: boolean
  loading: boolean
}) {
  const [sortField, setSortField] = useState<SortField>("")
  const [sortOrder, setSortOrder] = useState<SortOrder>("")

  function handleSort(field: SortField) {
    if (sortField !== field) {
      setSortField(field)
      setSortOrder("desc")
    } else if (sortOrder === "desc") {
      setSortOrder("asc")
    } else {
      setSortField("")
      setSortOrder("")
    }
  }

  function getSortIndicator(field: SortField) {
    if (sortField !== field) return " ↕"
    return sortOrder === "desc" ? " ↓" : " ↑"
  }

  const sorted = useMemo(() => {
    if (!data) return null
    if (!sortField || !sortOrder) return data
    return [...data].sort((a, b) => {
      const av = (a[sortField as keyof UserTableInfo] as number) ?? 0
      const bv = (b[sortField as keyof UserTableInfo] as number) ?? 0
      return sortOrder === "asc" ? av - bv : bv - av
    })
  }, [data, sortField, sortOrder])

  const colSpan = isAdmin ? 5 : 3

  return (
    <div className="mt-6 px-6">
      <h2 className="mb-3 text-xl font-semibold">{i18next.t("general:Users")}</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{i18next.t("general:User")}</TableHead>
              <TableHead
                className="w-32 cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("chats")}
              >
                {i18next.t("general:Chats")}{getSortIndicator("chats")}
              </TableHead>
              <TableHead
                className="w-32 cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort("messageCount")}
              >
                {i18next.t("general:Messages")}{getSortIndicator("messageCount")}
              </TableHead>
              {isAdmin && (
                <TableHead
                  className="w-36 cursor-pointer select-none hover:text-foreground"
                  onClick={() => handleSort("tokenCount")}
                >
                  {i18next.t("chat:Token count")}{getSortIndicator("tokenCount")}
                </TableHead>
              )}
              {isAdmin && (
                <TableHead
                  className="w-32 cursor-pointer select-none hover:text-foreground"
                  onClick={() => handleSort("price")}
                >
                  {i18next.t("chat:Price")}{getSortIndicator("price")}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || !sorted ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  {isAdmin && <TableCell><Skeleton className="h-4 w-20" /></TableCell>}
                  {isAdmin && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
                  {i18next.t("general:No data")}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => (
                <TableRow key={row.user}>
                  <TableCell className="font-medium">{row.user}</TableCell>
                  <TableCell>
                    <Link to={`/chats?user=${row.user}`}>
                      <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                        {row.chats ?? 0}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/messages?user=${row.user}`}>
                      <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                        {row.messageCount ?? 0}
                      </Badge>
                    </Link>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="tabular-nums">
                      {(row.tokenCount ?? 0).toLocaleString()}
                    </TableCell>
                  )}
                  {isAdmin && (
                    <TableCell className="tabular-nums">
                      {row.price != null ? `$${row.price.toFixed(6)}` : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function UsagePage() {
  useDeclareStoreFilter(true)
  const storeFilter = useStoreFilter()
  const { account } = useAccount()
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const isAdmin = isAdminUser(account ?? undefined)

  const [users, setUsers] = useState<string[]>([])
  const [selectedUser, setSelectedUser] = useState<string>("All")
  const [rangeType, setRangeType] = useState<RangeType>("All")

  const [usages, setUsages] = useState<UsageData[] | null>(null)
  const [usageMetadata, setUsageMetadata] = useState<UsageMetadata | null>(null)
  const [rangeUsagesHour, setRangeUsagesHour] = useState<UsageData[] | null>(null)
  const [rangeUsagesDay, setRangeUsagesDay] = useState<UsageData[] | null>(null)
  const [rangeUsagesWeek, setRangeUsagesWeek] = useState<UsageData[] | null>(null)
  const [rangeUsagesMonth, setRangeUsagesMonth] = useState<UsageData[] | null>(null)
  const [userTableInfo, setUserTableInfo] = useState<UserTableInfo[] | null>(null)
  const [selectedTableInfo, setSelectedTableInfo] = useState<UserTableInfo[] | null>(null)
  const [providerData, setProviderData] = useState<ProviderData[] | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)

  const initialized = useRef(false)
  const selectedUserRef = useRef(selectedUser)
  selectedUserRef.current = selectedUser

  function getCountFromRangeType(rt: RangeType): number {
    if (rt === "Hour") return 72
    if (rt === "Day") return 30
    if (rt === "Week") return 16
    if (rt === "Month") return 12
    return 30
  }

  const fetchAllUsageData = useCallback((user: string) => {
    setUsages(null)
    setRangeUsagesHour(null)
    setRangeUsagesDay(null)
    setRangeUsagesWeek(null)
    setRangeUsagesMonth(null)

    getUsages(storeFilter ?? "", user, 30).then((res) => {
      if (res.status === "ok") {
        setUsages(res.data ?? [])
        setUsageMetadata(res.data2 ?? null)
      } else {
        toast.error(`${i18next.t("general:Failed to get")}: ${res.msg}`)
      }
    })

    const rangeSetters: Array<[string, (d: UsageData[]) => void]> = [
      ["Hour", setRangeUsagesHour],
      ["Day", setRangeUsagesDay],
      ["Week", setRangeUsagesWeek],
      ["Month", setRangeUsagesMonth],
    ]
    for (const [rt, setter] of rangeSetters) {
      getRangeUsages(rt, getCountFromRangeType(rt as RangeType), storeFilter ?? "", user).then((res) => {
        if (res.status === "ok") setter(res.data ?? [])
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter])

  const fetchTableInfo = useCallback((user: string, accountName: string) => {
    setTableLoading(true)
    getUserTableInfos(storeFilter ?? "", accountName).then((res) => {
      setTableLoading(false)
      if (res.status === "ok") {
        const data: UserTableInfo[] = res.data ?? []
        setUserTableInfo(data)
        setSelectedTableInfo(user === "All" ? data : data.filter(row => row.user === user))
      } else {
        toast.error(`${i18next.t("general:Failed to get")}: ${res.msg}`)
      }
    }).catch(() => setTableLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter])

  const fetchProviderAndHeatmap = useCallback((owner: string) => {
    getUsageProviders(owner).then((res) => {
      if (res.status === "ok") setProviderData(res.data ?? null)
    })
    getUsageHeatmap(owner).then((res) => {
      if (res.status === "ok") setHeatmapData(res.data ?? null)
    })
  }, [])

  useEffect(() => {
    if (!account) return
    const accountName = account.name
    const owner = account.owner ?? "admin"

    if (!initialized.current) {
      initialized.current = true
      getUsers(accountName, "").then((res) => {
        if (res.status === "ok") {
          const userList: string[] = res.data ?? []
          setUsers(userList)
          const initUser = isAdmin ? "All" : (userList[0] ?? "All")
          setSelectedUser(initUser)
          fetchAllUsageData(initUser)
          fetchTableInfo(initUser, accountName)
        } else {
          toast.error(`${i18next.t("general:Failed to get")}: ${res.msg}`)
        }
      })
      fetchProviderAndHeatmap(owner)
    } else {
      fetchAllUsageData(selectedUserRef.current)
      fetchTableInfo(selectedUserRef.current, accountName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, storeFilter])

  function handleUserChange(value: string) {
    setSelectedUser(value)
    fetchAllUsageData(value)
    if (value === "All") {
      setSelectedTableInfo(userTableInfo)
    } else {
      setSelectedTableInfo((userTableInfo ?? []).filter(row => row.user === value))
    }
  }

  const lastUsage = usages && usages.length > 0 ? usages[usages.length - 1] : null
  const statsLoading = usages === null

  const rangeDataMap: Record<string, UsageData[] | null> = {
    Hour: rangeUsagesHour,
    Day: rangeUsagesDay,
    Week: rangeUsagesWeek,
    Month: rangeUsagesMonth,
  }
  const isRangeMode = rangeType !== "All"
  const activeData = isRangeMode ? (rangeDataMap[rangeType] ?? []) : (usages ?? [])

  const tableData = selectedTableInfo !== null ? selectedTableInfo : userTableInfo

  const rangeOptions: Array<{ value: RangeType; label: string }> = [
    { value: "All", label: i18next.t("store:All") },
    { value: "Hour", label: i18next.t("usage:Hour") },
    { value: "Day", label: i18next.t("usage:Day") },
    { value: "Week", label: i18next.t("usage:Week") },
    { value: "Month", label: i18next.t("usage:Month") },
  ]

  const showProviderChart = providerData && providerData.length > 0
  const showHeatmap = !!heatmapData

  return (
    <div className="flex flex-col gap-0 pb-10">
      {/* Header: stats + controls */}
      <div className="flex flex-wrap items-start justify-between gap-4 p-6 pb-4">
        {/* Stat cards */}
        <div className="flex flex-wrap gap-3">
          {isAdmin && (
            <StatCard
              title={i18next.t("task:Application")}
              value={usageMetadata?.application}
              loading={statsLoading}
            />
          )}
          <StatCard
            title={i18next.t("general:Users")}
            value={lastUsage?.userCount ?? 0}
            loading={statsLoading}
          />
          <StatCard
            title={i18next.t("general:Chats")}
            value={lastUsage?.chatCount ?? 0}
            loading={statsLoading}
          />
          <StatCard
            title={i18next.t("general:Messages")}
            value={lastUsage?.messageCount ?? 0}
            loading={statsLoading}
          />
          <StatCard
            title={i18next.t("general:Tokens")}
            value={lastUsage?.tokenCount ?? 0}
            loading={statsLoading}
          />
          {isAdmin && (
            <StatCard
              title={i18next.t("chat:Price")}
              value={lastUsage?.price ?? 0}
              prefix={lastUsage?.currency ? "$" : undefined}
              loading={statsLoading}
            />
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col items-end gap-2">
          {/* User selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{i18next.t("general:User")}:</span>
            <Select value={selectedUser} onValueChange={(v) => handleUserChange(v ?? "All")}>
              <SelectTrigger className="h-8 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All" disabled={!isAdmin}>
                  All
                </SelectItem>
                {users.map((user) => (
                  <SelectItem key={user} value={user}>
                    {user}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Range type toggle */}
          <div className="flex overflow-hidden rounded-md border border-border">
            {rangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRangeType(opt.value)}
                className={[
                  "border-r px-3 py-1.5 text-sm font-medium transition-colors last:border-r-0",
                  "border-border",
                  rangeType === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 gap-4 px-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <LeftChart data={activeData} rangeType={rangeType} isRange={isRangeMode} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <RightChart data={activeData} rangeType={rangeType} isRange={isRangeMode} isAdmin={isAdmin} />
        </div>
      </div>

      {/* Provider pie + Activity heatmap */}
      {(showProviderChart || showHeatmap) && (
        <div
          className={[
            "mt-4 grid grid-cols-1 gap-4 px-6",
            showProviderChart && showHeatmap ? "lg:grid-cols-[1fr_2fr]" : "",
          ].join(" ")}
        >
          {showProviderChart && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {i18next.t("general:Providers")}
              </h3>
              <ProviderPieChart data={providerData} />
            </div>
          )}
          {showHeatmap && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {i18next.t("general:Messages")}
              </h3>
              <CalendarHeatmap heatmapData={heatmapData} isDark={isDark} />
            </div>
          )}
        </div>
      )}

      {/* User stats table */}
      <UsageTable data={tableData} isAdmin={isAdmin} loading={tableLoading} />
    </div>
  )
}
