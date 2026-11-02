# Allocations are absolute, so every row is a full FTE

An Allocation is a share of a full working week rather than a share of the Person it sits on: 60% is 0.6 FTE whether that Person is 100% or 80% available. That is what makes FTE-days add up across People and Projects when reporting arrives, and it is why a part-timer's 60% also reads as 60%.

Consequence: every row is drawn a full FTE tall, and each Person's Availability appears inside it as a ceiling line with the unavailable band above. An absolute share therefore fills exactly its own height on every row, rows are comparable person to person, and over-allocation is anything crossing a Person's ceiling. The row header reads the assigned total together with the Availability at the Marker, such as "96% of 80%".

This supersedes ADR-0004, which scaled each row to its Person's Availability. That choice was made while a share was still relative to the Person, so the premise it rested on no longer holds.
