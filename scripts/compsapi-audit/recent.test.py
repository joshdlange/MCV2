import datetime, unittest, runpy, contextlib, io
with contextlib.redirect_stdout(io.StringIO()):
    m=runpy.run_path("scripts/compsapi-audit/recent.py")
def row(price,days):
    return {"price":price,"last_sold":(m["now"]-datetime.timedelta(days=days)).isoformat()}
class RecentTests(unittest.TestCase):
    def test_old_volume_cannot_outweigh_recent_bucket(self):
        self.assertEqual(m["weighted"]([row(100,2)]+[row(1,200)]*1000),100)
    def test_older_than_year_never_enters_model(self):
        self.assertIsNone(m["weighted"]([row(100,366)]))
    def test_empty_and_even_median(self):
        self.assertIsNone(m["stats"]([])["median"])
        self.assertEqual(m["stats"]([row(1,2),row(3,4)])["median"],2)
    def test_cohort_and_counts(self):
        self.assertEqual(len(m["out"]),25)
        self.assertEqual(sum(m["summary"]["confidence"].values()),25)
        self.assertEqual(sum(m["summary"]["staleness"].values())+m["summary"]["noAcceptedSale"],25)
        self.assertEqual(sum(m["summary"]["wins"].values()),25)
if __name__=="__main__":unittest.main()
