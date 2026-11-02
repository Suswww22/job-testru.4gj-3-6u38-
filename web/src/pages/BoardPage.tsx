// 投遞看板：五個欄位對應五種狀態，把卡片拖到另一欄就改狀態。
// 放開時先改畫面（樂觀更新），API 失敗再還原，拖拉才不會卡頓。

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEventHandler, type PointerEventHandler } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { STATUSES, type Application, type ApplicationStatus } from "../api/types";

const KEY = ["applications"] as const;
type ListData = { items: Application[] };

export function BoardPage() {
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: KEY, queryFn: api.listApplications });
  const [dragging, setDragging] = useState<Application | null>(null);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus }) => api.updateApplicationStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<ListData>(KEY);
      qc.setQueryData<ListData>(KEY, (d) => d && { items: d.items.map((a) => (a.id === id ? { ...a, status } : a)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
    // 投遞日可能被後端自動補上，職缺列表上的狀態也要更新
    onSettled: () => qc.invalidateQueries({ predicate: (k) => ["applications", "jobs"].includes(String(k.queryKey[0])) }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // 移動 5px 才算拖拉，點連結不會誤觸
    useSensor(KeyboardSensor), // 空白鍵拿起、方向鍵移動、空白鍵放下
  );

  function onDragStart(e: DragStartEvent) {
    setDragging(apps.data?.items.find((a) => a.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const app = apps.data?.items.find((a) => a.id === e.active.id);
    const to = e.over?.id as ApplicationStatus | undefined;
    if (app && to && to !== app.status) move.mutate({ id: app.id, status: to });
  }

  // 螢幕閱讀器的播報：預設是英文且念內部 id，改成職缺名稱與欄位名稱
  const titleOf = (id: string | number) => apps.data?.items.find((a) => a.id === id)?.job.title ?? "卡片";
  const columnOf = (id: string | number | undefined) => STATUSES.find((s) => s.id === id)?.label ?? "看板外";
  const accessibility = {
    screenReaderInstructions: { draggable: "按空白鍵拿起，用方向鍵移到其他欄位，再按空白鍵放下；按 Esc 取消。" },
    announcements: {
      onDragStart: ({ active }: DragStartEvent) => `拿起「${titleOf(active.id)}」`,
      onDragOver: ({ active, over }: DragEndEvent) => `「${titleOf(active.id)}」移到${columnOf(over?.id)}`,
      onDragEnd: ({ active, over }: DragEndEvent) => `「${titleOf(active.id)}」放到${columnOf(over?.id)}`,
      onDragCancel: ({ active }: DragEndEvent) => `取消移動「${titleOf(active.id)}」`,
    },
  };

  if (apps.isPending) return <p className="muted">載入中…</p>;
  if (apps.isError) return <p className="error">讀取失敗：{apps.error.message}</p>;
  if (apps.data.items.length === 0) {
    return <p className="muted">還沒有追蹤中的職缺。到<Link to="/jobs">職缺</Link>頁按「加入追蹤」。</p>;
  }

  return (
    <section className="stack">
      {move.isError && <p className="error" role="alert">更新失敗：{move.error.message}</p>}
      <DndContext sensors={sensors} accessibility={accessibility} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="board">
          {STATUSES.map((s) => (
            <Column key={s.id} status={s.id} label={s.label} items={apps.data.items.filter((a) => a.status === s.id)} />
          ))}
        </div>
        {/* 不播放放下動畫：卡片會直接出現在新欄位（樂觀更新），動畫反而會留下殘影 */}
        <DragOverlay dropAnimation={null}>
          {dragging && <div className="card kanban lifted"><CardBody app={dragging} /></div>}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function Column({ status, label, items }: { status: ApplicationStatus; label: string; items: Application[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`column s-${status}${isOver ? " over" : ""}`} aria-label={`${label}（${items.length}）`}>
      <h3>{label} <span className="muted">{items.length}</span></h3>
      {items.map((a) => <Card key={a.id} app={a} />)}
    </div>
  );
}

// 滑鼠：整張卡都能拖（移動 5px 才算拖，單點標題就是開詳情）。
// 鍵盤：拖拉交給右上角的把手按鈕；整張卡若是按鈕，裡面的連結就成了「按鈕裡的連結」，螢幕閱讀器會念不清楚
function Card({ app }: { app: Application }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: app.id });
  return (
    <div ref={setNodeRef} onPointerDown={listeners?.onPointerDown as PointerEventHandler | undefined} className={`card kanban${isDragging ? " ghosted" : ""}`}>
      <CardBody app={app} link />
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={listeners?.onKeyDown as KeyboardEventHandler | undefined}
        className="handle"
        aria-label={`移動「${app.job.title}」`}
      >
        ⠿
      </button>
    </div>
  );
}

function CardBody({ app, link = false }: { app: Application; link?: boolean }) {
  return (
    <>
      {link ? <Link to={`/applications/${app.id}`} className="card-title">{app.job.title}</Link> : <strong>{app.job.title}</strong>}
      <span className="muted">{app.job.company}</span>
      <span className="muted small">
        {app.appliedAt ? `投遞 ${new Date(app.appliedAt).toLocaleDateString("zh-TW")}` : "尚未投遞"}
        {app._count?.notes ? ` · 筆記 ${app._count.notes}` : ""}
      </span>
    </>
  );
}
