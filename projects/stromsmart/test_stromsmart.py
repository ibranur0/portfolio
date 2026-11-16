"""Tester for stromsmart. Kjør med: python -m unittest test_stromsmart"""

import json
import unittest
from datetime import datetime, timedelta, timezone

import stromsmart as s

OSLO = timezone(timedelta(hours=1))
MIDNIGHT = datetime(2026, 1, 15, 0, 0, tzinfo=OSLO)


def day(prices: list[float], minutes: int = 60) -> list[dict]:
    """Lager et API-svar med gitte priser (kr/kWh uten mva)."""
    rows = []
    for n, price in enumerate(prices):
        start = MIDNIGHT + timedelta(minutes=minutes * n)
        rows.append({
            "NOK_per_kWh": price,
            "time_start": start.isoformat(),
            "time_end": (start + timedelta(minutes=minutes)).isoformat(),
        })
    return rows


class ParseTests(unittest.TestCase):
    def test_vat_is_added(self):
        self.assertAlmostEqual(s.parse_prices(day([1.0]), "NO1")[0].price, 1.25)

    def test_northern_norway_is_exempt_from_vat(self):
        self.assertAlmostEqual(s.parse_prices(day([1.0]), "NO4")[0].price, 1.0)

    def test_vat_can_be_left_out(self):
        self.assertAlmostEqual(s.parse_prices(day([1.0]), "NO1", include_vat=False)[0].price, 1.0)

    def test_intervals_are_sorted(self):
        rows = list(reversed(day([1, 2, 3])))
        self.assertEqual([i.price for i in s.parse_prices(rows, include_vat=False)], [1, 2, 3])


class SummaryTests(unittest.TestCase):
    def test_key_figures(self):
        stats = s.summarize(s.parse_prices(day([1, 3, 2, 6]), include_vat=False))
        self.assertEqual((stats["min"], stats["max"], stats["mean"], stats["median"]), (1, 6, 3, 2.5))
        self.assertEqual(stats["cheapest_start"], MIDNIGHT.isoformat())

    def test_empty_input_raises(self):
        with self.assertRaises(ValueError):
            s.summarize([])


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.prices = s.parse_prices(day([5, 4, 1, 1, 2, 9, 9, 3]), include_vat=False)

    def test_finds_cheapest_contiguous_hours(self):
        result = s.cheapest_window(self.prices, hours=2, kwh=2)
        self.assertEqual(result["blocks"][0]["start"], (MIDNIGHT + timedelta(hours=2)).isoformat())
        self.assertAlmostEqual(result["cost"], 2.0)

    def test_window_may_start_inside_an_interval(self):
        # 1,5 timer: billigst å ta hele time 2 og halve time 3 (begge koster 1).
        result = s.cheapest_window(self.prices, hours=1.5, kwh=1.5)
        self.assertAlmostEqual(result["cost"], 1.5)

    def test_partial_window_beats_boundary_start(self):
        prices = s.parse_prices(day([9, 1, 2, 9]), include_vat=False)
        # 1,5 timer: hele time 1 (pris 1) + halve time 2 (pris 2) = 2,0. Start 01:00.
        result = s.cheapest_window(prices, hours=1.5, kwh=1.5)
        self.assertEqual(result["blocks"][0]["start"], (MIDNIGHT + timedelta(hours=1)).isoformat())
        self.assertAlmostEqual(result["cost"], 2.0)

    def test_too_long_window_raises(self):
        with self.assertRaises(ValueError):
            s.cheapest_window(self.prices, hours=9, kwh=1)

    def test_quarter_hour_prices(self):
        prices = s.parse_prices(day([4, 4, 1, 1, 1, 1, 4, 4], minutes=15), include_vat=False)
        result = s.cheapest_window(prices, hours=1, kwh=2)
        self.assertEqual(result["blocks"][0]["start"], (MIDNIGHT + timedelta(minutes=30)).isoformat())
        self.assertAlmostEqual(result["cost"], 2.0)


