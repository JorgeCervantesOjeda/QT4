import { useEffect, useMemo, useState } from 'react'
import {
  createTable,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type FilterFn,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type TableOptions,
  type TableOptionsResolved,
} from '@tanstack/react-table'

type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  tableClassName?: string
  getRowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  storageKey?: string
  enablePagination?: boolean
  initialPageSize?: number
}

function DataTable<T>( {
  columns,
  data,
  sorting,
  onSortingChange,
  tableClassName,
  getRowClassName,
  onRowClick,
  storageKey,
  enablePagination = false,
  initialPageSize = 20,
}: DataTableProps<T> ) {
  const columnPinning = useMemo<ColumnPinningState>( () => ( { left: [], right: [] } ), [] )

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>( () => {
    if( !storageKey ) {
      return []
    }
    const stored = window.localStorage.getItem( `${storageKey}:filters` )
    if( !stored ) {
      return []
    }
    try {
      const parsed = JSON.parse( stored ) as ColumnFiltersState
      return Array.isArray( parsed ) ? parsed : []
    } catch {
      return []
    }
  } )

  const [pagination, setPagination] = useState<PaginationState>( () => {
    if( !enablePagination ) {
      return { pageIndex: 0, pageSize: initialPageSize }
    }
    if( !storageKey ) {
      return { pageIndex: 0, pageSize: initialPageSize }
    }
    const stored = window.localStorage.getItem( `${storageKey}:pagination` )
    if( !stored ) {
      return { pageIndex: 0, pageSize: initialPageSize }
    }
    try {
      const parsed = JSON.parse( stored ) as PaginationState
      if(
        typeof parsed?.pageIndex === 'number' &&
        typeof parsed?.pageSize === 'number' &&
        parsed.pageSize > 0
      ) {
        return parsed
      }
      return { pageIndex: 0, pageSize: initialPageSize }
    } catch {
      return { pageIndex: 0, pageSize: initialPageSize }
    }
  } )

  const containsTextFilter = useMemo<FilterFn<T>>(
    () => ( row, columnId, filterValue ) => {
      const raw = row.getValue( columnId )
      if( raw === null || raw === undefined ) {
        return false
      }
      const normalized = Array.isArray( raw ) ? raw.join( ' ' ) : String( raw )
      return normalized.toLowerCase().includes( String( filterValue ).toLowerCase() )
    },
    [],
  )

  const handleSortingChange: OnChangeFn<SortingState> = ( updater ) => {
    if( enablePagination ) {
      setPagination( ( previous ) => ( { ...previous, pageIndex: 0 } ) )
    }
    onSortingChange( updater )
  }

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = ( updater ) => {
    if( enablePagination ) {
      setPagination( ( previous ) => ( { ...previous, pageIndex: 0 } ) )
    }
    setColumnFilters( updater )
  }

  const tableOptions: TableOptions<T> = {
    data,
    columns,
    state: { sorting, columnFilters, pagination, columnPinning },
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    enableSortingRemoval: true,
    filterFns: {
      containsText: containsTextFilter,
    },
    defaultColumn: {
      filterFn: containsTextFilter,
    },
  }

  const resolvedOptions: TableOptionsResolved<T> = {
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
    ...tableOptions,
  }

  const [table] = useState( () => createTable<T>( resolvedOptions ) )

  table.setOptions( ( previous ) => ( {
    ...previous,
    ...resolvedOptions,
  } ) )

  useEffect( () => {
    if( !storageKey ) {
      return
    }
    window.localStorage.setItem( `${storageKey}:filters`, JSON.stringify( columnFilters ) )
  }, [ storageKey, columnFilters ] )

  useEffect( () => {
    if( !enablePagination || !storageKey ) {
      return
    }
    window.localStorage.setItem( `${storageKey}:pagination`, JSON.stringify( pagination ) )
  }, [ enablePagination, storageKey, pagination ] )

  return (
    <div className={`data-table ${tableClassName ?? ''}`.trim()}>
      <table>
        <colgroup>
          {table.getHeaderGroups()[0]?.headers.map( ( header ) => (
            <col key={header.id} />
          ) )}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map( ( headerGroup ) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map( ( header ) => {
                const canSort = header.column.getCanSort()
                const sortHandler = canSort ? header.column.getToggleSortingHandler() : undefined
                const sortState = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    onClick={sortHandler}
                    role={canSort ? 'button' : undefined}
                    tabIndex={canSort ? 0 : undefined}
                    onKeyDown={
                      canSort
                        ? ( event ) => {
                          if( event.key === 'Enter' || event.key === ' ' ) {
                            event.preventDefault()
                            header.column.toggleSorting()
                          }
                        }
                        : undefined
                    }
                    aria-sort={
                      sortState === 'asc'
                        ? 'ascending'
                        : sortState === 'desc'
                          ? 'descending'
                          : 'none'
                    }
                  >
                    <div className="data-table__header">
                      <span>{flexRender( header.column.columnDef.header, header.getContext() )}</span>
                      {canSort ? (
                        <span className="data-table__sort-indicator">
                          {sortState === 'asc' ? '^' : sortState === 'desc' ? 'v' : '<->'}
                        </span>
                      ) : null}
                    </div>
                    {header.column.getCanFilter() ? (
                      <div className="data-table__filter" onClick={( event ) => event.stopPropagation()}>
                        <input
                          type="text"
                          value={( header.column.getFilterValue() as string ) ?? ''}
                          onChange={( event ) => header.column.setFilterValue( event.target.value )}
                          placeholder="Filter"
                        />
                      </div>
                    ) : null}
                  </th>
                )
              } )}
            </tr>
          ) )}
        </thead>
        <tbody>
          {table.getRowModel().rows.map( ( row ) => {
            const rowData = row.original
            const rowClassName = getRowClassName ? getRowClassName( rowData ) : ''
            return (
              <tr
                key={row.id}
                className={rowClassName}
                onClick={onRowClick ? () => onRowClick( rowData ) : undefined}
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? ( event ) => {
                      if( event.key === 'Enter' || event.key === ' ' ) {
                        event.preventDefault()
                        onRowClick( rowData )
                      }
                    }
                    : undefined
                }
              >
                {row.getVisibleCells().map( ( cell ) => (
                  <td key={cell.id}>{flexRender( cell.column.columnDef.cell, cell.getContext() )}</td>
                ) )}
              </tr>
            )
          } )}
        </tbody>
      </table>
      {enablePagination ? (
        <div className="data-table__pagination">
          <div className="actions">
            <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </button>
            <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </button>
          </div>
          <p className="muted">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max( 1, table.getPageCount() )}
          </p>
          <label className="field">
            <span>Rows per page</span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={( event ) => table.setPageSize( Number( event.target.value ) )}
            >
              {[ 10, 20, 50, 100 ].map( ( size ) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ) )}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}

export default DataTable
