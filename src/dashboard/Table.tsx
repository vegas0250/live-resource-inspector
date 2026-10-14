import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { DisplayRow } from './model';

export interface TableColumn {
  id: string;
  title: string;
  width: string;
  cell: (row: DisplayRow) => ReactNode;
}

interface DataTableProps {
  rows: DisplayRow[];
  columns: TableColumn[];
  selected: Set<string>;
  activeId: string | null;
  onRow: (row: DisplayRow, index: number, event: { shift: boolean; toggle: boolean }) => void;
  onToggle: (id: string) => void;
}

export function DataTable({ rows, columns, selected, activeId, onRow, onToggle }: DataTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });
  const template = ['28px', ...columns.map((column) => column.width)].join(' ');
  const items = virtualizer.getVirtualItems();

  return (
    <div className="table-frame">
      <div className="grid-row header" style={{ gridTemplateColumns: template }}>
        <span />
        {columns.map((column) => (
          <span key={column.id}>{column.title}</span>
        ))}
      </div>
      <div className="table-scroll" ref={parentRef}>
        {rows.length === 0 ? (
          <p className="empty">Нет записей для текущего фильтра.</p>
        ) : (
          <div className="table-space" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const className = ['grid-row', selected.has(row.id) ? 'selected' : '', activeId === row.id ? 'active' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={row.id}
                  className={className}
                  style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
                  onClick={(event) => onRow(row, item.index, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    aria-label="Выделить запись"
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggle(row.id)}
                  />
                  {columns.map((column) => {
                    const value = column.cell(row);
                    return (
                      <span key={column.id} className="cell" title={typeof value === 'string' ? value : undefined}>
                        {value}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
