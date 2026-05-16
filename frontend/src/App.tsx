import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import ReactFlow, { Background, Controls, Edge, Node } from "reactflow";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import {
  advanceSession,
  ApiError,
  createSession,
  getSession,
  InterviewSession,
  ScoreReport,
  submitCheckpoint,
  TurnResult
} from "./api";

const phases = [
  "FASE_0",
  "FASE_1",
  "FASE_2",
  "FASE_3",
  "FASE_3B",
  "FASE_4",
  "FASE_5",
  "FASE_6",
  "FASE_7",
  "FASE_7B",
  "FASE_7C",
  "FASE_8",
  "FASE_8B",
  "FASE_9",
  "FASE_10",
  "FASE_11",
  "FASE_12",
  "FASE_13",
  "FASE_14",
  "FASE_15",
  "FASE_16",
  "FASE_17",
  "FASE_18"
];

type ArtifactRow = {
  key: string;
  kind: string;
  preview: string;
};

export function App() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("demo-sec");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [checkpoint, setCheckpoint] = useState("SI");
  const [lastTurn, setLastTurn] = useState<TurnResult | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["session", activeSessionId],
    queryFn: () => getSession(activeSessionId as string),
    enabled: Boolean(activeSessionId),
    refetchInterval: false
  });

  const createMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (turn) => {
      setActiveSessionId(turn.session_id);
      setLastTurn(turn);
      queryClient.invalidateQueries({ queryKey: ["session", turn.session_id] });
    }
  });

  const advanceMutation = useMutation({
    mutationFn: () => advanceSession(activeSessionId as string, answer),
    onSuccess: (turn) => {
      setAnswer("");
      setLastTurn(turn);
      queryClient.invalidateQueries({ queryKey: ["session", activeSessionId] });
    }
  });

  const checkpointMutation = useMutation({
    mutationFn: () => submitCheckpoint(activeSessionId as string, checkpoint),
    onSuccess: (turn) => {
      setLastTurn(turn);
      queryClient.invalidateQueries({ queryKey: ["session", activeSessionId] });
    }
  });

  const session = sessionQuery.data;
  const currentPhase = session?.current_phase ?? lastTurn?.current_phase ?? "FASE_0";
  const currentPhaseIndex = phases.indexOf(currentPhase);
  const busy =
    createMutation.isPending ||
    advanceMutation.isPending ||
    checkpointMutation.isPending ||
    sessionQuery.isFetching;
  const error =
    errorMessage(createMutation.error) ||
    errorMessage(advanceMutation.error) ||
    errorMessage(checkpointMutation.error) ||
    errorMessage(sessionQuery.error);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={24} />
          <div>
            <strong>Entrevistador V6</strong>
            <span>SEC Operations Console</span>
          </div>
        </div>
        <PhaseStepper currentPhaseIndex={currentPhaseIndex} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{currentPhase}</h1>
            <p>{statusLine(session, lastTurn)}</p>
          </div>
          <div className="session-controls">
            <input
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              aria-label="Session ID"
            />
            <button
              disabled={!sessionId || createMutation.isPending}
              onClick={() => createMutation.mutate(sessionId)}
            >
              {createMutation.isPending ? <Loader2 size={18} /> : <Play size={18} />}
              Crear
            </button>
            <button
              className="secondary"
              disabled={!sessionId || sessionQuery.isFetching}
              onClick={() => {
                setActiveSessionId(sessionId);
                setLastTurn(null);
              }}
            >
              <RefreshCw size={18} />
              Cargar
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <SessionSummary session={session} lastTurn={lastTurn} busy={busy} />

        <section className="phase-panel">
          <div className="prompt-surface">
            <div className="panel-heading">
              <FileText size={18} />
              <span>Prompt activo</span>
            </div>
            <pre>{lastTurn?.prompt ?? "Crea o carga una sesion para iniciar."}</pre>
          </div>
          <div className="answer-surface">
            <div className="panel-heading">
              <ChevronRight size={18} />
              <span>Entrada</span>
            </div>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Respuesta estructurada para la fase actual"
              disabled={!activeSessionId || isCheckpointPhase(currentPhase)}
            />
            <div className="action-row">
              <button
                disabled={
                  !activeSessionId ||
                  advanceMutation.isPending ||
                  isCheckpointPhase(currentPhase)
                }
                onClick={() => advanceMutation.mutate()}
              >
                {advanceMutation.isPending ? <Loader2 size={18} /> : <ChevronRight size={18} />}
                Avanzar
              </button>
            </div>
          </div>
        </section>

        <section className="grid-two">
          <CheckpointPanel
            currentPhase={currentPhase}
            checkpoint={checkpoint}
            setCheckpoint={setCheckpoint}
            disabled={!activeSessionId || checkpointMutation.isPending}
            onSubmit={() => checkpointMutation.mutate()}
          />
          <ScorePanel session={session} />
        </section>

        <section className="grid-two large">
          <ArtifactTable session={session} />
          <GraphPanel session={session} />
        </section>

        <section className="grid-two large">
          <SecPanel session={session} />
          <TraceabilityPanel session={session} />
        </section>
      </section>
    </main>
  );
}

