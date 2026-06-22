# Constructing Hard Questions

Hard questions are built by adding useful reasoning requirements, not by hiding information randomly. Use only the layers that make sense for the domain.

## 1. Resolve By Attributes

Ask for an entity described by properties instead of naming its ID.

Simple:

> What is metric X for record R001?

Harder:

> Find the record in segment A with the third-highest metric X during the fixed window.

## 2. Traverse Relationships

Require the answerer to follow at least one graph edge.

> From that record, follow its primary actor to the actor's next linked record and return the terminal metric.

## 3. Derive A Threshold

Use a threshold that must be computed from the data.

> Keep records whose metric is above the cohort median for the same window.

## 4. Join Sources

Use two views of the environment.

> Divide the record's primary metric from source A by its linked-event count from source B.

## 5. Add Natural Constraints

Use constraints that a real analyst might use: fixed windows, exclusions, tie-breakers, or status filters.

> Exclude records without linked events; if tied, choose the lowest stable ID.

## Compact Example

> In the fixed window, find segment A records whose metric is above the cohort median. Exclude records without linked events. Sort the remaining records by metric descending, choose the third record, follow its primary actor to that actor's next linked record, and return that linked record's source code.

Why this works:

1. It resolves a set rather than naming a record.
2. It computes a cohort statistic.
3. It applies a meaningful exclusion.
4. It ranks with a deterministic rule.
5. It traverses a relationship.
6. It asks for a precise terminal value.

## Avoid

- Decorative constraints that do not reflect the domain.
- Vague phrases without metrics.
- Leaking the terminal answer in the question.
- Adding so many layers that the question becomes unreadable.