class SlotTests(unittest.TestCase):
    def setUp(self):
        self.prices = s.parse_prices(day([5, 1, 9, 1, 2, 9]), include_vat=False)

    def test_picks_cheapest_hours_even_when_apart(self):
        result = s.cheapest_slots(self.prices, kwh=22, kw=11)  # to timer
        self.assertEqual(len(result["blocks"]), 2)
        self.assertAlmostEqual(result["cost"], 22.0)

    def test_adjacent_hours_are_merged(self):
        result = s.cheapest_slots(self.prices, kwh=33, kw=11)  # tre timer: 01, 03 og 04
        self.assertEqual(len(result["blocks"]), 2)
        self.assertEqual(result["blocks"][1]["end"], (MIDNIGHT + timedelta(hours=5)).isoformat())

    def test_partial_hour(self):
        result = s.cheapest_slots(self.prices, kwh=16.5, kw=11)  # 1,5 time
        self.assertAlmostEqual(result["cost"], 16.5)

    def test_partial_hour_is_placed_next_to_the_following_block(self):
        prices = s.parse_prices(day([9, 2, 1, 9]), include_vat=False)
        result = s.cheapest_slots(prices, kwh=16.5, kw=11)  # hele time 2 + halve time 1
        self.assertEqual(result["blocks"], [{
            "start": (MIDNIGHT + timedelta(hours=1, minutes=30)).isoformat(),
            "end": (MIDNIGHT + timedelta(hours=3)).isoformat(),
        }])

    def test_never_more_expensive_than_any_contiguous_run(self):
        flexible = s.cheapest_slots(self.prices, kwh=22, kw=11)["cost"]
        for start in range(5):
            run = s.cost_of_run(self.prices, MIDNIGHT + timedelta(hours=start), 2, 11)
            self.assertLessEqual(flexible, run + 1e-9)

    def test_not_enough_time_raises(self):
        with self.assertRaises(ValueError):
            s.cheapest_slots(self.prices, kwh=100, kw=11)


class PlanTests(unittest.TestCase):
    def request(self, **task):
        return json.dumps({
            "prices": day([5, 4, 1, 1, 2, 9, 9, 3]),
            "area": "NO1",
            "include_vat": False,
            "now": (MIDNIGHT + timedelta(minutes=30)).isoformat(),
            "task": task,
        })

    def test_saving_is_compared_with_starting_now(self):
        result = json.loads(s.analyze(self.request(mode="window", hours=2, kwh=2)))["plan"]
        # Start nå (00:30): 0,5 t * 5 + 1 t * 4 + 0,5 t * 1 = 7,0. Best: 2,0.
        self.assertAlmostEqual(result["baseline_cost"], 7.0)
        self.assertAlmostEqual(result["saving"], 5.0)

    def test_deadline_limits_the_search(self):
        deadline = (MIDNIGHT + timedelta(hours=2)).isoformat()
        result = json.loads(s.analyze(self.request(mode="flexible", kwh=11, kw=11, deadline=deadline)))["plan"]
        self.assertEqual(result["blocks"][0]["start"], (MIDNIGHT + timedelta(hours=1)).isoformat())

    def test_past_hours_are_ignored(self):
        request = json.loads(self.request(mode="flexible", kwh=11, kw=11))
        request["now"] = (MIDNIGHT + timedelta(hours=5)).isoformat()
        result = json.loads(s.analyze(json.dumps(request)))["plan"]
        self.assertEqual(result["blocks"][0]["start"], (MIDNIGHT + timedelta(hours=7)).isoformat())

    def test_errors_are_returned_as_json(self):
        deadline = (MIDNIGHT + timedelta(hours=1)).isoformat()
        result = json.loads(s.analyze(self.request(mode="window", hours=4, kwh=1, deadline=deadline)))
        self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
