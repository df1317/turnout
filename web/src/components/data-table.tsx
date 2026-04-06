import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  getFilteredRowModel,
} from '@tanstack/react-table'
import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  filterPlaceholder?: string
  onRowClick?: (row: TData) => void
  enableRowSelection?: boolean
  onSelectionChange?: (rows: TData[]) => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterPlaceholder = 'Filter…',
  onRowClick,
  enableRowSelection = false,
  onSelectionChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  const selectColumn: ColumnDef<TData, TValue> = {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  }

  const allColumns = enableRowSelection ? [selectColumn, ...columns] : columns

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      setRowSelection(next)
      if (onSelectionChange) {
        const selectedRowIds = Object.keys(next)
        const selected = selectedRowIds.length === 0
          ? []
          : table.getRowModel().rows.filter(r => next[r.id]).map(r => r.original)
        onSelectionChange(selected)
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const totalCount = table.getFilteredRowModel().rows.length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder={filterPlaceholder}
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="max-w-sm h-8 text-xs"
        />
        {enableRowSelection && selectedCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedCount} of {totalCount} selected
          </span>
        )}
      </div>
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={cn('px-4 py-2.5', canSort && 'cursor-pointer select-none')}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-muted-foreground/60">
                            {sorted === 'asc' ? (
                              <ChevronUp className="size-3" />
                            ) : sorted === 'desc' ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronsUpDown className="size-3" />
                            )}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="text-center py-10 text-muted-foreground text-xs">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map(row => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-muted/50')}
                >
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} className="px-4 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
