from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.orchestrator import PhaseExecution
from app.models.contracts import (
    EstimationEntry,
    EstimationSource,
    EstimationStatus,
    EstimationType,
    PhaseContext,
    PhaseId,
    PhaseOutput,
)


@dataclass(frozen=True)
class CaptureSpec:
    artifact_key: str
    prompt: str
    min_items: int = 1
    requires_number_or_unknown: bool = False
    requires_unit_or_unknown: bool = False


CAPTURE_SPECS: dict[PhaseId, CaptureSpec] = {
    PhaseId.FASE_0: CaptureSpec(
        artifact_key="actors",
        min_items=2,
        prompt=(
            "PREGUNTA 1 - ACTORES\n"
            "Actor | Tipo | Cantidad | Frecuencia | Permisos | Criticidad"
        ),
    ),
    PhaseId.FASE_1: CaptureSpec(
        artifact_key="objects",
        min_items=3,
        requires_number_or_unknown=True,
        requires_unit_or_unknown=True,
        prompt=(
            "PREGUNTA 2 - OBJETOS\n"
            "Enumera de 3 a 10 objetos principales con unidad/rango si aplica.\n"
            "Objeto | Volumen/dia | Retencion | Atributos | Owner | Criticidad"
        ),
    ),
    PhaseId.FASE_2: CaptureSpec(
        artifact_key="operations",
        min_items=1,
        prompt=(
            "PREGUNTA 3 - OPERACIONES\n"
            "Operacion | Actor | Objetos | Trigger | Resultado | Estado_Modificado | Criticidad"
        ),
    ),
    PhaseId.FASE_3: CaptureSpec(
        artifact_key="states",
        min_items=3,
        prompt=(
            "PREGUNTA 4 - ESTADOS\n"
            "Objeto | Estado_Origen | Evento | Estado_Destino | Rollback | Terminal"
        ),
    ),
    PhaseId.FASE_3B: CaptureSpec(
        artifact_key="relations",
        prompt=(
            "PREGUNTA 4B - RELACIONES\n"
            "Origen | Relacion | Destino | Cardinalidad | Propagacion | Obligatoria"
        ),
    ),
    PhaseId.FASE_4: CaptureSpec(
        artifact_key="rules",
        min_items=5,
        prompt="PREGUNTA 5 - REGLAS\nRegla | Tipo | Condicion | Rechazo | Severidad",
    ),
    PhaseId.FASE_5: CaptureSpec(
        artifact_key="events",
        prompt="PREGUNTA 6 - EVENTOS\nEvento | Origen | Prioridad | Accion | Timeout | Error_Strategy",
    ),
    PhaseId.FASE_6: CaptureSpec(
        artifact_key="time",
        requires_number_or_unknown=True,
        requires_unit_or_unknown=True,
        prompt="PREGUNTA 7 - TIEMPO\nElemento | SLA | Timeout | Expiracion | Scheduler",
    ),
    PhaseId.FASE_7: CaptureSpec(
        artifact_key="resources",
        requires_number_or_unknown=True,
        requires_unit_or_unknown=True,
        prompt="PREGUNTA 8 - RECURSOS\nRecurso | Maximo | Unidad | Degradacion | Monitoreo",
    ),
    PhaseId.FASE_7B: CaptureSpec(
        artifact_key="space",
        prompt="PREGUNTA 8B - ESPACIO\nComponente | Ubicacion | Region | Replicacion | Latencia_Max",
    ),
    PhaseId.FASE_7C: CaptureSpec(
        artifact_key="communication",
        prompt="PREGUNTA 8C - COMUNICACION\nEmisor | Receptor | Protocolo | Sync_Async | Retry | Orden_Garantizado",
    ),
    PhaseId.FASE_8B: CaptureSpec(
        artifact_key="objectives",
        prompt="PREGUNTA 8B - OBJETIVOS\nObjetivo | KPI | Operaciones_Afectadas | Evidencia_Verificable",
    ),
}


def execute_capture_phase(ctx: PhaseContext) -> PhaseExecution:
    spec = CAPTURE_SPECS[ctx.phase_id]
    raw_answer = (ctx.user_input or "").strip()
    rows = parse_rows(raw_answer)
    payload = {
        "raw": raw_answer,
        "rows": rows,
        "item_count": len(rows),
        "quality_flags": quality_flags(raw_answer, spec),
        "source": "human",
    }
    updates: dict[str, Any] = {spec.artifact_key: payload}

    if ctx.phase_id == PhaseId.FASE_0:
        updates["actor_seed"] = {"raw_goal": raw_answer, "source": "human"}
    if ctx.phase_id == PhaseId.FASE_1:
        updates["objects_raw"] = raw_answer

    output = PhaseOutput(
        phase_id=ctx.phase_id,
        artifact_updates={"dimensions_12d": updates},
        questions_asked=[next_prompt(ctx.phase_id)],
        estimations=estimation_entries(spec.artifact_key, raw_answer),
    )
    return PhaseExecution(output=output, prompt=output.questions_asked[0])


def next_prompt(phase_id: PhaseId) -> str:
    sequence = list(CAPTURE_SPECS)
    index = sequence.index(phase_id)
    if index == len(sequence) - 1:
        return "Continuare con validacion de completitud."
    return CAPTURE_SPECS[sequence[index + 1]].prompt


def parse_rows(raw_answer: str) -> list[dict[str, str]]:
    rows = []
    for line in raw_answer.splitlines():
        clean = line.strip().strip("|")
        if not clean or set(clean) <= {"-", "|", " "}:
            continue
        cells = [cell.strip() for cell in clean.split("|") if cell.strip()]
        if cells:
            rows.append({f"c{i + 1}": cell for i, cell in enumerate(cells)})
    if rows:
        return rows
    return [{"c1": item.strip()} for item in raw_answer.split(";") if item.strip()]


def quality_flags(raw_answer: str, spec: CaptureSpec) -> list[str]:
    flags = []
    item_count = len(parse_rows(raw_answer))
    if item_count < spec.min_items:
        flags.append(f"min_items:{item_count}/{spec.min_items}")
    if spec.requires_number_or_unknown and not has_number_or_unknown(raw_answer):
        flags.append("missing_number_or_unknown")
    if spec.requires_unit_or_unknown and not has_unit_or_unknown(raw_answer):
        flags.append("missing_unit_or_unknown")
    return flags


def estimation_entries(field: str, raw_answer: str) -> list[EstimationEntry]:
    if not contains_unknown(raw_answer):
        return []
    return [
        EstimationEntry(
            id=f"EST_{field}_unknown",
            campo=field,
            tipo=EstimationType.DESCONOCIDO,
            valor_usado="DESCONOCIDO",
            confianza=0.5,
            fuente=EstimationSource.HUMANO_DESCONOCIDO,
            mitigation="Documentar y resolver con defaults_repository.",
            requiere_revision=True,
            estado=EstimationStatus.ACTIVA,
        )
    ]


def contains_unknown(raw_answer: str) -> bool:
    normalized = raw_answer.lower()
    return any(token in normalized for token in ("desconocido", "no se", "nose"))


def has_number_or_unknown(raw_answer: str) -> bool:
    return any(char.isdigit() for char in raw_answer) or contains_unknown(raw_answer)


def has_unit_or_unknown(raw_answer: str) -> bool:
    normalized = raw_answer.lower()
    units = ("ms", "s", "seg", "min", "hora", "dia", "rps", "mb", "gb", "tb")
    return any(unit in normalized for unit in units) or contains_unknown(raw_answer)
