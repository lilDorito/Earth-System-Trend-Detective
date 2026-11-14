// short explainers for students

import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight } from "lucide-react";
import { Page, PageHeader } from "@/components/Page";

type Topic = { id: string; title: string; body: ReactNode };

const topics: Topic[] = [
  {
    id: "trend",
    title: "What is a trend?",
    body: (
      <>
        <p>
          A trend is a slow, steady change hiding under the everyday ups and downs. One hot summer is weather. Summers
          getting a little hotter every decade is a trend.
        </p>
        <p>
          We draw the straight line that fits the data best. Its slope tells you how fast things change, for example
          +0.3 °C per decade.
        </p>
      </>
    ),
  },
  {
    id: "significance",
    title: "What does “significant” mean?",
    body: (
      <>
        <p>
          Data is noisy, so even random numbers can look like they are going up. A result is statistically significant
          when a pattern that strong would rarely show up by chance alone.
        </p>
        <p>
          The p-value is that chance. p = 0.01 means a 1 in 100 chance of seeing a trend this strong if nothing were
          really changing. We call it significant when p is below 0.05. The 95% range shows which slopes still fit the
          data reasonably well.
        </p>
        <p>
          Significant does not mean big. A tiny change can be significant if it is very steady, and a big swing can
          still be noise.
        </p>
      </>
    ),
  },
  {
    id: "seasons",
    title: "Why remove the seasons?",
    body: (
      <>
        <p>
          Temperature climbs every summer and drops every winter. That cycle is much larger than a long-term trend, so
          it can hide it completely.
        </p>
        <p>
          We work out the usual value for each calendar month and subtract it. What is left, the anomaly, tells you
          whether a month was warmer or colder than normal for that time of year.
        </p>
      </>
    ),
  },
  {
    id: "event",
    title: "Trend or event?",
    body: (
      <>
        <p>
          Some changes happen all at once: a factory closes, a war starts, a dam is built. A straight line is the wrong
          tool for that.
        </p>
        <p>
          Instead we compare the average before the date with the average after it, and check whether the gap is larger
          than the normal month-to-month wobble.
        </p>
      </>
    ),
  },
];

export default function LearnPage() {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  return (
    <Page className="max-w-3xl">
      <PageHeader title="How to read the results">
        Four ideas are enough to understand every number in this app. None of them need more than school maths.
      </PageHeader>

      <div className="border-b">
        {topics.map(({ id, title, body }, i) => (
          <section key={id} id={id} className="grid scroll-mt-6 gap-3 border-t py-7 md:grid-cols-[200px_1fr] md:gap-8">
            <div>
              <p className="font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-1 font-semibold tracking-tight">{title}</h2>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-foreground/80">{body}</div>
          </section>
        ))}
      </div>

      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
      >
        Try it in the explorer <ArrowRight className="size-4" />
      </Link>

      <p className="mt-12 text-xs text-muted-foreground">
        Globe imagery: NASA Blue Marble Next Generation. Borders: Natural Earth.
      </p>
    </Page>
  );
}
