"""Strømsmart: finn de billigste tidspunktene å bruke strøm.

Modulen bruker bare standardbiblioteket og har ingen sideeffekter, så den
samme filen kan testes med unittest, kjøres fra terminalen og lastes inn i
nettleseren med Pyodide.

    python stromsmart.py NO1          # billigste tre timer i dag
    python -m unittest test_stromsmart
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

VAT = 0.25
# Husholdninger i Nord-Norge (NO4) betaler ikke merverdiavgift på strøm.
VAT_EXEMPT_AREAS = {"NO4"}


@dataclass(frozen=True)
class Interval:
    """Ett prisintervall. Prisen er i kroner per kWh."""

    start: datetime
    end: datetime
    price: float

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600


def parse_prices(raw: list[dict], area: str = "NO1", include_vat: bool = True) -> list[Interval]:
    """Gjør om API-svaret til sorterte intervaller, med eller uten mva."""
    factor = 1 + VAT if include_vat and area not in VAT_EXEMPT_AREAS else 1.0
    intervals = [
        Interval(
            datetime.fromisoformat(row["time_start"]),
            datetime.fromisoformat(row["time_end"]),
            row["NOK_per_kWh"] * factor,
        )
        for row in raw
    ]
    return sorted(intervals, key=lambda i: i.start)


def clip(intervals: list[Interval], earliest: datetime, deadline: datetime | None) -> list[Interval]:
    """Beholder bare den delen av hvert intervall som ligger mellom earliest og deadline."""
    out = []
    for i in intervals:
        start = max(i.start, earliest)
        end = min(i.end, deadline) if deadline else i.end
        if end > start:
            out.append(Interval(start, end, i.price))
    return out


def summarize(intervals: list[Interval]) -> dict:
    """Nøkkeltall for en prisperiode. Snittet er vektet på intervallenes lengde."""
    if not intervals:
        raise ValueError("Ingen priser å oppsummere.")
    total_hours = sum(i.hours for i in intervals)
    cheapest = min(intervals, key=lambda i: i.price)
    dearest = max(intervals, key=lambda i: i.price)
    return {
        "min": cheapest.price,
        "max": dearest.price,
        "mean": sum(i.price * i.hours for i in intervals) / total_hours,
        "median": median(i.price for i in intervals),
        "cheapest_start": cheapest.start.isoformat(),
        "dearest_start": dearest.start.isoformat(),
    }


def cost_of_run(intervals: list[Interval], start: datetime, hours: float, kw: float) -> float | None:
    """Kostnaden ved å trekke kw sammenhengende i `hours` timer fra `start`.

    Returnerer None hvis prisene ikke dekker hele perioden.
    """
    end = start + timedelta(hours=hours)
    covered = 0.0
    cost = 0.0
    for i in intervals:
        overlap = (min(i.end, end) - max(i.start, start)).total_seconds() / 3600
        if overlap > 0:
            covered += overlap
            cost += overlap * kw * i.price
    return cost if covered >= hours - 1e-9 else None


def cheapest_window(intervals: list[Interval], hours: float, kwh: float) -> dict:
    """Billigste sammenhengende tidsrom, for apparater som ikke kan stoppes underveis.

    Det billigste vinduet starter alltid på en intervallgrense eller slutter på en,
    så det holder å prøve disse kandidatene.
    """
    if hours <= 0 or kwh <= 0:
        raise ValueError("Varighet og energi må være større enn null.")
    kw = kwh / hours
    candidates = {i.start for i in intervals} | {i.end - timedelta(hours=hours) for i in intervals}
    first = intervals[0].start if intervals else None
    best = None
    for start in sorted(candidates):
        if first is None or start < first:
            continue
        cost = cost_of_run(intervals, start, hours, kw)
        if cost is not None and (best is None or cost < best[1] - 1e-12):
            best = (start, cost)
    if best is None:
        raise ValueError("Det er ikke nok tid igjen til å bli ferdig innen fristen.")
    start, cost = best
    end = start + timedelta(hours=hours)
    return {"blocks": [{"start": start.isoformat(), "end": end.isoformat()}], "cost": cost, "hours": hours}


def cheapest_slots(intervals: list[Interval], kwh: float, kw: float) -> dict:
    """Billigste oppdelte lading, for forbruk som kan settes på pause (elbil, varmtvann).

    Grådig valg er optimalt her: hver time er uavhengig, så vi fyller opp
    de billigste intervallene først til behovet er dekket.
    """
    if kwh <= 0 or kw <= 0:
        raise ValueError("Energi og effekt må være større enn null.")
    needed = kwh / kw
    if sum(i.hours for i in intervals) < needed - 1e-9:
        raise ValueError("Det er ikke nok tid igjen til å bli ferdig innen fristen.")

    chosen: list[Interval] = []
    cost = 0.0
    remaining = needed
    for i in sorted(intervals, key=lambda i: (i.price, i.start)):
        if remaining <= 1e-9:
            break
        used = min(i.hours, remaining)
        if used < i.hours and any(c.start == i.end for c in chosen):
            # Et delvis brukt intervall legges inntil den neste bolken, så ladingen ikke starter og stopper unødig.
            chosen.append(Interval(i.end - timedelta(hours=used), i.end, i.price))
        else:
            chosen.append(Interval(i.start, i.start + timedelta(hours=used), i.price))
        cost += used * kw * i.price
        remaining -= used

    return {"blocks": merge_blocks(chosen), "cost": cost, "hours": needed}


def merge_blocks(chosen: list[Interval]) -> list[dict]:
    """Slår sammen tilstøtende intervaller til sammenhengende bolker."""
    blocks: list[list[datetime]] = []
    for i in sorted(chosen, key=lambda i: i.start):
        if blocks and i.start <= blocks[-1][1]:
            blocks[-1][1] = max(blocks[-1][1], i.end)
        else:
            blocks.append([i.start, i.end])
    return [{"start": s.isoformat(), "end": e.isoformat()} for s, e in blocks]


def plan(intervals: list[Interval], now: datetime, task: dict) -> dict:
    """Lager en plan for en oppgave og sammenligner med å starte med en gang."""
    deadline = datetime.fromisoformat(task["deadline"]) if task.get("deadline") else None
    available = clip(intervals, now, deadline)
    if not available:
        raise ValueError("Det finnes ingen priser for det valgte tidsrommet.")

    kwh = float(task["kwh"])
    if task["mode"] == "flexible":
        kw = float(task["kw"])
        result = cheapest_slots(available, kwh, kw)
    else:
        result = cheapest_window(available, float(task["hours"]), kwh)
        kw = kwh / result["hours"]

    baseline = cost_of_run(available, available[0].start, result["hours"], kw)
    result["mode"] = task["mode"]
    result["avg_price"] = result["cost"] / kwh
    result["baseline_cost"] = baseline
    result["saving"] = None if baseline is None else baseline - result["cost"]
    return result


def analyze(request_json: str) -> str:
    """Inngangen fra nettleseren: JSON inn, JSON ut."""
    request = json.loads(request_json)
    try:
        intervals = parse_prices(request["prices"], request.get("area", "NO1"), request.get("include_vat", True))
        now = datetime.fromisoformat(request["now"])
        response = {
            "summary": summarize(intervals),
            "intervals": [{"start": i.start.isoformat(), "end": i.end.isoformat(), "price": i.price} for i in intervals],
        }
        if request.get("task"):
            response["plan"] = plan(intervals, now, request["task"])
        return json.dumps(response)
    except (ValueError, KeyError) as error:
        return json.dumps({"error": str(error)})


def main() -> None:
    """Kommandolinje: henter dagens priser og skriver ut de billigste tre timene."""
    import sys
    from datetime import date
    from urllib.request import Request, urlopen

    sys.stdout.reconfigure(encoding="utf-8")
    area = sys.argv[1].upper() if len(sys.argv) > 1 else "NO1"
    today = date.today()
    url = f"https://www.hvakosterstrommen.no/api/v1/prices/{today.year}/{today:%m-%d}_{area}.json"
    with urlopen(Request(url, headers={"User-Agent": "stromsmart"}), timeout=10) as response:
        intervals = parse_prices(json.load(response), area)

    stats = summarize(intervals)
    vat_note = "uten mva" if area in VAT_EXEMPT_AREAS else "inkl. mva"
    window = cheapest_window(intervals, hours=3, kwh=3)
    start = datetime.fromisoformat(window["blocks"][0]["start"])
    print(f"{area} {today:%d.%m.%Y}: snitt {stats['mean'] * 100:.0f} øre/kWh, "
          f"lavest {stats['min'] * 100:.0f}, høyest {stats['max'] * 100:.0f} ({vat_note})")
    print(f"Billigste tre timer starter kl. {start:%H:%M} ({window['cost'] / 3 * 100:.0f} øre/kWh i snitt)")


if __name__ == "__main__":
    main()