function PhaseStepper({ currentPhaseIndex }: { currentPhaseIndex: number }) {
  return (
    <nav className="phase-stepper" aria-label="Phase stepper">
      {phases.map((phase, index) => (
        <div
          key={phase}
          className={
            index === currentPhaseIndex
              ? "phase active"
              : index < currentPhaseIndex
                ? "phase done"
                : "phase"
          }
        >
          <span>{index + 1}</span>
          <strong>{phase}</strong>
        </div>
      ))}
    </nav>
  );
}

function CheckpointPanel({
  currentPhase,
  checkpoint,
  setCheckpoint,
  disabled,
  onSubmit
}: {
  currentPhase: string;
  checkpoint: string;
  setCheckpoint: (value: string) => void;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const allowed = checkpointOptions(currentPhase);
  const isBlocked = disabled || allowed.length === 0;

  return (
    <section className="surface">
      <div className="panel-heading">
        <CheckCircle2 size={18} />
        <span>Checkpoint humano</span>
      </div>
      {allowed.length === 0 ? (
        <p className="muted">Disponible solo en FASE_11 y FASE_18.</p>
      ) : null}
      <select
        value={checkpoint}
        onChange={(event) => setCheckpoint(event.target.value)}
        disabled={isBlocked}
      >
        {allowed.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button disabled={isBlocked} onClick={onSubmit}>
        <CheckCircle2 size={18} />
        Enviar decision
      </button>
    </section>
  );
}

function ScorePanel({ session }: { session?: InterviewSession }) {
  const scores = Object.entries(session?.scores ?? {});
  return (
    <section className="surface">
      <div className="panel-heading">
        <ShieldCheck size={18} />
        <span>Scores</span>
      </div>
      {scores.length === 0 ? (
        <p className="muted">Sin scores persistidos.</p>
      ) : (
        <div className="score-list">
          {scores.map(([key, value]) => (
            <ScoreCard key={key} name={key} score={value} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArtifactTable({ session }: { session?: InterviewSession }) {
  const rows = useMemo<ArtifactRow[]>(() => {
    if (!session) return [];
    const dimensions = Object.entries(session.artifacts.dimensions_12d).map(
      ([key, value]) => ({
        key,
        kind: "dimension",
        preview: preview(value)
      })
    );
    const documents = [
      ["sec_initial", session.artifacts.sec_initial],
      ["sec_extended", session.artifacts.sec_extended],
      ["system_graph", session.artifacts.system_graph],
      ["traceability_graph", session.artifacts.traceability_graph]
    ]
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => ({
        key: String(key),
        kind: "artifact",
        preview: preview(value)
      }));
    return [...dimensions, ...documents];
  }, [session]);

  const columns = useMemo<ColumnDef<ArtifactRow>[]>(
    () => [
      { accessorKey: "key", header: "Artifact" },
      { accessorKey: "kind", header: "Tipo" },
      { accessorKey: "preview", header: "Preview" }
    ],
    []
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <section className="surface table-surface">
      <div className="panel-heading">
        <FileText size={18} />
        <span>Artefactos</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Sin artefactos persistidos para esta sesion.</p>
      ) : (
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GraphPanel({ session }: { session?: InterviewSession }) {
  const { nodes, edges } = useMemo(() => graphElements(session), [session]);
  return (
    <section className="surface graph-surface">
      <div className="panel-heading">
        <GitBranch size={18} />
        <span>System Graph</span>
      </div>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
      {!session?.artifacts.system_graph ? (
        <p className="muted">
          SYSTEM_GRAPH aun no existe; corresponde al paso posterior del plan.
        </p>
      ) : null}
    </section>
  );
}

function graphElements(session?: InterviewSession): { nodes: Node[]; edges: Edge[] } {
  const graph = session?.artifacts.system_graph;
  if (!graph) return { nodes: [], edges: [] };

  const nodes: Node[] = graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 4) * 210, y: Math.floor(index / 4) * 120 },
    data: { label: `${node.tipo}: ${node.id}` },
    type: "default"
  }));
  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `${edge.source}-${edge.target}-${edge.tipo}-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.tipo
  }));
  return { nodes, edges };
}

function SessionSummary({
  session,
  lastTurn,
  busy
}: {
  session?: InterviewSession;
  lastTurn?: TurnResult | null;
  busy: boolean;
}) {
  const summary = lastTurn?.artifacts_summary;
  return (
    <section className="status-strip">
      <StatusItem label="Sesion" value={session?.session_id ?? lastTurn?.session_id ?? "-"} />
      <StatusItem label="Fase" value={session?.current_phase ?? lastTurn?.current_phase ?? "FASE_0"} />
      <StatusItem label="Bloqueado" value={lastTurn?.blocked ? "si" : "no"} />
      <StatusItem label="Actividad" value={busy ? "sincronizando" : "estable"} />
      <StatusItem
        label="SEC inicial"
        value={summary?.has_sec_initial || session?.artifacts.sec_initial ? "presente" : "pendiente"}
      />
    </section>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreCard({ name, score }: { name: string; score: ScoreReport }) {
  return (
    <div className="score-card">
      <div>
        <strong>{name}</strong>
        <span>{score.status}</span>
      </div>
      <meter min={0} max={100} value={score.percent} />
      <p>
        {score.percent}% - {score.total_points}/{score.max_points}
      </p>
      {score.risk ? <p>Riesgo: {score.risk}</p> : null}
      {score.rules.length > 0 ? (
        <details>
          <summary>Reglas</summary>
          <ul>
            {score.rules.map((rule) => (
              <li key={rule.rule_id}>
                {rule.rule_id}: {rule.points}/{rule.max_points} -{" "}
                {rule.passed ? "PASS" : "FAIL"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SecPanel({ session }: { session?: InterviewSession }) {
  const sec = session?.artifacts.sec_extended ?? session?.artifacts.sec_initial;
  return (
    <section className="surface document-surface">
      <div className="panel-heading">
        <FileText size={18} />
        <span>SEC</span>
      </div>
      {sec ? (
        <pre>{JSON.stringify(sec, null, 2)}</pre>
      ) : (
        <p className="muted">SEC pendiente hasta que FASE_10 genere el contrato inicial.</p>
      )}
    </section>
  );
}

function TraceabilityPanel({ session }: { session?: InterviewSession }) {
  const traceability = session?.artifacts.traceability_graph;
  return (
    <section className="surface document-surface">
      <div className="panel-heading">
        <GitBranch size={18} />
        <span>Traceability</span>
      </div>
      {traceability ? (
        <pre>{JSON.stringify(traceability, null, 2)}</pre>
      ) : (
        <p className="muted">
          TRACEABILITY_GRAPH aun no existe; corresponde al paso posterior del plan.
        </p>
      )}
    </section>
  );
}

function statusLine(session?: InterviewSession, lastTurn?: TurnResult | null) {
  if (!session && !lastTurn) return "Sin sesion activa";
  const gate = lastTurn?.gate?.status ? `Gate ${lastTurn.gate.status}` : "Gate pendiente";
  const auditCount = session?.audit_log.length ?? 0;
  return `${gate} - ${auditCount} eventos auditados`;
}

function preview(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function checkpointOptions(currentPhase: string) {
  if (currentPhase === "FASE_11") {
    return [
      { value: "SI", label: "SI" },
      { value: "NO_CAMBIAR: ajustar SEC", label: "NO_CAMBIAR" },
      { value: "INCOMPLETO: FASE_4", label: "INCOMPLETO" }
    ];
  }
  if (currentPhase === "FASE_18") {
    return [
      { value: "SI", label: "SI" },
      { value: "NO_CAMBIAR: ajustar paquete final", label: "NO_CAMBIAR" },
      { value: "INCOMPLETO: FASE_14", label: "INCOMPLETO" },
      { value: "REVALIDAR: riesgos", label: "REVALIDAR" }
    ];
  }
  return [];
}

function isCheckpointPhase(phase: string) {
  return phase === "FASE_11" || phase === "FASE_18";
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Error desconocido";
}
